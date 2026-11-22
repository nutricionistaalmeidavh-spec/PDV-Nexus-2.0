/** Optional read-only mirror of peer units. Never writes another unit's canonical sales or stock. */
import {createHash,randomUUID} from 'node:crypto';
import net from 'node:net';
import {verifyLiveSummary} from './summary-live.mjs';
import {readBoundedJson} from './bounded-json.mjs';

const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const time=()=>new Date().toISOString();
const goodInt=x=>Number.isSafeInteger(x)&&x>=0;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const own=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const rootKeys=['schemaVersion','documentType','unitId','revision','previousHash','generatedAt','categories','products','stock','orders','hash'];
const shape=p=>({schemaVersion:p.schemaVersion,documentType:p.documentType,unitId:p.unitId,revision:p.revision,previousHash:p.previousHash,generatedAt:p.generatedAt,
 categories:p.categories,products:p.products,stock:p.stock,orders:p.orders});
const unit=db=>db.prepare("SELECT unit_id FROM installation_identity WHERE id='local'").get().unit_id;
const counts={categories:1000,products:2500,stock:2500,orders:5000,orderLines:60000};
const maxBytes=4*1024*1024;
function checkLimit(value,limit,label){
 if(value>limit){const e=new Error('Limite do espelho: '+label+'; não foi feito corte silencioso de registros');e.code='MIRROR_LIMIT';throw e;}
}
function orderedData(db){
 const categories=db.prepare("SELECT id,name,sort_order AS sortOrder,active FROM menu_category WHERE restaurant_id='r-local' ORDER BY id").all();
 const products=db.prepare("SELECT id,category_id AS categoryId,name,price_cents AS priceCents,active,is_combo AS isCombo FROM menu_product ORDER BY id").all();
 const stock=db.prepare("SELECT id,name,unit,on_hand_milli AS onHandMilli,book_value_cents AS bookValueCents,low_stock_milli AS lowStockMilli,active FROM stock_ingredient WHERE restaurant_id='r-local' ORDER BY id").all();
 const orders=db.prepare("SELECT id,status,revision,service_mode AS serviceMode,created_at AS createdAt,closed_at AS closedAt FROM sales_order WHERE restaurant_id='r-local' ORDER BY id").all();
 checkLimit(categories.length,counts.categories,'categorias');
 checkLimit(products.length,counts.products,'produtos');
 checkLimit(stock.length,counts.stock,'ingredientes');
 checkLimit(orders.length,counts.orders,'pedidos');
 const linesQuery=db.prepare("SELECT product_name_snapshot AS productName,unit_price_cents AS unitPriceCents,quantity FROM order_line WHERE order_id=? ORDER BY id");
 let lineCount=0;
 const full=orders.map(o=>{
  const lines=linesQuery.all(o.id);
  lineCount+=lines.length;checkLimit(lineCount,counts.orderLines,'linhas de pedidos');
  const total=lines.reduce((a,x)=>a+x.unitPriceCents*x.quantity,0);
  if(!goodInt(total))throw new Error('Total de venda inválido');
  return {...o,lines,totalCents:total};
 });
 return {categories,products,stock,orders:full};
}
function exportSnapshot(db){
 db.exec('BEGIN IMMEDIATE');
 try{
  const data=orderedData(db),content={unitId:unit(db),...data},contentHash=sha(content);
  const prior=db.prepare("SELECT * FROM operational_mirror_export WHERE id='local'").get();
  if(prior?.content_hash===contentHash){db.exec('COMMIT');return JSON.parse(prior.packet_json);}
  const payload={schemaVersion:1,documentType:'PDV_NEXUS_READONLY_MIRROR',unitId:content.unitId,
   revision:(prior?.revision??0)+1,previousHash:prior?.packet_hash??null,generatedAt:time(),...data};
  const packet={...payload,hash:sha(payload)};
  checkLimit(Buffer.byteLength(JSON.stringify(packet),'utf8'),maxBytes,'bytes');
  db.prepare("INSERT INTO operational_mirror_export(id,revision,content_hash,packet_hash,packet_json,generated_at) VALUES('local',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,content_hash=excluded.content_hash,packet_hash=excluded.packet_hash,packet_json=excluded.packet_json,generated_at=excluded.generated_at")
    .run(packet.revision,contentHash,packet.hash,JSON.stringify(packet),packet.generatedAt);
  db.exec('COMMIT');return packet;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
function validate(packet,bad){
 const reject=msg=>bad(msg);
 if(!own(packet,rootKeys)||packet.schemaVersion!==1||packet.documentType!=='PDV_NEXUS_READONLY_MIRROR'||
  !/^unit-[a-f0-9]{32}$/.test(packet.unitId)||!goodInt(packet.revision)||packet.revision===0||
  !(packet.previousHash===null||hex(packet.previousHash))||!hex(packet.hash)||
  typeof packet.generatedAt!=='string'||!Number.isFinite(Date.parse(packet.generatedAt)))
  reject('Pacote operacional inválido');
 if(!Array.isArray(packet.categories)||!Array.isArray(packet.products)||!Array.isArray(packet.stock)||!Array.isArray(packet.orders))reject('Coleções do pacote inválidas');
 checkLimit(packet.categories.length,counts.categories,'categorias');
 checkLimit(packet.products.length,counts.products,'produtos');
 checkLimit(packet.stock.length,counts.stock,'ingredientes');
 checkLimit(packet.orders.length,counts.orders,'pedidos');
 let totalLines=0;
 const unique=(values,label)=>{if(new Set(values).size!==values.length)reject(label+' repetido')};
 unique(packet.categories.map(x=>x.id),'Categoria');
 unique(packet.products.map(x=>x.id),'Produto');
 unique(packet.stock.map(x=>x.id),'Ingrediente');
 unique(packet.orders.map(x=>x.id),'Pedido');
 for(const x of packet.categories){
  if(!own(x,['id','name','sortOrder','active'])||!validId(x.id)||typeof x.name!=='string'||x.name.length>120||!goodInt(x.sortOrder)||![0,1].includes(x.active))reject('Categoria inválida');
 }
 for(const x of packet.products){
  if(!own(x,['id','categoryId','name','priceCents','active','isCombo'])||!validId(x.id)||!validId(x.categoryId)||typeof x.name!=='string'||x.name.length>120||!goodInt(x.priceCents)||![0,1].includes(x.active)||![0,1].includes(x.isCombo))reject('Produto inválido');
 }
 for(const x of packet.stock){
  if(!own(x,['id','name','unit','onHandMilli','bookValueCents','lowStockMilli','active'])||!validId(x.id)||typeof x.name!=='string'||x.name.length>120||!['g','ml','unit'].includes(x.unit)||!goodInt(x.onHandMilli)||!goodInt(x.bookValueCents)||!goodInt(x.lowStockMilli)||![0,1].includes(x.active))reject('Estoque inválido');
 }
 for(const x of packet.orders){
  if(!own(x,['id','status','revision','serviceMode','createdAt','closedAt','lines','totalCents'])||
    !validId(x.id)||!['DRAFT','OPEN','CLOSED','CANCELLED'].includes(x.status)||!goodInt(x.revision)||
    !['counter','table','takeaway','delivery'].includes(x.serviceMode)||typeof x.createdAt!=='string'||
    !(x.closedAt===null||typeof x.closedAt==='string')||!Array.isArray(x.lines)||!goodInt(x.totalCents))reject('Pedido inválido');
  totalLines+=x.lines.length;checkLimit(totalLines,counts.orderLines,'linhas de pedidos');
  let computed=0;
  for(const line of x.lines){
   if(!own(line,['productName','unitPriceCents','quantity'])||typeof line.productName!=='string'||line.productName.length>120||!goodInt(line.unitPriceCents)||!goodInt(line.quantity)||line.quantity===0)reject('Linha de pedido inválida');
   computed+=line.unitPriceCents*line.quantity;
   if(!goodInt(computed))reject('Total fora do limite seguro');
  }
  if(computed!==x.totalCents)reject('Total de pedido divergente');
 }
 if(Buffer.byteLength(JSON.stringify(packet),'utf8')>maxBytes)reject('Pacote excede 4MB');
 if(sha(shape(packet))!==packet.hash)reject('Hash do pacote operacional inválido');
}
function store(db,packet,conflict){
 const old=db.prepare('SELECT revision,packet_hash FROM operational_mirror_peer WHERE unit_id=?').get(packet.unitId);
 if(old?.revision===packet.revision&&old.packet_hash===packet.hash)return {imported:false,unitId:packet.unitId,revision:old.revision};
 if(old&&(packet.revision<old.revision||(packet.revision===old.revision&&packet.hash!==old.packet_hash)))conflict('Revisão antiga ou divergente','MIRROR_CONFLICT');
 if(old&&packet.revision===old.revision+1&&packet.previousHash!==old.packet_hash)conflict('Histórico divergente','MIRROR_CHAIN_CONFLICT');
 const gap=!!old&&packet.revision>old.revision+1;
 db.prepare('INSERT INTO operational_mirror_peer(unit_id,revision,packet_hash,packet_json,received_at,gap_detected) VALUES(?,?,?,?,?,?) ON CONFLICT(unit_id) DO UPDATE SET revision=excluded.revision,packet_hash=excluded.packet_hash,packet_json=excluded.packet_json,received_at=excluded.received_at,gap_detected=excluded.gap_detected')
  .run(packet.unitId,packet.revision,packet.hash,JSON.stringify(packet),time(),gap?1:0);
 return {imported:true,unitId:packet.unitId,revision:packet.revision,gapDetected:gap};
}
function peerList(db){
 const peers=db.prepare('SELECT unit_id AS unitId,revision,received_at AS receivedAt,gap_detected AS gapDetected,packet_json AS payload FROM operational_mirror_peer ORDER BY received_at DESC').all();
 return peers.map(({payload,gapDetected,...metadata})=>{
  const packet=JSON.parse(payload);
  return {...metadata,gapDetected:!!gapDetected,categories:packet.categories,products:packet.products,stock:packet.stock,orders:packet.orders};
 });
}
export function operationalRead(db,method,route,poller){
 if(method!=='GET')return null;
 if(route==='/api/sync/operational/export'){
  try{return {status:200,body:exportSnapshot(db)}}catch(e){if(e.code==='MIRROR_LIMIT')return {status:413,body:{code:'MIRROR_LIMIT',message:e.message}};throw e;}
 }
 if(route==='/api/sync/operational/peers')return {status:200,body:{peers:peerList(db),mode:'READ_ONLY',operationalWrites:false}};
 if(route==='/api/sync/operational/status')return {status:200,body:poller.status()};
 return null;
}
export function operationalWrite(db,method,route,body,h){
 if(method!=='POST'||route!=='/api/sync/operational/import')return null;
 validate(body.snapshot,h.bad);
 if(body.snapshot.unitId===unit(db))h.bad('Não importe o espelho da própria unidade');
 const result=h.transact(db,route,body,()=>{
  const applied=store(db,body.snapshot,h.conflict);
  if(applied.imported)h.audit(db,applied.unitId,'OPERATIONAL_MIRROR_IMPORTED',{revision:applied.revision,gapDetected:applied.gapDetected});
  return applied;
 },201);
 return result.body.imported?result:{...result,status:200};
}
function isPrivateHost(hostname){
 if(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local$/i.test(hostname))return true;
 if(net.isIP(hostname)!==4)return false;
 const parts=hostname.split('.').map(Number);
 return parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168);
}
export function validatePeerOptions(options){
 if(options==null)return {peers:[],intervalMs:60000,transport:fetch,summarySync:false};
 if(typeof options!=='object'||Array.isArray(options)||!Array.isArray(options.peers)||options.peers.length>8)throw new Error('Configuração de sincronização inválida');
 const summarySync=options.summarySync??false;
 if(typeof summarySync!=='boolean')throw new Error('Resumo de BI automático deve ser booleano');
 const intervalMs=options.intervalMs??60000;
 if(!Number.isSafeInteger(intervalMs)||intervalMs<30000||intervalMs>3600000)throw new Error('Intervalo de sincronização deve ser 30s a 60min');
 const peers=options.peers.map(p=>{
  if(!p||typeof p!=='object'||typeof p.url!=='string'||typeof p.token!=='string'||p.token.length<32||p.token.length>512)throw new Error('Token da unidade é obrigatório (mínimo 32 caracteres)');
  let u;try{u=new URL(p.url);}catch{throw new Error('Endereço da unidade inválido');}
  if(u.protocol!=='https:')throw new Error('A sincronização automática exige HTTPS');
  if(!isPrivateHost(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Use HTTPS de uma unidade na rede privada com certificado válido');
  return {url:u.origin,token:p.token};
 });
 if(new Set(peers.map(p=>p.url)).size!==peers.length)throw new Error('Unidades remotas duplicadas');
 return {peers,intervalMs,transport:options.transport??fetch,summarySync};
}
export function createOperationalPoller(db,options){
 const config=validatePeerOptions(options);
 const state=config.peers.map(p=>({url:p.url,lastSuccess:null,lastError:null,lastSummaryAt:null,lastSummaryError:null}));
 const live=new Map();
 let timer=null,running=false,stopped=false,stopResolver=null;
 async function syncOnce(){
  if(stopped)return {stopped:true,ok:0,failed:0};
  if(running)return {busy:true,ok:0,failed:0};
  running=true;let ok=0,failed=0,summaryOk=0,summaryFailed=0;
  try{
   for(let i=0;i<config.peers.length;i++){
    const peer=config.peers[i];
    try{
     const response=await config.transport(peer.url+'/api/sync/operational/export',{
       method:'GET',headers:{authorization:'Bearer '+peer.token,accept:'application/json'},
       redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'
     });
     if(!response.ok)throw Error('Status do peer: '+response.status);
     const snapshot=await readBoundedJson(response,{maxBytes});
     validate(snapshot,msg=>{throw Error(msg)});
     if(snapshot.unitId===unit(db))throw Error('O peer possui o mesmo identificador local');
     let summary=null,summaryError=false;
     if(config.summarySync){
      try{
       const financeResponse=await config.transport(peer.url+'/api/sync/summary/daily',{
        method:'GET',headers:{authorization:'Bearer '+peer.token,accept:'application/json'},
        redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'
       });
       if(!financeResponse.ok)throw Error('Resumo BI remoto indisponível');
       summary=verifyLiveSummary(await readBoundedJson(financeResponse,{maxBytes:524288}));
       if(summary.unitId!==snapshot.unitId)throw Error('Identidade do peer divergente');
      }catch{summaryError=true;}
     }
     db.exec('BEGIN IMMEDIATE');
     try{
      const applied=store(db,snapshot,(msg)=>{throw Error(msg)});
      if(applied.imported)db.prepare('INSERT INTO audit_log(id,aggregate_id,action,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(),applied.unitId,'OPERATIONAL_MIRROR_IMPORTED','automated-peer-sync',JSON.stringify({revision:applied.revision,gapDetected:applied.gapDetected}),time());
      db.exec('COMMIT');
     }catch(e){db.exec('ROLLBACK');throw e;}
     if(summary){
      const receivedAt=time();live.set(summary.unitId,{...summary,receivedAt});
      state[i].lastSummaryAt=receivedAt;state[i].lastSummaryError=null;summaryOk++;
     }else if(summaryError){
      state[i].lastSummaryError='Resumo BI indisponível, antigo ou não validado';summaryFailed++;
     }
     state[i].lastSuccess=time();state[i].lastError=null;ok++;
    }catch(e){failed++;state[i].lastError='Falha de conexão, validação ou revisão do peer';}
   }
   return {ok,failed,summaryOk,summaryFailed};
  }finally{running=false;if(stopResolver){stopResolver();stopResolver=null;}}
 }
 function start(){
  if(!timer&&config.peers.length){timer=setInterval(()=>void syncOnce(),config.intervalMs);timer.unref?.();}
 }
 async function stop(){stopped=true;if(timer)clearInterval(timer);timer=null;if(running)await new Promise(resolve=>{stopResolver=resolve});}
 function status(){return {enabled:config.peers.length>0,summarySyncEnabled:config.summarySync,intervalMs:config.intervalMs,peers:state.map(s=>({...s})),mode:'HTTPS_READ_ONLY',operationalWrites:false};}
 function liveSummaries(){return [...live.values()].map(x=>({...x}));}
 return {start,stop,syncOnce,status,liveSummaries};
}
