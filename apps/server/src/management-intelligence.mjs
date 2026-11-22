/** P2 BI e planejamento: apenas leituras do SQLite local e dos snapshots já validados.
 * Não calcula pagamentos a partir de fluxo de caixa nem cria outro ledger. */
import {localSummary} from './multiunit-sync.mjs';

const iso=day=>{
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Data inválida');
 const date=new Date(day+'T00:00:00.000Z');
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)throw Error('Data inválida');
 return day;
};
const todayUTC=()=>new Date().toISOString().slice(0,10);
const moveDay=(day,offset)=>new Date(Date.parse(iso(day)+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const between=(start,end)=>Math.round((Date.parse(iso(end)+'T00:00:00Z')-Date.parse(iso(start)+'T00:00:00Z'))/86400000);
const whole=(value,label,min,max)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(label+' inválido');return n;};
const safe=(value,label='Total')=>{if(!Number.isSafeInteger(value)||value<0)throw Error(label+' excede limite seguro');return value;};
const plus=(a,b,label)=>safe(a+b,label);
const entries=['orders','grossSalesCents','refundedCents','cogsCents','netSalesCents'];
const empty=()=>({orders:0,grossSalesCents:0,refundedCents:0,cogsCents:0,netSalesCents:0});
const addRow=(sum,row)=>{
 for(const key of entries)sum[key]=plus(sum[key],Number(row[key])||0,key);
 return sum;
};
const range=(params,defaultDays=30)=>{
 const today=todayUTC(),to=iso(params.get('to')||today),from=iso(params.get('from')||moveDay(to,-defaultDays+1));
 const width=between(from,to)+1;
 if(width<1||width>365)throw Error('Intervalo inválido: selecione de 1 a 365 dias');
 if(to>today)throw Error('Data final não pode estar no futuro');
 return {from,to,days:width};
};
const point=(row)=>({
 day:row.day,orders:row.orders,grossSalesCents:row.grossSalesCents,refundedCents:row.refundedCents,
 cogsCents:row.cogsCents,netSalesCents:row.netSalesCents
});
const net=(gross,refund)=>{if(refund>gross)throw Error('Estorno maior que valor da venda');return gross-refund;};

export function forecastProductSeries(history,asOf,horizonDays=7,lookbackDays=56){
 iso(asOf);whole(horizonDays,'Horizonte',1,30);whole(lookbackDays,'Histórico',7,84);
 const first=moveDay(asOf,-lookbackDays);
 const past=history.filter(x=>iso(x.day)>=first&&x.day<asOf&&Number.isSafeInteger(x.quantity)&&x.quantity>=0);
 const amounts=new Map();
 for(const row of past)amounts.set(row.day,plus(amounts.get(row.day)||0,row.quantity,'Quantidade'));
 const active=[...amounts].filter(x=>x[1]>0).map(x=>x[0]).sort();
 const observedDays=active.length?Math.min(lookbackDays,between(active[0],asOf)):0;
 const saleDays=active.length;
 if(observedDays<7)return {status:'INSUFFICIENT_HISTORY',confidence:'INSUFFICIENT_HISTORY',observedDays,saleDays,expectedUnits:null,days:[]};
 const all=Array.from({length:observedDays},(_,i)=>moveDay(asOf,-observedDays+i));
 const byWeek=new Map();
 let total=0;
 for(const day of all){
  const qty=amounts.get(day)||0;total=plus(total,qty,'Demanda');
  const weekDay=new Date(day+'T12:00:00Z').getUTCDay();
  const value=byWeek.get(weekDay)||{qty:0,count:0};
  value.qty+=qty;value.count++;
  byWeek.set(weekDay,value);
 }
 const overall=total/observedDays;
 const days=[];
 for(let offset=1;offset<=horizonDays;offset++){
  const day=moveDay(asOf,offset),weekday=new Date(day+'T12:00:00Z').getUTCDay(),sample=byWeek.get(weekday);
  const average=sample&&sample.count>=2?sample.qty/sample.count:overall;
  days.push({day,expectedUnits:Math.max(0,Math.round(average))});
 }
 const expectedUnits=days.reduce((a,d)=>plus(a,d.expectedUnits,'Previsão'),0);
 const confidence=observedDays>=42&&saleDays>=10?'HIGH':observedDays>=21&&saleDays>=4?'MEDIUM':'LOW';
 return {status:'READY',confidence,observedDays,saleDays,expectedUnits,days,model:'weekday-historical-mean'};
}

export function recommendReplenishment(ingredient,{today=todayUTC(),lookbackDays=28,leadDays=3,safetyDays=2}={}){
 iso(today);whole(lookbackDays,'Histórico',7,84);whole(leadDays,'Prazo de entrega',1,30);whole(safetyDays,'Estoque de segurança',0,30);
 const {onHandMilli,lowStockMilli,bookValueCents}=ingredient;
 for(const [name,value] of Object.entries({onHandMilli,lowStockMilli,bookValueCents}))safe(value,name);
 const batches=ingredient.batches||[],dailySales=ingredient.dailySales||[];
 let tracked=0,expired=0,expiring=0;
 const coverageEnd=moveDay(today,leadDays+safetyDays);
 for(const batch of batches){
  const qty=safe(batch.remainingMilli,'Lote');iso(batch.expiryDate);tracked=plus(tracked,qty,'Lotes');
  if(batch.expiryDate<today)expired+=qty;
  else if(batch.expiryDate<=coverageEnd)expiring+=qty;
 }
 if(tracked>onHandMilli)throw Error('Lotes excedem estoque canônico');
 const usableMilli=onHandMilli-expired;
 const coverageUsableMilli=Math.max(0,usableMilli-expiring);
 const start=moveDay(today,-lookbackDays+1);
 const daily=new Map();
 for(const row of dailySales){
  iso(row.day);const qty=safe(row.quantityMilli,'Consumo');
  if(row.day>=start&&row.day<=today)daily.set(row.day,plus(daily.get(row.day)||0,qty,'Consumo'));
 }
 const active=[...daily].filter(x=>x[1]>0).map(x=>x[0]).sort();
 const observedDays=active.length?Math.min(lookbackDays,between(active[0],today)+1):0;
 const demandConfidence=observedDays<7?'INSUFFICIENT_HISTORY':observedDays>=21&&active.length>=7?'MEDIUM':'LOW';
 const usedMilli=[...daily.values()].reduce((a,x)=>plus(a,x,'Consumo'),0);
 const dailyConsumptionMilli=observedDays>=7?Math.ceil(usedMilli/observedDays):null;
 const forecastTargetMilli=dailyConsumptionMilli===null?0:safe(dailyConsumptionMilli*(leadDays+safetyDays),'Cobertura');
 const targetMilli=Math.max(lowStockMilli,forecastTargetMilli);
 const recommendedMilli=Math.max(0,targetMilli-coverageUsableMilli);
 const stockoutDays=dailyConsumptionMilli>0?Math.floor(coverageUsableMilli/dailyConsumptionMilli):null;
 const risk=expired>0?'EXPIRED':recommendedMilli>0?'REPLENISH':demandConfidence==='INSUFFICIENT_HISTORY'?'NO_HISTORY':'OK';
 return {
  onHandMilli,lowStockMilli,bookValueCents,usableMilli,coverageUsableMilli,expiredMilli:expired,expiringMilli:expiring,
  dailyConsumptionMilli,observedDays,saleDays:active.length,demandConfidence,leadDays,safetyDays,
  stockoutDays,targetMilli,recommendedMilli,risk,automaticPurchase:false,source:'canonical-stock-movement'
 };
}

function dashboard(db,params){
 const period=range(params);
 const orders=db.prepare(`WITH
  scope AS (SELECT id,closed_at,service_mode FROM sales_order WHERE status='CLOSED'
    AND substr(closed_at,1,10) BETWEEN ? AND ?),
  lines AS (SELECT l.order_id,SUM(l.quantity*l.unit_price_cents) AS gross
    FROM order_line l JOIN scope o ON o.id=l.order_id WHERE l.cancelled_at IS NULL GROUP BY l.order_id),
  refunds AS (SELECT r.order_id,SUM(r.amount_cents) AS amount FROM order_refund r
    JOIN scope o ON o.id=r.order_id GROUP BY r.order_id),
  item_refunds AS (SELECT ir.order_id,SUM(ir.amount_cents) AS amount FROM order_line_refund ir
    JOIN scope o ON o.id=ir.order_id GROUP BY ir.order_id),
  costs AS (SELECT m.source_order_id AS order_id,SUM(-m.value_delta_cents) AS amount
    FROM stock_movement m JOIN scope o ON o.id=m.source_order_id WHERE m.kind='SALE'
    GROUP BY m.source_order_id)
  SELECT o.id,substr(o.closed_at,1,10) AS day,substr(o.closed_at,12,2) AS hour,
   o.service_mode AS serviceMode,COALESCE(l.gross,0) AS gross,
   COALESCE(r.amount,0)+COALESCE(ir.amount,0) AS refund,COALESCE(c.amount,0) AS cogs
  FROM scope o LEFT JOIN lines l ON l.order_id=o.id
  LEFT JOIN refunds r ON r.order_id=o.id LEFT JOIN item_refunds ir ON ir.order_id=o.id
  LEFT JOIN costs c ON c.order_id=o.id
  ORDER BY o.closed_at,o.id LIMIT 10001`).all(period.from,period.to);
 if(orders.length>10000)throw Error('BI: selecione intervalo menor, limite de 10 mil vendas');
 const totals=empty(),byDay=new Map(),byMode=new Map(),byHour=new Map();
 for(const o of orders){
  for(const key of ['gross','refund','cogs'])safe(o[key],key);
  const row={orders:1,grossSalesCents:o.gross,refundedCents:o.refund,cogsCents:o.cogs,netSalesCents:net(o.gross,o.refund)};
  addRow(totals,row);
  for(const [map,key] of [[byDay,o.day],[byMode,o.serviceMode],[byHour,o.hour||'--']]){
   const item=map.get(key)||empty();addRow(item,row);map.set(key,item);
  }
 }
 const topProducts=db.prepare(`SELECT l.product_id AS productId,MAX(l.product_name_snapshot) AS name,
  SUM(l.quantity) AS quantity,SUM(l.quantity*l.unit_price_cents) AS grossCents
  FROM order_line l JOIN sales_order o ON o.id=l.order_id
  WHERE o.status='CLOSED' AND l.cancelled_at IS NULL AND substr(o.closed_at,1,10) BETWEEN ? AND ?
  GROUP BY l.product_id ORDER BY quantity DESC,productId LIMIT 20`).all(period.from,period.to).map(p=>({ ...p,quantity:safe(p.quantity),grossCents:safe(p.grossCents)}));
 const topCategories=db.prepare(`SELECT c.id AS categoryId,c.name,SUM(l.quantity) AS quantity,
  SUM(l.quantity*l.unit_price_cents) AS grossCents
  FROM order_line l JOIN sales_order o ON o.id=l.order_id
  JOIN menu_product p ON p.id=l.product_id JOIN menu_category c ON c.id=p.category_id
  WHERE o.status='CLOSED' AND l.cancelled_at IS NULL AND substr(o.closed_at,1,10) BETWEEN ? AND ?
  GROUP BY c.id ORDER BY grossCents DESC,categoryId LIMIT 20`).all(period.from,period.to);
 const methods=db.prepare(`SELECT p.method,SUM(p.amount_cents) AS confirmedCents
  FROM payment p JOIN sales_order o ON o.id=p.order_id
  WHERE p.state='CONFIRMED' AND o.status='CLOSED' AND substr(o.closed_at,1,10) BETWEEN ? AND ?
  GROUP BY p.method ORDER BY p.method`).all(period.from,period.to);
 return {status:200,body:{
  period,totals:{...totals,grossMarginCents:totals.netSalesCents-totals.cogsCents,
   averageTicketCents:totals.orders?Math.round(totals.netSalesCents/totals.orders):0},
  byDay:[...byDay].sort(([a],[b])=>a.localeCompare(b)).map(([day,values])=>({day,...values})),
  byMode:[...byMode].map(([serviceMode,values])=>({serviceMode,...values})),
  byHour:[...byHour].sort(([a],[b])=>a.localeCompare(b)).map(([hour,values])=>({hour,...values})),
  topProducts,topCategories,methods,source:'canonical-sqlite',
  refundAttribution:'sale-closing-date',categoryAttribution:'current-product-category',clock:'UTC'
 }};
}

function forecast(db,params){
 const asOf=todayUTC(),horizonDays=whole(params.get('days')??7,'Horizonte',1,30),
  lookbackDays=whole(params.get('lookbackDays')??56,'Histórico',7,84);
 const from=moveDay(asOf,-lookbackDays);
 const rows=db.prepare(`SELECT l.product_id AS productId,MAX(l.product_name_snapshot) AS name,
  substr(o.closed_at,1,10) AS day,SUM(MAX(0,l.quantity-COALESCE(r.refunded,0))) AS quantity
  FROM order_line l JOIN sales_order o ON o.id=l.order_id
  LEFT JOIN (SELECT line_id,SUM(quantity) AS refunded FROM order_line_refund GROUP BY line_id) r ON r.line_id=l.id
  WHERE o.status='CLOSED' AND l.cancelled_at IS NULL AND substr(o.closed_at,1,10) BETWEEN ? AND ?
  GROUP BY l.product_id,substr(o.closed_at,1,10)
  ORDER BY day DESC,productId LIMIT 12001`).all(from,asOf);
 if(rows.length>12000)throw Error('Muitas linhas de demanda; use período menor');
 const byProduct=new Map();
 for(const row of rows){
  const entry=byProduct.get(row.productId)||{id:row.productId,name:row.name,history:[],sold:0};
  entry.history.push({day:row.day,quantity:safe(row.quantity,'Quantidade')});
  entry.sold=plus(entry.sold,row.quantity,'Quantidade');byProduct.set(row.productId,entry);
 }
 const products=[...byProduct.values()].sort((a,b)=>b.sold-a.sold||a.id.localeCompare(b.id)).slice(0,60).map(item=>({
  id:item.id,name:item.name,historicalUnits:item.sold,...forecastProductSeries(item.history,asOf,horizonDays,lookbackDays)
 }));
 return {status:200,body:{asOf,horizonDays,lookbackDays,products,
  source:'canonical-closed-sales',method:'weekday-historical-mean',automaticDecision:false,
  warning:'Estimativa histórica; não representa garantia de vendas. Até 60 produtos com mais movimentação.'}};
}

function replenishment(db,params){
 const today=todayUTC(),lookbackDays=whole(params.get('lookbackDays')??28,'Histórico',7,84),
  leadDays=whole(params.get('leadDays')??3,'Prazo de entrega',1,30),
  safetyDays=whole(params.get('safetyDays')??2,'Estoque de segurança',0,30);
 const ingredients=db.prepare(`SELECT id,name,unit,on_hand_milli AS onHandMilli,
  low_stock_milli AS lowStockMilli,book_value_cents AS bookValueCents
  FROM stock_ingredient WHERE restaurant_id='r-local' AND active=1
  ORDER BY name COLLATE NOCASE,id LIMIT 501`).all();
 if(ingredients.length>500)throw Error('Reposição: limite de 500 ingredientes por consulta');
 const batches=db.prepare('SELECT remaining_milli AS remainingMilli,expiry_date AS expiryDate FROM ingredient_batch WHERE ingredient_id=? AND remaining_milli>0');
 const usage=db.prepare(`SELECT substr(created_at,1,10) AS day,SUM(-quantity_delta_milli) AS quantityMilli
  FROM stock_movement WHERE ingredient_id=? AND kind='SALE' AND substr(created_at,1,10) BETWEEN ? AND ?
  GROUP BY substr(created_at,1,10) ORDER BY day`);
 const from=moveDay(today,-lookbackDays+1);
 const rows=ingredients.map(i=>({
  id:i.id,name:i.name,unit:i.unit,...recommendReplenishment({...i,batches:batches.all(i.id),
   dailySales:usage.all(i.id,from,today)},{today,lookbackDays,leadDays,safetyDays})
 }));
 rows.sort((a,b)=>(b.recommendedMilli>0)-(a.recommendedMilli>0)||b.recommendedMilli-a.recommendedMilli||a.name.localeCompare(b.name));
 return {status:200,body:{asOf:today,lookbackDays,leadDays,safetyDays,ingredients:rows,
  source:'canonical-stock-movement',automaticPurchase:false,
  warning:'Sugestões não geram pedidos de compra; confirme prazo, estoque utilizável e validade.'}};
}

function consolidated(db,params,liveSummaries=[],syncIntervalMs=60000){
 const period=range(params),now=new Date(),all=[];
 const localId=db.prepare("SELECT unit_id AS unitId FROM installation_identity WHERE id='local'").get().unitId;
 all.push({unitId:localId,local:true,revision:db.prepare("SELECT revision FROM multiunit_export_state WHERE id='local'").get()?.revision||0,
  importedAt:null,daily:localSummary(db)});
 const peers=db.prepare('SELECT unit_id AS unitId,revision,packet_json AS packetJson,imported_at AS importedAt FROM multiunit_peer_snapshot ORDER BY unit_id LIMIT 100').all();
 for(const peer of peers){
  const packet=JSON.parse(peer.packetJson);
  if(packet.unitId!==peer.unitId||!Array.isArray(packet.daily))throw Error('Snapshot de unidade inconsistente');
  all.push({unitId:peer.unitId,local:false,revision:peer.revision,importedAt:peer.importedAt,daily:packet.daily});
 }
 for(const summary of liveSummaries){
  if(summary.unitId===localId||!Array.isArray(summary.daily)||!summary.receivedAt)continue;
  const position=all.findIndex(u=>u.unitId===summary.unitId);
  const existing=position>=0?all[position]:null;
  if(existing?.importedAt&&summary.receivedAt<existing.importedAt)continue;
  const candidate={unitId:summary.unitId,local:false,revision:0,importedAt:summary.receivedAt,
   daily:summary.daily,source:'https-lan-read-only',generatedAt:summary.generatedAt};
  if(position>=0)all[position]=candidate;else all.push(candidate);
 }
 const totals=empty(),trend=new Map();
 const units=all.map(u=>{
  const part=empty(),daily=u.daily.filter(d=>d.day>=period.from&&d.day<=period.to);
  for(const d of daily){
   addRow(part,{orders:d.orderCount,grossSalesCents:d.grossSalesCents,refundedCents:d.refundedCents,cogsCents:d.cogsCents,netSalesCents:d.netSalesCents});
   const current=trend.get(d.day)||empty();
   addRow(current,{orders:d.orderCount,grossSalesCents:d.grossSalesCents,refundedCents:d.refundedCents,cogsCents:d.cogsCents,netSalesCents:d.netSalesCents});
   trend.set(d.day,current);
  }
  addRow(totals,part);
  const age=u.local?0:Math.max(0,Math.round((now.getTime()-Date.parse(u.importedAt))/60000));
  const live=u.source==='https-lan-read-only';
  const limit=live?Math.max(3,Math.ceil(3*syncIntervalMs/60000)):1440;
  return {unitId:u.unitId,local:u.local,revision:u.revision,importedAt:u.importedAt,generatedAt:u.generatedAt??null,
   ageMinutes:Number.isFinite(age)?age:null,stale:!u.local&&(!Number.isFinite(age)||age>limit),
   latestDay:u.daily.at(-1)?.day??null,totals:part,source:u.local?'local-live':u.source||'manual-validated-snapshot'};
 });
 return {status:200,body:{period,units,totals:{...totals,grossMarginCents:totals.netSalesCents-totals.cogsCents},
  byDay:[...trend].sort(([a],[b])=>a.localeCompare(b)).map(([day,values])=>({day,...values})),
  mode:liveSummaries.length?'HTTPS_READ_ONLY_OPT_IN':'MANUAL_OPT_IN',realTime:false,
  liveRefreshAvailable:liveSummaries.length>0,operationalReplication:false,generatedAt:now.toISOString(),
  warning:liveSummaries.length?'Unidades HTTPS são amostras periódicas, não transações em tempo real; confira o frescor.'
    :'Unidades remotas são snapshots importados; atualize por exportação/importação ou habilite consulta HTTPS privada.'}};
}

export function businessIntelligenceRead(db,method,route,params,peerPoller=null){
 if(method!=='GET'||!route.startsWith('/api/bi/'))return null;
 try{
  if(route==='/api/bi/dashboard')return dashboard(db,params);
  if(route==='/api/bi/forecast')return forecast(db,params);
  if(route==='/api/bi/replenishment')return replenishment(db,params);
  if(route==='/api/bi/consolidated')return consolidated(db,params,peerPoller?.liveSummaries?.()??[],peerPoller?.status?.().intervalMs??60000);
  return null;
 }catch(error){return {status:400,body:{code:'BI_INVALID_REQUEST',message:error.message}};}
}
