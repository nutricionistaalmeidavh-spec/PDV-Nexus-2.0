import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';

async function fixture(t) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-hardening-'));
  const app=createApp({dataPath:path.join(folder,'nexus.db')});
  const origin=await app.listen({port:0});
  let cookie='';
  async function request(method,route,body,includeSession=true) {
    const headers=body?{'content-type':'application/json'}:{};
    if(includeSession && cookie)headers.cookie=cookie;
    const result=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
    const setCookie=result.headers.get('set-cookie');
    if(includeSession&&setCookie)cookie=setCookie.split(';')[0];
    return {status:result.status,body:await result.json()};
  }
  t.after(async()=>{await app.close();fs.rmSync(folder,{recursive:true,force:true});});
  return {app,origin,request};
}
const cmd=(id,params={})=>({commandId:'hard-'+id,...params});

test('sem operador local configurado, API de vendas e caixa permanece bloqueada',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('GET','/api/auth/status')).status,200);
  assert.equal((await request('GET','/api/products')).status,401);
  assert.equal((await request('POST','/api/orders',cmd('unauth-order',{serviceMode:'counter'}))).status,401);
  assert.equal((await request('GET','/api/exports/sales.json')).status,401);
  assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'123'})).status,400);
});

test('primeiro supervisor define credenciais, login e logout revogam sessao',async t=>{
  const {request}=await fixture(t);
  const setup=await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'});
  assert.equal(setup.status,201,JSON.stringify(setup.body));
  assert.equal((await request('GET','/api/products')).status,200);
  assert.equal((await request('POST','/api/auth/setup',{username:'segundo',password:'outraSenhaMuitoForte'})).status,409);
  assert.equal((await request('POST','/api/auth/logout',{})).status,200);
  assert.equal((await request('GET','/api/products')).status,401);
  assert.equal((await request('POST','/api/auth/login',{username:'admin',password:'senha-errada'})).status,401);
  assert.equal((await request('POST','/api/auth/login',{username:'admin',password:'senhaMuitoForte-2026'})).status,200);
  assert.equal((await request('GET','/api/products')).status,200);
});

test('credenciais persistem apos reinicio mas sessao anterior expira',async t=>{
  const {app,request,origin}=await fixture(t);
  assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
  const cookieFetch=await fetch(origin+'/api/auth/status');
  assert.equal(cookieFetch.status,200);
  await app.close();
  assert.equal((await request('GET','/api/products')).status,401);
});

test('categorias e produtos possuem CRUD com arquivamento sem perder historico',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
  const category=await request('POST','/api/categories',cmd('cat-new',{name:'Hambúrgueres'}));
  assert.equal(category.status,201,JSON.stringify(category.body));
  const id=category.body.category.id;
  assert.equal((await request('GET','/api/categories')).body.categories.some(x=>x.id===id),true);
  const product=await request('POST','/api/products',cmd('product-new',{name:'X-Filé',priceCents:1850,categoryId:id}));
  assert.equal(product.status,201,JSON.stringify(product.body));
  const changed=await request('PATCH','/api/categories/'+id,cmd('cat-edit',{name:'Lanches quentes'}));
  assert.equal(changed.status,200);
  const archived=await request('PATCH','/api/products/'+product.body.product.id,cmd('product-archive',{active:false}));
  assert.equal(archived.status,200,JSON.stringify(archived.body));
  assert.equal((await request('GET','/api/products')).body.products.find(x=>x.id===product.body.product.id).active,0);
  assert.equal((await request('DELETE','/api/categories/'+id,cmd('cat-remove'))).status,405);
  const deactivate=await request('POST','/api/categories/'+id+'/archive',cmd('cat-archive'));
  assert.equal(deactivate.status,200,JSON.stringify(deactivate.body));
  assert.equal((await request('GET','/api/categories')).body.categories.find(x=>x.id===id).active,0);
});

test('caixa local exige papel habilitado, enquanto operador gerente gerencia usuarios',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'})).status,201);
  const created=await request('POST','/api/auth/operators',cmd('cashier-create',{username:'caixa1',password:'outraSenhaForte-2026',role:'cashier'}));
  assert.equal(created.status,201,JSON.stringify(created.body));
  await request('POST','/api/auth/logout',{});
  assert.equal((await request('POST','/api/auth/login',{username:'caixa1',password:'outraSenhaForte-2026'})).status,200);
  assert.equal((await request('GET','/api/categories')).status,200);
  assert.equal((await request('POST','/api/auth/operators',cmd('bad-user',{username:'intruso',password:'senhA123456',role:'admin'}))).status,403);
  assert.equal((await request('POST','/api/printer',cmd('bad-printer',{host:'192.168.1.3',port:9100}))).status,403);
  assert.equal((await request('POST','/api/cash/open',cmd('open-cash',{openingCents:0}))).status,201);
});
