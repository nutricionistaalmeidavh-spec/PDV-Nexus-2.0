(()=>{'use strict';
const $=id=>document.getElementById(id),uid=()=>crypto.randomUUID();
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const node=(tag,cls,value)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=String(value);return el;};
const toMilli=v=>{const n=Number(String(v).replace(',','.'));if(!Number.isFinite(n)||Math.abs(n*1000-Math.round(n*1000))>0.000001||!Number.isSafeInteger(Math.round(n*1000)))throw Error('Quantidade inválida. Use até três casas decimais.');return Math.round(n*1000);};
const toCents=v=>{const n=Number(String(v).replace(',','.'));if(!Number.isFinite(n)||n<0||Math.abs(n*100-Math.round(n*100))>0.000001)throw Error('Valor monetário inválido');return Math.round(n*100);};
async function api(method,url,data){const response=await fetch(url,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const result=await response.json();if(!response.ok)throw Error(result.message||'Operação não realizada');return result;}
function toast(message,error=false){const el=$('toast');el.textContent=message;el.hidden=false;el.classList.toggle('error',error);}
async function run(fn){try{await fn();}catch(error){toast(error.message,true);}}
let ingredients=[],products=[],recipeDraft=[];
function fillSelect(el,values,valueFn,textFn){const current=el.value;el.replaceChildren();for(const x of values){const option=node('option','',textFn(x));option.value=valueFn(x);el.append(option);}if([...el.options].some(x=>x.value===current))el.value=current;}
function drawRecipe(){const list=$('stock-recipe-lines');list.replaceChildren();if(!recipeDraft.length)list.append(node('p','note','Ficha vazia: este produto não fará baixa automática do estoque.'));
 for(const item of recipeDraft){const ing=ingredients.find(i=>i.id===item.ingredientId);const row=node('div','data-row');row.append(node('strong','',ing?.name??item.ingredientId),node('span','',(item.quantityMilli/1000).toLocaleString('pt-BR',{maximumFractionDigits:3})+' '+(ing?.unit??'')));
 const rm=node('button','button ghost','Remover');rm.onclick=()=>{recipeDraft=recipeDraft.filter(x=>x.ingredientId!==item.ingredientId);drawRecipe();};row.append(rm);list.append(row);}}
async function loadRecipe(){const id=$('stock-recipe-product').value;if(!id){recipeDraft=[];drawRecipe();return;}const doc=await api('GET','/api/stock/recipes/'+encodeURIComponent(id));recipeDraft=doc.items.map(x=>({...x}));drawRecipe();}
async function renderStock(){const [inv,report,prod,margin]=await Promise.all([api('GET','/api/stock/ingredients'),api('GET','/api/stock/report'),api('GET','/api/products'),api('GET','/api/reports/margin')]);ingredients=inv.ingredients;products=prod.products.filter(x=>!x.isCombo);
 $('stock-summary').textContent='Valor em estoque: '+money(report.totalValueCents)+' · Alertas de estoque baixo: '+report.lowStockCount;
 $('stock-margin').textContent='Vendas líquidas: '+money(margin.netSalesCents)+' · CMV: '+money(margin.cogsCents)+' · Margem bruta estimada: '+money(margin.grossMarginCents);
 const list=$('stock-ingredient-list');list.replaceChildren();if(!ingredients.length)list.append(node('p','note','Cadastre seu primeiro ingrediente.'));
 for(const ing of ingredients){const row=node('div','data-row'),info=node('div');info.append(node('strong','',ing.name),node('small','',ing.unit+' · '+(ing.onHandMilli/1000).toLocaleString('pt-BR',{maximumFractionDigits:3})+' em estoque · custo: '+money(ing.bookValueCents)));
 const alert=ing.lowStockMilli>0&&ing.onHandMilli<=ing.lowStockMilli?node('span','','Estoque baixo'):node('span','','');row.append(info,alert);list.append(row);}
 for(const id of ['stock-receive-ingredient','stock-adjust-ingredient','stock-recipe-ingredient'])fillSelect($(id),ingredients,x=>x.id,x=>x.name+' ('+x.unit+')');
 fillSelect($('stock-recipe-product'),products,x=>x.id,x=>x.name);
 await loadRecipe();
}
function bindStock(){
 $('stock-ingredient-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;void run(async()=>{
 const data=new FormData(form);await api('POST','/api/stock/ingredients',{commandId:uid(),name:data.get('name'),unit:data.get('unit'),lowStockMilli:toMilli(data.get('lowStock'))});form.reset();await renderStock();toast('Ingrediente cadastrado');});};
 $('stock-receive-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;void run(async()=>{
 const data=new FormData(form);await api('POST','/api/stock/ingredients/'+data.get('ingredientId')+'/receive',{commandId:uid(),quantityMilli:toMilli(data.get('quantity')),costCents:toCents(data.get('cost'))});form.reset();await renderStock();toast('Entrada registrada');});};
 $('stock-adjust-form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;void run(async()=>{
 const data=new FormData(form),quantityMilli=toMilli(data.get('quantity'));const cost=data.get('cost');
 await api('POST','/api/stock/ingredients/'+data.get('ingredientId')+'/adjust',{commandId:uid(),quantityMilli,costCents:quantityMilli>0?toCents(cost):undefined,reason:data.get('reason')});form.reset();await renderStock();toast('Ajuste registrado');});};
 $('stock-recipe-product').onchange=()=>{void run(loadRecipe);};
 $('stock-recipe-add').onclick=()=>{void run(async()=>{
 const id=$('stock-recipe-ingredient').value,quantityMilli=toMilli($('stock-recipe-quantity').value);
 if(!id||quantityMilli<=0)throw Error('Informe um ingrediente e uma quantidade positiva');
 recipeDraft=recipeDraft.filter(x=>x.ingredientId!==id);recipeDraft.push({ingredientId:id,quantityMilli});drawRecipe();});};
 $('stock-recipe-save').onclick=()=>{void run(async()=>{
 const productId=$('stock-recipe-product').value;if(!productId)throw Error('Selecione um produto');
 await api('POST','/api/stock/recipes/'+productId,{commandId:uid(),items:recipeDraft});toast('Ficha técnica salva');await loadRecipe();});};
 $('stock-refresh').onclick=()=>{void run(renderStock);};
}
async function renderDelivery(){
 const [settings,requests,orders,privacy]=await Promise.all([api('GET','/api/delivery/settings'),api('GET','/api/delivery/requests'),api('GET','/api/delivery/orders'),api('GET','/api/delivery/privacy/report')]);
 $('delivery-privacy-report').textContent='Aguardando: '+privacy.pending+' · Rejeitadas: '+privacy.rejected+' · Anonimizadas: '+privacy.anonymized;
 $('public-menu-enabled').checked=settings.enabled;
 const list=$('delivery-request-list');list.replaceChildren();if(!requests.requests.length)list.append(node('p','note','Nenhuma solicitação recebida.'));
 for(const item of requests.requests){const row=node('div','data-row'),info=node('div');info.append(node('strong','',item.customerName+' · '+money(item.totalCents)),node('small','',item.status+' · '+item.phone+' · '+item.address));
 if(item.note)info.append(node('small','',item.note));row.append(info);
 if(item.status==='PENDING'){
  const accept=node('button','button primary','Aceitar');accept.onclick=()=>{void run(async()=>{const result=await api('POST','/api/delivery/requests/'+item.id+'/accept',{commandId:uid()});toast('Pedido '+result.order.id.slice(0,8)+' criado. Confirme e receba no caixa.');await renderDelivery();});};
  const reject=node('button','button ghost','Recusar');reject.onclick=()=>{const reason=prompt('Motivo da recusa');if(!reason?.trim())return;void run(async()=>{await api('POST','/api/delivery/requests/'+item.id+'/reject',{commandId:uid(),reason});await renderDelivery();toast('Solicitação recusada');});};row.append(accept,reject);
 }else if(item.status==='REJECTED'){
  const anonymize=node('button','button ghost','Anonimizar dados');
  anonymize.onclick=()=>{if(!confirm('Remover os dados pessoais desta solicitação?'))return;
   void run(async()=>{await api('POST','/api/delivery/requests/'+item.id+'/anonymize',{commandId:uid()});await renderDelivery();toast('Dados anonimizados');});};
  if(item.phone!=='00000000000')row.append(anonymize);
 }else if(item.orderId){const open=node('a','button secondary','Abrir pedido no caixa');open.href='/';open.title='Localize o pedido '+item.orderId.slice(0,8)+' no histórico';row.append(open);}
 list.append(row);
 }
 const shipment=$('delivery-order-list');shipment.replaceChildren();if(!orders.orders.length)shipment.append(node('p','note','Nenhuma entrega aceita.'));
 const next={ACCEPTED:'PREPARING',PREPARING:'OUT_FOR_DELIVERY',OUT_FOR_DELIVERY:'DELIVERED'};
 for(const item of orders.orders){const row=node('div','data-row'),info=node('div');info.append(node('strong','',item.customerName+' · '+item.status),node('small','',item.orderStatus+' · '+item.address));row.append(info);
 if(next[item.status]){const action=node('button','button secondary',({ACCEPTED:'Iniciar separação',PREPARING:'Saiu para entrega',OUT_FOR_DELIVERY:'Entregue'})[item.status]);action.onclick=()=>{void run(async()=>{await api('POST','/api/delivery/orders/'+item.orderId+'/status',{commandId:uid(),status:next[item.status]});await renderDelivery();toast('Status de entrega atualizado');});};row.append(action);}shipment.append(row);}
}

