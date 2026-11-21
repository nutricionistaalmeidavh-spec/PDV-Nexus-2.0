import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';

async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-qr-'));
  const app=createApp({dataPath:path.join(dir,'nexus.db')});
  const local=await app.listen({port:0});
  const publicOrigin=await app.startPublicPortal({port:0});
  let cookie='';
  async function api(method,route,body,portal=false){
    const headers=body?{'content-type':'application/json'}:{};
    if(cookie&&!portal)headers.cookie=cookie;
    const res=await fetch((portal?publicOrigin:local)+route,{method,headers,body:body?JSON.stringify(body):undefined});
    const value=await res.json();
    if(!portal){const next=res.headers.get('set-cookie');if(next)cookie=next.split(';')[0];}
    return {status:res.status,...value};
  }
  assert.equal((await api('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {api,publicOrigin};
}
const cmd=(extras={})=>({commandId:randomUUID(),...extras});
async function good(api,method,route,body,status=200,portal=false){
  const res=await api(method,route,body,portal);
  assert.equal(res.status,status,JSON.stringify(res));
  return res;
}

test('editar item preserva lineId, atualiza valor/KDS e registra histórico com idempotência',async t=>{
  const {api}=await fixture(t);
  const p=(await good(api,'POST','/api/products',cmd({name:'Lanche',priceCents:2200}),201)).product;
  const other=(await good(api,'POST','/api/products',cmd({name:'Suco',priceCents:900}),201)).product;
  const extra=(await good(api,'POST',`/api/products/${p.id}/modifiers`,cmd({name:'Bacon',priceCents:400}),201)).modifier;
  const order=(await good(api,'POST','/api/orders',cmd({serviceMode:'counter'}),201)).order;
  let current=(await good(api,'POST',`/api/orders/${order.id}/lines`,cmd({expectedRevision:order.revision,productId:p.id,quantity:1}))).order;
  const line=current.lines[0].id;
  current=(await good(api,'POST',`/api/orders/${order.id}/lines`,cmd({expectedRevision:current.revision,productId:other.id,quantity:1}))).order;
  current=(await good(api,'POST',`/api/orders/${order.id}/confirm`,cmd({expectedRevision:current.revision}))).order;
  const initialTicket=(await good(api,'GET','/api/kitchen/tickets')).tickets.find(x=>x.lineId===line);
  const change=cmd({expectedRevision:current.revision,quantity:2,note:'Sem cebola',modifierIds:[extra.id]});
  const changed=await good(api,'POST',`/api/orders/${order.id}/lines/${line}/edit`,change);
  assert.equal(changed.order.totalCents,2*2600+900);
  assert.equal(changed.order.lines[0].id,line);
  assert.deepEqual(changed.order.lines[0].modifiers.map(x=>x.name),['Bacon']);
  assert.equal(changed.order.lines[1].productId,other.id);
  const repeat=await good(api,'POST',`/api/orders/${order.id}/lines/${line}/edit`,change);
  assert.deepEqual(repeat.order,changed.order);
  const history=(await good(api,'GET',`/api/orders/${order.id}/line-history`)).events;
  assert.equal(history.filter(x=>x.action==='EDITED').length,1);
  const ticket=(await good(api,'GET','/api/kitchen/tickets')).tickets.find(x=>x.lineId===line);
  assert.equal(ticket.id,initialTicket.id);
  assert.equal(ticket.revision,initialTicket.revision+1);
  assert.match(ticket.changeNote,/ALTERADO/);
  assert.equal(ticket.note,'Sem cebola');
  assert.equal((await api('POST',`/api/orders/${order.id}/lines/${line}/edit`,cmd({expectedRevision:current.revision,quantity:3}))).status,409);
  const cancel=cmd({expectedRevision:changed.order.revision,reason:'Cliente desistiu do lanche'});
  const removed=await good(api,'POST',`/api/orders/${order.id}/lines/${line}/cancel`,cancel);
  assert.equal(removed.order.totalCents,900);
  assert.deepEqual(removed.order.lines.map(x=>x.productId),[other.id]);
  assert.equal((await good(api,'POST',`/api/orders/${order.id}/lines/${line}/cancel`,cancel)).order.totalCents,900);
  const kitchen=(await good(api,'GET','/api/kitchen/tickets')).tickets.find(x=>x.lineId===line);
  assert.equal(kitchen.status,'CANCELLED');
  assert.match(kitchen.changeNote,/CANCELADO/);
  const events=(await good(api,'GET',`/api/orders/${order.id}/line-history`)).events;
  assert.equal(events.filter(x=>x.action==='CANCELLED').length,1);
});

test('QR de mesa permite solicitações múltiplas personalizadas, aprovação e reenvio idempotente',async t=>{
  const {api,publicOrigin}=await fixture(t);
  const table=(await good(api,'POST','/api/tables',cmd({label:'Mesa 07'}),201)).table;
  const order=(await good(api,'POST',`/api/tables/${table.id}/open`,cmd(),201)).order;
  const item=(await good(api,'POST','/api/products',cmd({name:'Pizza',priceCents:4500}),201)).product;
  const drink=(await good(api,'POST','/api/products',cmd({name:'Suco',priceCents:1000}),201)).product;
  const extra=(await good(api,'POST',`/api/products/${item.id}/modifiers`,cmd({name:'Borda',priceCents:500}),201)).modifier;
  const qr=await good(api,'POST',`/api/tables/${table.id}/qr`,cmd({publicBaseUrl:publicOrigin}));
  assert.ok(qr.url.startsWith(publicOrigin+'/table.html?token='));
  assert.ok(qr.qrSvg.includes('<svg'));
  const token=new URL(qr.url).searchParams.get('token');
  const catalog=await good(api,'GET',`/api/public/table/${token}`,null,200,true);
  assert.equal(catalog.tableLabel,'Mesa 07');
  assert.equal(catalog.products.find(x=>x.id===item.id).modifiers[0].id,extra.id);
  const request={clientRequestId:randomUUID(),guestName:'Ana',items:[
    {productId:item.id,quantity:2,modifierIds:[extra.id],note:'Sem cebola'},
    {productId:drink.id,quantity:1,modifierIds:[],note:''}
  ]};
  const submitted=await good(api,'POST',`/api/public/table/${token}/requests`,request,202,true);
  assert.equal(submitted.statusText,'PENDING');
  const repeated=await good(api,'POST',`/api/public/table/${token}/requests`,request,202,true);
  assert.equal(repeated.requestId,submitted.requestId);
  assert.equal((await api('POST',`/api/public/table/${token}/requests`,{...request,guestName:'Outro'},true)).status,409);
  const queue=await good(api,'GET',`/api/tables/${table.id}/requests`);
  assert.equal(queue.requests.length,1);
  const accepted=await good(api,'POST',`/api/table-requests/${submitted.requestId}/accept`,cmd());
  assert.equal(accepted.order.lines.length,2);
  assert.equal(accepted.order.totalCents,2*5000+1000);
  assert.equal(accepted.order.lines[0].note,'Sem cebola');
  assert.equal((await good(api,'GET',`/api/public/table/${token}/requests/${submitted.requestId}`,null,200,true)).statusText,'ACCEPTED');
  assert.equal(accepted.order.status,'OPEN'); // aprovação envia diretamente ao KDS
  assert.equal((await good(api,'GET','/api/kitchen/tickets')).tickets.length,2);
  const rotated=await good(api,'POST',`/api/tables/${table.id}/qr`,cmd({publicBaseUrl:publicOrigin}));
  assert.notEqual(rotated.url,qr.url);
  assert.equal((await api('GET',`/api/public/table/${token}`,null,true)).status,404);
});

test('QR em modo automático envia diretamente ao KDS, rejeita token inválido e nunca expõe administração',async t=>{
  const {api,publicOrigin}=await fixture(t);
  const table=(await good(api,'POST','/api/tables',cmd({label:'Mesa 01'}),201)).table;
  const order=(await good(api,'POST',`/api/tables/${table.id}/open`,cmd(),201)).order;
  const product=(await good(api,'POST','/api/products',cmd({name:'Café',priceCents:700}),201)).product;
  assert.equal((await api('POST',`/api/tables/${table.id}/qr`,cmd({publicBaseUrl:'http://evil.example'}))).status,400);
  const qr=await good(api,'POST',`/api/tables/${table.id}/qr`,cmd({publicBaseUrl:publicOrigin,autoAccept:true}));
  const token=new URL(qr.url).searchParams.get('token');
  assert.equal((await api('GET','/api/orders',null,true)).status,404);
  assert.equal((await api('GET','/api/public/table/'+'a'.repeat(64),null,true)).status,404);
  // A mesa pode receber itens antes de passar para OPEN: o primeiro pedido autoaceito confirma a comanda.
  const result=await good(api,'POST',`/api/public/table/${token}/requests`,{clientRequestId:randomUUID(),items:[{productId:product.id,quantity:1,modifierIds:[],note:'Pouco açúcar'}]},201,true);
  assert.equal(result.statusText,'ACCEPTED');
  const latest=(await good(api,'GET',`/api/orders/${order.id}`)).order;
  assert.equal(latest.status,'OPEN');
  assert.equal(latest.lines[0].note,'Pouco açúcar');
  assert.equal((await good(api,'GET','/api/kitchen/tickets')).tickets.length,1);
});
