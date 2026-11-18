import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-restaurant-'));
  const app=createApp({dataPath:path.join(dir,'local.db')});
  const origin=await app.listen({port:0});
  let cookie='';
  const request=async(method,route,body)=>{
    const headers=body?{'content-type':'application/json'}:{};if(cookie)headers.cookie=cookie;
    const r=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
    const sc=r.headers.get('set-cookie');if(sc)cookie=sc.split(';')[0];
    return {status:r.status,body:await r.json()};
  };
  const setup=await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'});
  assert.equal(setup.status,201);
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,app,request};
}
const command=(n,extra={})=>({commandId:`cmd-${n}`, ...extra});
async function product(request){const p=await request('POST','/api/products',command('prod',{name:'X-Frango',priceCents:1500}));assert.equal(p.status,201,JSON.stringify(p.body));return p.body.product;}
async function table(request,label,id){const r=await request('POST','/api/tables',command(id,{label}));assert.equal(r.status,201,JSON.stringify(r.body));return r.body.table;}

// RED primeiro: os testes precisam falhar antes da implementação da migração/restaurante.
test('mesa única abre e reutiliza comanda sem duplicar',async t=>{
  const {request}=await fixture(t);
  const a=await table(request,'Mesa 01','table-1');
  assert.equal((await request('POST','/api/tables',command('table-duplicate',{label:'Mesa 01'}))).status,409);
  assert.equal((await request('POST','/api/tables',command('table-duplicate-case',{label:'MESA 01'}))).status,409);
  const first=await request('POST',`/api/tables/${a.id}/open`,command('open-a'));
  assert.equal(first.status,201,JSON.stringify(first.body));
  const second=await request('POST',`/api/tables/${a.id}/open`,command('open-b'));
  assert.equal(second.body.order.id,first.body.order.id);
  assert.equal(second.body.reused,true);
  const list=await request('GET','/api/tables');
  assert.equal(list.body.tables[0].orderId,first.body.order.id);
  assert.equal(first.body.order.tableId,a.id);
  assert.equal((await request('POST','/api/orders',command('another-order',{serviceMode:'table',tableId:a.id}))).status,409);
});

test('adicionais preservam preço e cozinha recebe somente após confirmar',async t=>{
  const {request}=await fixture(t);
  const p=await product(request),tab=await table(request,'Mesa 02','table-2');
  const extra=await request('POST',`/api/products/${p.id}/modifiers`,command('add-cheese',{name:'Queijo extra',priceCents:350}));
  assert.equal(extra.status,201,JSON.stringify(extra.body));
  const order=(await request('POST',`/api/tables/${tab.id}/open`,command('open-tab-2'))).body.order;
  const added=await request('POST',`/api/orders/${order.id}/lines`,command('add-with-extra',{expectedRevision:0,productId:p.id,quantity:2,modifierIds:[extra.body.modifier.id],note:'Sem tomate'}));
  assert.equal(added.status,200,JSON.stringify(added.body));
  assert.equal(added.body.order.totalCents,3700);
  assert.equal(added.body.order.lines[0].modifiers[0].name,'Queijo extra');
  assert.equal(added.body.order.lines[0].note,'Sem tomate');
  const before=await request('GET','/api/kitchen/tickets');assert.equal(before.body.tickets.length,0);
  const confirmed=await request('POST',`/api/orders/${order.id}/confirm`,command('confirm-tab-2',{expectedRevision:1}));
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  const tickets=(await request('GET','/api/kitchen/tickets')).body.tickets;
  assert.equal(tickets.length,1);
  assert.equal(tickets[0].tableLabel,'Mesa 02');
  assert.equal(tickets[0].note,'Sem tomate');
  assert.equal(tickets[0].modifiers,'Queijo extra');
  // Retry do mesmo comando não cria novo ticket
  await request('POST',`/api/orders/${order.id}/confirm`,command('confirm-tab-2',{expectedRevision:1}));
  assert.equal((await request('GET','/api/kitchen/tickets')).body.tickets.length,1);
  const newItem=await request('POST',`/api/orders/${order.id}/lines`,command('add-open',{expectedRevision:2,productId:p.id,quantity:1}));
  assert.equal(newItem.body.order.totalCents,5200);
  assert.equal((await request('GET','/api/kitchen/tickets')).body.tickets.length,2);
});

test('KDS exige transições legais, revisão otimista e reenvio idempotente',async t=>{
  const {request}=await fixture(t);
  const p=await product(request);const tab=await table(request,'Balcão apoio','tab-kds');
  const a=(await request('POST',`/api/tables/${tab.id}/open`,command('open-kds'))).body.order;
  await request('POST',`/api/orders/${a.id}/lines`,command('line-kds',{expectedRevision:0,productId:p.id,quantity:1}));
  await request('POST',`/api/orders/${a.id}/confirm`,command('confirm-kds',{expectedRevision:1}));
  const ticket=(await request('GET','/api/kitchen/tickets')).body.tickets[0];
  assert.equal((await request('POST',`/api/kitchen/tickets/${ticket.id}/status`,command('skip-stage',{expectedRevision:0,status:'READY'}))).status,409);
  const prep=await request('POST',`/api/kitchen/tickets/${ticket.id}/status`,command('prepare',{expectedRevision:0,status:'PREPARING'}));
  assert.equal(prep.status,200);
  assert.deepEqual((await request('POST',`/api/kitchen/tickets/${ticket.id}/status`,command('prepare',{expectedRevision:0,status:'PREPARING'}))).body,prep.body);
  assert.equal((await request('POST',`/api/kitchen/tickets/${ticket.id}/status`,command('stale',{expectedRevision:0,status:'READY'}))).status,409);
  assert.equal((await request('POST',`/api/kitchen/tickets/${ticket.id}/status`,command('ready',{expectedRevision:1,status:'READY'}))).status,200);
  assert.equal((await request('POST',`/api/kitchen/tickets/${ticket.id}/status`,command('served',{expectedRevision:2,status:'SERVED'}))).status,200);
  assert.equal((await request('GET','/api/kitchen/tickets')).body.tickets.length,0);
});

