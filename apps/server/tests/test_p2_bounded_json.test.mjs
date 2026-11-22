import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedJson} from '../src/bounded-json.mjs';

test('P2: sincronização processa JSON pequeno por streaming sem serviço externo',async()=>{
 const value={unitId:'local',items:[1,2,3]};
 assert.deepEqual(await readBoundedJson(Response.json(value),{maxBytes:1000}),value);
});

test('P2: cabeçalho de peer acima do limite é recusado antes de ler o corpo',async()=>{
 const response=new Response(JSON.stringify({a:'x'}),{headers:{'content-length':'1000000'}});
 await assert.rejects(()=>readBoundedJson(response,{maxBytes:200}),/tamanho|limite|excede/i);
});

test('P2: resposta transferida em chunks não pode exceder limite máximo de bytes',async()=>{
 const body=new ReadableStream({start(controller){
  controller.enqueue(new Uint8Array(80).fill(97));
  controller.enqueue(new Uint8Array(80).fill(98));
  controller.close();
 }});
 await assert.rejects(()=>readBoundedJson(new Response(body),{maxBytes:120}),/limite|excede|tamanho/i);
});

test('P2: adapter de teste com json() continua limitado e JSON malformado nunca é aceito',async()=>{
 await assert.rejects(()=>readBoundedJson({headers:new Headers(),json:async()=>({a:'X'.repeat(500)})},{maxBytes:50}),/limite|excede|tamanho/i);
 await assert.rejects(()=>readBoundedJson(new Response('{invalid'),{maxBytes:100}),/JSON|inválido/i);
});
