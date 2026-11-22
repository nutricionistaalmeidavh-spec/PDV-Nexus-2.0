import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptBytes} from '../src/non-fiscal-service.mjs';

test('P3: comprovante não fiscal informa estabelecimento, data local, pagamento e troco sem recalcular total',()=>{
 const raw=receiptBytes({
  id:'order-abcdef01',orderNumber:42,kind:'RECEIPT',restaurantName:'Lanchonete São João',
  issuedAt:'2026-11-22T21:30:00.000Z',tableLabel:'Mesa 7',
  lines:[{id:'line1',quantity:1,productName:'Café',unitPriceCents:1200,modifiers:[]}],
  payments:[{method:'cash',amountCents:1200,tenderedCents:2000}],changeCents:800,totalCents:1200
 }).toString('ascii');
 assert.match(raw,/Lanchonete Sao Joao/);
 assert.match(raw,/22\/11\/2026/);
 assert.match(raw,/18:30/);
 assert.match(raw,/Mesa 7/);
 assert.match(raw,/Dinheiro: R\$ 12\.00/);
 assert.match(raw,/Troco R\$ 8\.00/);
 assert.match(raw,/TOTAL R\$ 12\.00/);
 assert.doesNotMatch(raw,/TOTAL R\$ 20\.00/);
});

test('P3: comprovantes legados sem metadados continuam imprimíveis',()=>{
 const raw=receiptBytes({id:'legacy-12345678',lines:[],totalCents:0}).toString('ascii');
 assert.match(raw,/RECIBO DE PEDIDO - NAO FISCAL/);
 assert.match(raw,/TOTAL R\$ 0\.00/);
});
