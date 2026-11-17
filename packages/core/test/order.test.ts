import assert from 'node:assert/strict';
import test from 'node:test';
import { addOrderLine, cancelOrder, closeOrder, confirmOrder, createOrder, orderTotalCents } from '../src/order.ts';

const base = () => createOrder({ id: 'o-1', serviceMode: 'counter', createdAt: '2026-11-17T20:00:00Z' });
const burger = { id: 'line-1', productId: 'burger-1', productName: 'X-Burger', unitPriceCents: 1590, quantity: 2 };

test('cria pedido de balcão vazio e sem efeitos colaterais', () => {
  const order = base();
  assert.equal(order.status, 'DRAFT');
  assert.equal(order.revision, 0);
  assert.equal(orderTotalCents(order), 0);
  assert.deepEqual(order.lines, []);
});

test('adiciona item com preço congelado e retorna novo estado imutável', () => {
  const before = base();
  const after = addOrderLine(before, burger);
  assert.equal(orderTotalCents(after), 3180);
  assert.equal(after.revision, 1);
  assert.equal(before.lines.length, 0);
  assert.notEqual(after.lines[0], burger);
});

test('não admite quantidade fracionada, preço negativo ou ID de linha repetido', () => {
  assert.throws(() => addOrderLine(base(), { ...burger, quantity: 0 }), /quantidade/);
  assert.throws(() => addOrderLine(base(), { ...burger, quantity: 1.5 }), /quantidade/);
  assert.throws(() => addOrderLine(base(), { ...burger, unitPriceCents: -1 }), /preço/);
  assert.throws(() => addOrderLine(addOrderLine(base(), burger), burger), /duplicado/);
});

test('pedido exige itens antes de confirmar; somente total pago permite fechamento', () => {
  assert.throws(() => confirmOrder(base()), /vazio/);
  const open = confirmOrder(addOrderLine(base(), burger));
  assert.equal(open.status, 'OPEN');
  assert.throws(() => closeOrder(open, 3179), /pagamento/);
  const closed = closeOrder(open, 3180);
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.revision, 3);
  assert.throws(() => addOrderLine(closed, { ...burger, id: 'line-2' }), /encerrado/);
});

test('pedido cancelado não pode ser reaberto ou encerrado', () => {
  const cancelled = cancelOrder(base());
  assert.equal(cancelled.status, 'CANCELLED');
  assert.throws(() => confirmOrder(cancelled), /estado/);
  assert.throws(() => closeOrder(cancelled, 0), /estado/);
});

test('rejeita overflow de centavos para evitar divergência financeira', () => {
  const order = addOrderLine(base(), { ...burger, unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 2 });
  assert.throws(() => orderTotalCents(order), /limite/);
});
