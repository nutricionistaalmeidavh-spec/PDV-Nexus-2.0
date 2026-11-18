import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdv-nexus-'));
  const app = createApp({ dataPath: path.join(dir, 'pos.db') });
  const origin = await app.listen({ port: 0 });
  const request = async (method, route, body) => {
    const response = await fetch(origin + route, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, app, request };
}

async function setupProduct(request) {
  const r = await request('POST', '/api/products', { name: 'X-salada', priceCents: 1590, commandId: 'product-a' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.product;
}
async function setupOrder(request, product, id = 'order-a') {
  const a = await request('POST', '/api/orders', { commandId: id, serviceMode: 'counter' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const idOrder = a.body.order.id;
  const b = await request('POST', `/api/orders/${idOrder}/lines`, { commandId: `${id}-add`, expectedRevision: 0, productId: product.id, quantity: 2 });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const c = await request('POST', `/api/orders/${idOrder}/confirm`, { commandId: `${id}-confirm`, expectedRevision: 1 });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  return c.body.order;
}

test('catálogo persistente após reiniciar e backup consistente', async (t) => {
  const { dir, app, request } = await fixture(t);
  const product = await setupProduct(request);
  assert.equal((await request('GET', '/api/products')).body.products[0].id, product.id);
  const backup = await app.backup(path.join(dir, 'backup.db'));
  assert.ok(fs.statSync(backup).size > 1000);
  await app.close();
  const reloaded = createApp({ dataPath: path.join(dir, 'pos.db') });
  const restartOrigin = await reloaded.listen({ port: 0 });
  const response = await fetch(restartOrigin + '/api/products').then(r => r.json());
  assert.equal(response.products[0].name, 'X-salada');
  await reloaded.close();
});

test('pedido possui comandos idempotentes, snapshot e conflito de revisão', async (t) => {
  const { request } = await fixture(t);
  const product = await setupProduct(request);
  const create = { commandId: 'order-1', serviceMode: 'counter' };
  const a = await request('POST', '/api/orders', create);
  const again = await request('POST', '/api/orders', create);
  assert.deepEqual(again.body, a.body);
  assert.equal((await request('POST', '/api/orders', { ...create, serviceMode: 'takeaway' })).status, 409);
  const id = a.body.order.id;
  const line = { commandId: 'line-1', expectedRevision: 0, productId: product.id, quantity: 2 };
  const added = await request('POST', `/api/orders/${id}/lines`, line);
  assert.equal(added.body.order.totalCents, 3180);
  assert.deepEqual((await request('POST', `/api/orders/${id}/lines`, line)).body, added.body);
  assert.equal((await request('POST', `/api/orders/${id}/lines`, { ...line, commandId: 'line-2' })).status, 409);
  await request('PATCH', `/api/products/${product.id}`, { name: 'X-salada premium', priceCents: 3000, commandId: 'edit-1' });
  assert.equal((await request('GET', `/api/orders/${id}`)).body.order.totalCents, 3180);
});

test('pagamento, troco e fechamento de caixa sem duplicar venda', async (t) => {
  const { request } = await fixture(t);
  const product = await setupProduct(request);
  const open = await request('POST', '/api/cash/open', { commandId: 'cash-open', openingCents: 10000 });
  assert.equal(open.status, 201);
  const order = await setupOrder(request, product);
  const body = { commandId: 'settle-1', expectedRevision: 2, payments: [ { method: 'cash', amountCents: 3180, tenderedCents: 4000 } ] };
  const closed = await request('POST', `/api/orders/${order.id}/close`, body);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.changeCents, 820);
  assert.equal(closed.body.order.status, 'CLOSED');
  assert.deepEqual((await request('POST', `/api/orders/${order.id}/close`, body)).body, closed.body);
  assert.equal((await request('POST', `/api/orders/${order.id}/close`, { ...body, commandId: 'settle-2' })).status, 409);
  const supply = await request('POST', '/api/cash/movements', { commandId: 'supply-1', kind: 'SUPPLY', amountCents: 500 });
  assert.equal(supply.status, 201);
  const cash = await request('GET', '/api/cash/current');
  assert.equal(cash.body.expectedCents, 13680);
  const c = await request('POST', '/api/cash/close', { commandId: 'cash-close', countedCents: 13680 });
  assert.equal(c.status, 200);
  assert.equal(c.body.differenceCents, 0);
});

test('impressão falha sem desfazer venda e emissor fiscal não existe', async (t) => {
  const { request } = await fixture(t);
  const product = await setupProduct(request);
  await request('POST', '/api/cash/open', { commandId: 'cash-open-2', openingCents: 0 });
  const order = await setupOrder(request, product, 'order-b');
  const finalize = await request('POST', `/api/orders/${order.id}/close`, { commandId: 'settle-2', expectedRevision: 2, payments: [{method:'pix', amountCents:3180}] });
  assert.equal(finalize.body.order.status, 'CLOSED');
  assert.equal((await request('GET', '/api/print/jobs')).body.jobs.length, 1);
  assert.equal((await request('POST', '/api/print/jobs/bogus/send', { host: '127.0.0.1', port: 9100 })).status, 404);
  const blocked = await request('POST', `/api/fiscal/orders/${order.id}/issue`, { commandId: 'fiscal-1' });
  assert.equal(blocked.status, 404);
  assert.equal(blocked.body.code, 'NOT_FOUND');
  assert.equal((await request('GET', `/api/orders/${order.id}`)).body.order.status, 'CLOSED');
});

test('não aceita acesso cross-origin, comandos sem ID ou POST sem JSON', async(t)=>{
  const {request,app} = await fixture(t);
  assert.equal((await request('POST', '/api/products', {name:'x', priceCents:100})).status,400);
  const foreign=await fetch(app.origin+'/api/products',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:JSON.stringify({commandId:'a', name:'x', priceCents:100})});
  assert.equal(foreign.status,403);
  const malformed=await fetch(app.origin+'/api/products',{method:'POST',headers:{'content-type':'text/plain'},body:'123'});
  assert.equal(malformed.status,415);
});

test('restauração offline restaura catálogo, preservando cópia anterior', async t => {
  const {dir,app,request} = await fixture(t);
  await setupProduct(request);
  const backup = await app.backup(path.join(dir,'safe-backup.db'));
  await request('POST','/api/products',{commandId:'second-prod',name:'Suco',priceCents:800});
  await app.close();
  const {restoreBackup} = await import('../src/restore.mjs');
  const result = restoreBackup(backup,path.join(dir,'pos.db'));
  assert.ok(result.previous);
  const reopened=createApp({dataPath:path.join(dir,'pos.db')});
  const origin=await reopened.listen({port:0});
  const names=(await fetch(origin+'/api/products').then(r=>r.json())).products.map(p=>p.name);
  assert.deepEqual(names,['X-salada']);
  await reopened.close();
});

test('impressão ESC/POS TCP envia bytes apenas uma vez após confirmação', async t => {
  const net=await import('node:net');
  let received=Buffer.alloc(0);
  const printer=net.createServer(socket=>socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);}));
  await new Promise(resolve=>printer.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>printer.close(resolve)));
  const {request} = await fixture(t);
  const product=await setupProduct(request);
  await request('POST','/api/cash/open',{commandId:'cash-for-print',openingCents:0});
  const order=await setupOrder(request,product,'print-order');
  const finalized=await request('POST',`/api/orders/${order.id}/close`,{commandId:'pay-print',expectedRevision:2,payments:[{method:'cash',amountCents:3180}]});
  assert.equal(finalized.status,200);
  const port=printer.address().port;
  assert.equal((await request('POST','/api/printer',{commandId:'printer-setting',host:'127.0.0.1',port})).status,200);
  const id=(await request('GET','/api/print/jobs')).body.jobs[0].id;
  const sent=await request('POST',`/api/print/jobs/${id}/send`,{});
  assert.equal(sent.status,200,JSON.stringify(sent.body));
  assert.ok(received.includes(Buffer.from('NAO FISCAL')));
  assert.equal((await request('POST',`/api/print/jobs/${id}/send`,{})).status,409);
});

test('modo invalido e rejeitado, mas o operacional nao requer emissor fiscal', () => {
  assert.throws(()=>createApp({operationMode:'fiscal'}),/Modo de operacao invalido/);
});

test('rejeita encerramento de pedido sem caixa e pagamentos incorretos',async t=>{
  const {request}=await fixture(t);
  const product=await setupProduct(request);
  const order=await setupOrder(request,product,'no-cash');
  const url=`/api/orders/${order.id}/close`;
  const body={commandId:'invalid-checkout',expectedRevision:2,payments:[{method:'cash',amountCents:3180}]};
  assert.equal((await request('POST',url,body)).status,409);
  await request('POST','/api/cash/open',{commandId:'open-for-validation',openingCents:0});
  assert.equal((await request('POST',url,body)).status,200);
  assert.equal((await request('POST',url,{...body,commandId:'no-replay'})).status,409);
});
