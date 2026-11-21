import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptBytes} from '../src/non-fiscal-service.mjs';

test('comprovante ESC/POS é ASCII e deixa claro que não é fiscal',()=>{
 const bytes=receiptBytes({id:'pedido-123456',lines:[{id:'line-a1b2c3d4',quantity:1,productName:'Água',unitPriceCents:350,note:'',modifiers:[]}],totalCents:350});
 assert.equal(bytes[0],0x1b);
 assert.equal(bytes.at(-3),0x1d);
 const paper=bytes.toString('ascii');
 assert.match(paper,/NAO FISCAL/);
 assert.match(paper,/NAO SUBSTITUI DOCUMENTO FISCAL/);
 assert.match(paper,/Agua/);
 assert.match(paper,/3\.50/);
});

test('comprovante mostra referência persistente da linha e adicionais sem duplicar valor',()=>{
 const bytes=receiptBytes({id:'pedido-123456',lines:[
  {id:'linha-aaa11111',quantity:1,productName:'Pizza',unitPriceCents:5700,note:'Sem cebola',modifiers:[{name:'Borda recheada',priceCents:700}]},
  {id:'linha-bbb22222',quantity:2,productName:'Pizza',unitPriceCents:5000,note:'Bem passada',modifiers:[]}
 ],totalCents:15700});
 const paper=bytes.toString('ascii');
 assert.match(paper,/aaa11111/);
 assert.match(paper,/bbb22222/);
 assert.match(paper,/Borda recheada/);
 assert.match(paper,/Sem cebola/);
 assert.match(paper,/Bem passada/);
 assert.match(paper,/57\.00/);
 assert.match(paper,/100\.00/);
 assert.match(paper,/TOTAL R\$ 157\.00/);
 assert.doesNotMatch(paper,/164\.00/,'adicional já está no preço da linha, não pode ser somado outra vez');
});

test('nome comprido nunca corta subtotal no papel ESC/POS de 38 colunas',()=>{
 const bytes=receiptBytes({id:'pedido-long',lines:[{
   id:'linha-extensa',quantity:2,productName:'Hamburguer premium com queijo e molho especial',
   unitPriceCents:999999,note:'',modifiers:[]
 }],totalCents:1999998});
 const productLine=bytes.toString('ascii').split('\n').find(line=>line.startsWith('2x '));
 assert.ok(productLine);
 assert.ok(productLine.length<=38);
 assert.ok(productLine.endsWith('19999.98'),productLine);
});