async function renderUnits(){
 const [summary,conflicts]=await Promise.all([api('GET','/api/sync/units'),api('GET','/api/sync/conflicts')]);
 $('sync-summary').textContent='Unidades: '+summary.units.length+' · Vendas brutas consolidadas: '+money(summary.totals.grossSalesCents)+' · CMV: '+money(summary.totals.cogsCents);
 const units=$('sync-unit-list');units.replaceChildren();
 for(const unit of summary.units){
  const row=node('div','data-row');
  const info=node('div');
  info.append(node('strong','',unit.local?'Esta instalação':'Unidade importada'),
    node('small','',unit.unitId+' · revisão '+unit.revision+' · '+money(unit.totals.grossSalesCents)));
  row.append(info);units.append(row);
 }
 const list=$('sync-conflict-list');list.replaceChildren();
 const unresolved=conflicts.conflicts.filter(x=>!x.resolvedAt);
 if(!unresolved.length)list.append(node('p','note','Nenhum conflito pendente.'));
 for(const conflict of unresolved){
  const row=node('div','data-row');
  const info=node('div');info.append(node('strong','',conflict.unitId+' · rev. '+conflict.revision),
    node('small','',conflict.reason));
  const button=node('button','button ghost','Descartar alerta');
  button.onclick=()=>{if(!confirm('Descartar apenas o alerta? Nenhum dado será alterado.'))return;
   void run(async()=>{await api('POST','/api/sync/conflicts/'+conflict.id+'/dismiss',{commandId:uid()});await renderUnits();toast('Alerta descartado');});};
  row.append(info,button);list.append(row);
 }
}
function bindUnits(){
 $('sync-refresh').onclick=()=>void run(renderUnits);
 $('sync-export').onclick=()=>void run(async()=>{
  const packet=await api('GET','/api/sync/export'),payload=JSON.stringify(packet,null,2);
  const url=URL.createObjectURL(new Blob([payload],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='pdv-unidade-'+packet.unitId+'-rev'+packet.revision+'.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  await renderUnits();toast('Resumo da unidade exportado');
 });
 $('sync-import').onclick=()=>void run(async()=>{
  const file=$('sync-import-file').files?.[0];if(!file)throw Error('Selecione um arquivo JSON de outra unidade');
  if(file.size>524000)throw Error('Arquivo excede limite de 512 KB');
  let snapshot;try{snapshot=JSON.parse(await file.text());}catch{throw Error('Arquivo JSON inválido');}
  const result=await api('POST','/api/sync/import',{commandId:uid(),snapshot});
  await renderUnits();toast(result.imported?'Dados consolidados da unidade importados':'Esta revisão já estava importada');
 });
}

function bindDelivery(){
 $('delivery-setting-form').onsubmit=e=>{e.preventDefault();void run(async()=>{const enabled=$('public-menu-enabled').checked;await api('POST','/api/delivery/settings',{commandId:uid(),enabled});toast(enabled?'Cardápio público habilitado':'Cardápio público desabilitado');await renderDelivery();});};
 $('delivery-refresh').onclick=()=>{void run(renderDelivery);};
 $('delivery-purge').onclick=()=>{void run(async()=>{
   const olderThanDays=Number($('delivery-retention-days').value);
   if(!Number.isSafeInteger(olderThanDays)||olderThanDays<30||olderThanDays>3650)throw Error('Prazo válido: 30 a 3650 dias');
   if(!confirm('Anonimizar dados pessoais de entregas finalizadas e rejeitadas com mais de '+olderThanDays+' dias?'))return;
   const result=await api('POST','/api/delivery/privacy/purge',{commandId:uid(),olderThanDays});
   await renderDelivery();toast(result.anonymized+' solicitações anonimizadas');
 });};
}
window.pdvAuth.ready().then(user=>{
 const manager=user?.role==='admin';for(const view of ['stock','delivery','units']){const b=document.querySelector('[data-view="'+view+'"]');if(b&&!manager)b.hidden=true;}
 if(!manager)return;bindStock();bindDelivery();bindUnits();
 document.querySelector('[data-view="stock"]').addEventListener('click',()=>{void run(renderStock);});
 document.querySelector('[data-view="delivery"]').addEventListener('click',()=>{void run(renderDelivery);});
 document.querySelector('[data-view="units"]').addEventListener('click',()=>{void run(renderUnits);});
}).catch(error=>toast(error.message,true));
})();
