import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationLinks,titleOf,availableNavLinks} from '../src/navigation.mjs';

test('P3: menu completo mantém IDs únicos e rotas já conhecidas',()=>{
 const ids=navigationLinks.map(([id])=>id);
 assert.equal(new Set(ids).size,ids.length);
 for(const id of ['venda','pedidos','mesas','kds','garcom','divisao','caixa','sistema'])assert.ok(ids.includes(id));
 assert.equal(titleOf('venda'),'Nova venda');
});
test('P3: navegação do caixa limita gestão; dispositivo pareado permanece isolado',()=>{
 const cashier=availableNavLinks('live','',{role:'cashier'}).map(([id])=>id);
 assert.ok(cashier.includes('venda'));assert.ok(cashier.includes('pedidos'));
 assert.ok(!cashier.includes('financeiro'));assert.ok(!cashier.includes('usuarios'));
 const kitchen=availableNavLinks('paired','kitchen',{role:'kitchen'}).map(([id])=>id);
 assert.deepEqual(kitchen,['kds']);
 const waiter=availableNavLinks('paired','waiter',{role:'waiter'}).map(([id])=>id);
 assert.deepEqual(waiter,['garcom','atendimento','divisao']);
 const admin=availableNavLinks('live','',{role:'admin'}).map(([id])=>id);
 assert.ok(admin.includes('financeiro'));assert.ok(admin.includes('usuarios'));
 assert.ok(admin.includes('inteligencia'));
 assert.ok(!cashier.includes('inteligencia'));
});
