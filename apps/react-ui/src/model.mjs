/** Matemática em centavos e dados exclusivamente demonstrativos, sem side effects. */
export const DEMO_ORDER = Object.freeze({id:'demo-1084',serviceMode:'counter',status:'DRAFT',revision:0,lines:[],totalCents:0});
export function parseMoney(value) {
  if(typeof value==='number') value=String(value);
  if(typeof value!=='string') throw new Error('Valor monetário inválido');
  const trimmed=value.trim().replace(/^R\$\s*/, '');
  const brazil=/^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;
  const decimal=/^\d+(?:\.\d{1,2})?$/;
  if(!brazil.test(trimmed) && !decimal.test(trimmed)) throw new Error('Valor monetário inválido');
  const n=Number(brazil.test(trimmed)?trimmed.replaceAll('.','').replace(',','.'):trimmed);
  const cents=Math.round(n*100);
  if(!Number.isSafeInteger(cents)||cents<0) throw new Error('Valor monetário inválido');
  return cents;
}
export function formatMoney(cents) {
  if(!Number.isSafeInteger(cents)) throw new Error('Centavos inválidos');
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
}
export function splitEvenly(totalCents,people) {
  if(!Number.isSafeInteger(totalCents)||totalCents<0||!Number.isSafeInteger(people)||people<1||people>100) throw new Error('Divisão inválida');
  const base=Math.floor(totalCents/people), remainder=totalCents%people;
  return Array.from({length:people},(_,i)=>base+(i<remainder?1:0));
}
export function paymentDraft(totalCents,method,tenderedCents=0) {
  if(!Number.isSafeInteger(totalCents)||totalCents<1||!['cash','pix','credit','debit'].includes(method)) throw new Error('Forma ou valor inválido');
  if(method==='cash'){
    if(!Number.isSafeInteger(tenderedCents)||tenderedCents<totalCents) throw new Error('Dinheiro insuficiente');
    return {payments:[{method:'cash',amountCents:totalCents,tenderedCents}],changeCents:tenderedCents-totalCents};
  }
  return {payments:[{method,amountCents:totalCents}],changeCents:0};
}
export function appendDemoLine(order,product,quantity=1,options={}) {
  if(!Number.isSafeInteger(quantity)||quantity<1) throw new Error('Quantidade inválida');
  const price=product.priceCents+(options.modifierPriceCents||0);
  if(!Number.isSafeInteger(price)||price<0) throw new Error('Preço inválido');
  const lines=[...(order.lines||[]),{id:`demo-line-${globalThis.crypto.randomUUID()}`,productId:product.id,productName:product.name,unitPriceCents:price,quantity,note:options.note||'',modifiers:options.modifiers||[]}];
  return {...order,lines,revision:order.revision+1,totalCents:lines.reduce((s,l)=>s+l.unitPriceCents*l.quantity,0)};
}
export function sumOrder(order){return order?.totalCents??(order?.lines||[]).reduce((s,l)=>s+l.unitPriceCents*l.quantity,0);}
export function formatTime(dateString){try{return new Date(dateString).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}catch{return '—';}}
