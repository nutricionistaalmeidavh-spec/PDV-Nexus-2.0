import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, formatMoney, splitEvenly, paymentDraft, appendDemoLine, DEMO_ORDER } from '../src/model.mjs';

test('converte reais para centavos sem float e rejeita valores incorretos', () => {
  assert.equal(parseMoney('19,90'),1990);
  assert.equal(parseMoney('1.234,56'),123456);
  assert.equal(parseMoney('0'),0);
  assert.throws(()=>parseMoney('-1'),/inválido/);
  assert.throws(()=>parseMoney('1,999'),/inválido/);
});

test('formata centavos e faz divisão por pessoa sem perder um centavo', () => {
  assert.equal(formatMoney(1299),'R$ 12,99');
  assert.deepEqual(splitEvenly(1000,3),[334,333,333]);
  assert.throws(()=>splitEvenly(1000,0));
});

test('pagamento calculado não inventa liquidação nem aceita dinheiro insuficiente', () => {
  assert.equal(paymentDraft(2590,'cash',3000).changeCents,410);
  assert.throws(()=>paymentDraft(2590,'cash',2500),/insuficiente/);
  assert.deepEqual(paymentDraft(2590,'pix',0).payments,[{method:'pix',amountCents:2590}]);
});

test('pedido fictício usa cópias imutáveis e total canônico', () => {
  const before={...DEMO_ORDER,lines:[]};
  const added=appendDemoLine(before,{id:'p1',name:'X-Burger',priceCents:2490},2);
  assert.equal(before.lines.length,0);
  assert.equal(added.totalCents,4980);
  assert.equal(added.lines[0].quantity,2);
  assert.notEqual(before,added);
});

test('ilustrações são arquivos locais e produtos desconhecidos usam fallback', async () => {
  const {foodAsset}=await import('../src/media.mjs');
  assert.equal(foodAsset({id:'xburger',name:'X-Burger'}),'/ui/assets/xburger.png');
  assert.equal(foodAsset({id:'outro',name:'Produto novo'}),null);
});
