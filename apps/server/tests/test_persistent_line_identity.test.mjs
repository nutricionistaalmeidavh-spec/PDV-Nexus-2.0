import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.mjs';

async function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-line-identity-'));
  const app=createApp({dataPath:path.join(dir,'local.db')});
  const origin=await app.listen({port:0});
  let cookie='';
  const request=async(method,route,body)=>{
    const headers=body?{'content-type':'application/json'}:{};
    if(cookie)headers.cookie=cookie;
    const res=await fetch(origin+route,{method,headers,body:body?JSON.stringify(body):undefined});
    const session=res.headers.get('set-cookie');
    if(session)cookie=session.split(';')[0];
    return {status:res.status,body:await res.json()};
  };
  const setup=await request('POST','/api/auth/setup',{username:'admin',password:'senhaMuitoForte-2026'});
  assert.equal(setup.status,201);
  t.after(async()=>{await app.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {request};
}
const cmd=(id,fields={})=>({commandId:'identity-'+id,...fields});
const must=async(request,method,route,body,status=200)=>{
  const response=await request(method,route,body);
  assert.equal(response.status,status,JSON.stringify(response.body));
  return response.body;
};

test('identidade persistente por linha preserva produto, adicional, preço e KDS em pedido misto',async t=>{
  const {request}=await fixture(t);
  const burger=(await must(request,'POST','/api/products',cmd('burger',{name:'X-Burger',priceCents:2500}),201)).product;
  const pizza=(await must(request,'POST','/api/products',cmd('pizza',{name:'Pizza',priceCents:5000}),201)).product;
  const soda=(await must(request,'POST','/api/products',cmd('soda',{name:'Refrigerante',priceCents:800}),201)).product;
  const cheese=(await must(request,'POST',`/api/products/${burger.id}/modifiers`,cmd('cheese',{name:'Queijo extra',priceCents:350}),201)).modifier;
  const border=(await must(request,'POST',`/api/products/${pizza.id}/modifiers`,cmd('border',{name:'Borda recheada',priceCents:700}),201)).modifier;
  const order=(await must(request,'POST','/api/orders',cmd('order',{serviceMode:'counter'}),201)).order;
  const inputs=[
    {productId:soda.id,quantity:1,note:'Gelado',modifierIds:[]},
    {productId:pizza.id,quantity:2,note:'Sem cebola',modifierIds:[border.id]},
    {productId:burger.id,quantity:1,note:'Sem tomate',modifierIds:[cheese.id]},
    {productId:pizza.id,quantity:1,note:'Bem passada',modifierIds:[]}
  ];
  let current=order;
  const identities=[];
  for(const [index,item] of inputs.entries()){
    const payload=cmd('line-'+index,{expectedRevision:current.revision,...item});
    const response=await must(request,'POST',`/api/orders/${order.id}/lines`,payload);
    current=response.order;
    const inserted=current.lines.at(-1);
    assert.ok(inserted.id,'cada linha precisa de ID');
    assert.equal(inserted.productId,item.productId);
    identities.push(inserted.id);
    const retry=await must(request,'POST',`/api/orders/${order.id}/lines`,payload);
    assert.deepEqual(retry.order.lines.map(line=>line.id),current.lines.map(line=>line.id),'retry idempotente não cria nova linha');
  }
  assert.equal(new Set(identities).size,inputs.length,'produtos repetidos precisam de IDs de linha diferentes');
  assert.equal(current.totalCents,800+2*(5000+700)+(2500+350)+5000);
  const expected=new Map(identities.map((id,index)=>[id,{
    productId:inputs[index].productId,
    quantity:inputs[index].quantity,
    note:inputs[index].note,
    modifierNames:index===1?['Borda recheada']:index===2?['Queijo extra']:[],
    unitPriceCents:[800,5700,2850,5000][index]
  }]));
  const check=lines=>{
    assert.equal(lines.length,expected.size);
    for(const line of [...lines].reverse()){
      const value=expected.get(line.id);
      assert.ok(value,`ID de linha inesperado: ${line.id}`);
      assert.equal(line.productId,value.productId);
      assert.equal(line.quantity,value.quantity);
      assert.equal(line.note,value.note);
      assert.equal(line.unitPriceCents,value.unitPriceCents);
      assert.deepEqual(line.modifiers.map(mod=>mod.name),value.modifierNames);
    }
  };
  check(current.lines);
  const fetched=(await must(request,'GET',`/api/orders/${order.id}`)).order;
  check(fetched.lines);
  const confirmed=(await must(request,'POST',`/api/orders/${order.id}/confirm`,cmd('confirm',{expectedRevision:fetched.revision}))).order;
  check(confirmed.lines);
  const tickets=(await must(request,'GET','/api/kitchen/tickets')).tickets;
  assert.equal(tickets.length,expected.size);
  assert.deepEqual(new Set(tickets.map(ticket=>ticket.lineId)),new Set(identities));
  for(const ticket of tickets){
    const expectedLine=expected.get(ticket.lineId);
    assert.ok(expectedLine);
    assert.equal(ticket.note,expectedLine.note);
    assert.equal(ticket.modifiers||'',expectedLine.modifierNames.join(', '));
  }
  const retryConfirm=await must(request,'POST',`/api/orders/${order.id}/confirm`,cmd('confirm',{expectedRevision:fetched.revision}));
  check(retryConfirm.order.lines);
  assert.equal((await must(request,'GET','/api/kitchen/tickets')).tickets.length,expected.size);
});

test('adicional de outro produto é rejeitado sem alterar linhas persistidas',async t=>{
  const {request}=await fixture(t);
  const first=(await must(request,'POST','/api/products',cmd('p1',{name:'Lanche',priceCents:1200}),201)).product;
  const second=(await must(request,'POST','/api/products',cmd('p2',{name:'Suco',priceCents:600}),201)).product;
  const modifier=(await must(request,'POST',`/api/products/${first.id}/modifiers`,cmd('extra',{name:'Bacon',priceCents:400}),201)).modifier;
  const order=(await must(request,'POST','/api/orders',cmd('new',{serviceMode:'counter'}),201)).order;
  const rejected=await request('POST',`/api/orders/${order.id}/lines`,cmd('invalid',{expectedRevision:0,productId:second.id,quantity:1,modifierIds:[modifier.id]}));
  assert.equal(rejected.status,400);
  const fetched=(await must(request,'GET',`/api/orders/${order.id}`)).order;
  assert.equal(fetched.lines.length,0);
  assert.equal(fetched.revision,0);
});