test('transferência respeita ocupação e libera mesa no fechamento dividido',async t=>{
  const {request}=await fixture(t),p=await product(request);
  const ta=await table(request,'Mesa A','a'),tb=await table(request,'Mesa B','b'),tc=await table(request,'Mesa C','c');
  const a=(await request('POST',`/api/tables/${ta.id}/open`,command('order-A'))).body.order;
  await request('POST',`/api/tables/${tb.id}/open`,command('order-B'));
  assert.equal((await request('POST',`/api/orders/${a.id}/transfer-table`,command('move-occupied',{expectedRevision:0,tableId:tb.id}))).status,409);
  const move=await request('POST',`/api/orders/${a.id}/transfer-table`,command('move-free',{expectedRevision:0,tableId:tc.id}));
  assert.equal(move.status,200,JSON.stringify(move.body));
  assert.equal(move.body.order.tableId,tc.id);
  const added=await request('POST',`/api/orders/${a.id}/lines`,command('add-a',{expectedRevision:1,productId:p.id,quantity:2}));
  const confirmed=await request('POST',`/api/orders/${a.id}/confirm`,command('confirm-a',{expectedRevision:2}));
  assert.equal(confirmed.body.order.status,'OPEN');
  await request('POST','/api/cash/open',command('cash-a',{openingCents:10000}));
  const closed=await request('POST',`/api/orders/${a.id}/close`,command('close-a',{expectedRevision:3,payments:[{method:'cash',amountCents:1000,tenderedCents:2000},{method:'pix',amountCents:2000}]}));
  assert.equal(closed.status,200,JSON.stringify(closed.body));
  assert.equal(closed.body.changeCents,1000);
  const tables=(await request('GET','/api/tables')).body.tables;
  assert.equal(tables.find(t=>t.id===tc.id).orderId,null);
  assert.equal(tables.find(t=>t.id===ta.id).orderId,null);
  assert.ok(tables.find(t=>t.id===tb.id).orderId);
});

test('devolução integral auditada é única e não corrompe caixa anterior',async t=>{
  const {request}=await fixture(t),p=await product(request);
  await request('POST','/api/cash/open',command('open-refund',{openingCents:10000}));
  const a=(await request('POST','/api/orders',command('refund-order',{serviceMode:'counter'}))).body.order;
  await request('POST',`/api/orders/${a.id}/lines`,command('refund-line',{productId:p.id,quantity:2,expectedRevision:0}));
  await request('POST',`/api/orders/${a.id}/confirm`,command('refund-confirm',{expectedRevision:1}));
  const done=await request('POST',`/api/orders/${a.id}/close`,command('refund-pay',{expectedRevision:2,payments:[{method:'cash',amountCents:1000},{method:'pix',amountCents:2000}]}));
  assert.equal(done.status,200);
  assert.equal((await request('POST',`/api/orders/${a.id}/refund`,command('refund-no-external',{reason:'Erro no pedido'}))).status,409);
  const refund=await request('POST',`/api/orders/${a.id}/refund`,command('refund-yes',{reason:'Erro no pedido',externalRefundConfirmed:true}));
  assert.equal(refund.status,201,JSON.stringify(refund.body));
  assert.equal(refund.body.refund.cashCents,1000);
  assert.equal((await request('POST',`/api/orders/${a.id}/refund`,command('refund-duplicate',{reason:'Duplo',externalRefundConfirmed:true}))).status,409);
  assert.equal((await request('GET','/api/cash/current')).body.expectedCents,10000);
  const order=await request('GET',`/api/orders/${a.id}`);
  assert.equal(order.body.order.refunded,true);
});

test('rede LAN falha fechada sem certificado e token por perfil',()=>{
  assert.throws(()=>createApp({lan:{}}),/certificado|TLS/i);
});


test('cancelamento libera mesa e remove tickets pendentes do painel',async t=>{
  const {request}=await fixture(t),p=await product(request),tab=await table(request,'Mesa do cancelamento','cancel-tab');
  const order=(await request('POST',`/api/tables/${tab.id}/open`,command('cancel-open'))).body.order;
  await request('POST',`/api/orders/${order.id}/lines`,command('cancel-line',{expectedRevision:0,productId:p.id,quantity:1}));
  await request('POST',`/api/orders/${order.id}/confirm`,command('cancel-confirm',{expectedRevision:1}));
  assert.equal((await request('GET','/api/kitchen/tickets')).body.tickets.length,1);
  const canceled=await request('POST',`/api/orders/${order.id}/cancel`,command('cancel-action',{expectedRevision:2,reason:'Cliente desistiu'}));
  assert.equal(canceled.status,200,JSON.stringify(canceled.body));
  assert.equal((await request('GET','/api/kitchen/tickets')).body.tickets.length,0);
  const tableStatus=(await request('GET','/api/tables')).body.tables[0];
  assert.equal(tableStatus.orderId,null);
});
