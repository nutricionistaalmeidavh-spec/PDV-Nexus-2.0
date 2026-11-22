import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessExistingWork,canCreateNewWork} from '../src/licenseUiPolicy.mjs';
import {createCommandIntentStore} from '../src/commandIntent.mjs';

test('P0: licença suspensa permite acesso a operações existentes sem autorizar novas vendas',()=>{
  assert.equal(canAccessExistingWork({required:true,active:false,reason:'SUSPENDED'}),true);
  assert.equal(canCreateNewWork({required:true,active:false,reason:'SUSPENDED'}),false);
  assert.equal(canAccessExistingWork({required:true,active:false,reason:'NOT_ACTIVATED'}),false);
  assert.equal(canCreateNewWork({required:false,active:false}),true);
  assert.equal(canCreateNewWork({required:true,active:true}),true);
});

test('P1: retry com payload idêntico mantém commandId e ignora ordem de chaves',()=>{
  let counter=0;
  const store=createCommandIntentStore(()=> 'cmd-'+(++counter));
  const first=store.reserve('order:o1/close',{expectedRevision:2,payments:[{method:'pix',amountCents:1500}]});
  const retry=store.reserve('order:o1/close',{payments:[{amountCents:1500,method:'pix'}],expectedRevision:2});
  assert.equal(first.commandId,retry.commandId);
  assert.equal(counter,1);
  const changed=store.reserve('order:o1/close',{expectedRevision:2,payments:[{method:'cash',amountCents:1500}]});
  assert.notEqual(changed.commandId,first.commandId);
});

test('P1: confirmação remove apenas a intenção respondida e outro pedido não herda seu ID',()=>{
  let i=0;
  const store=createCommandIntentStore(()=> 'cmd-'+(++i));
  const a=store.reserve('order:o1/close',{amountCents:500});
  const b=store.reserve('order:o2/close',{amountCents:500});
  assert.notEqual(a.commandId,b.commandId);
  store.ack(a);
  assert.equal(store.reserve('order:o2/close',{amountCents:500}).commandId,b.commandId);
  assert.notEqual(store.reserve('order:o1/close',{amountCents:500}).commandId,a.commandId);
});

test('P1: não reutiliza mesmo ID de uma intenção substituída e não cresce indefinidamente',()=>{
  let i=0;
  const store=createCommandIntentStore(()=> 'cmd-'+(++i),{maxPending:5});
  for(let j=0;j<30;j++)store.reserve('key-'+j,{j});
  assert.ok(store.pendingCount()<=5);
});
