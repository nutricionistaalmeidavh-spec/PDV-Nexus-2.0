import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lanRole,roleAllows,validateLanConfig} from '../src/lan-security.mjs';
const hash=s=>createHash('sha256').update(s).digest();
const waiterToken='w'.repeat(64),kitchenToken='k'.repeat(64),managerToken='m'.repeat(64);
const cfg={digests:[{role:'waiter',hash:hash(waiterToken)},{role:'kitchen',hash:hash(kitchenToken)},{role:'manager',hash:hash(managerToken)}]};
const req=(token,address='192.168.1.23')=>({headers:{host:'192.168.1.1:3434',authorization:token?'Bearer '+token:undefined},socket:{remoteAddress:address}});
test('token LAN é exigido em dispositivos remotos e negado quando incorreto',()=>{
  assert.equal(lanRole(req(null),cfg),null);
  assert.equal(lanRole(req('abc'),cfg),null);
  assert.equal(lanRole(req(waiterToken),cfg),'waiter');
  assert.equal(lanRole(req(kitchenToken),cfg),'kitchen');
  assert.equal(lanRole(req(managerToken),cfg),'manager');
});
test('perfil garçom não acessa caixa, impressão ou status cozinha',()=>{
  assert.equal(roleAllows('waiter','GET','/api/tables'),true);
  assert.equal(roleAllows('waiter','POST','/api/tables/abc/open'),true);
  assert.equal(roleAllows('waiter','POST','/api/orders/abc/lines'),true);
  assert.equal(roleAllows('waiter','GET','/api/cash/current'),false);
  assert.equal(roleAllows('waiter','POST','/api/cash/close'),false);
  assert.equal(roleAllows('waiter','POST','/api/kitchen/tickets/abc/status'),false);
  assert.equal(roleAllows('waiter','POST','/api/orders/abc/refund'),false);
});
test('perfil cozinha não consegue criar ou pagar pedidos',()=>{
  assert.equal(roleAllows('kitchen','GET','/api/kitchen/tickets'),true);
  assert.equal(roleAllows('kitchen','POST','/api/kitchen/tickets/abc/status'),true);
  assert.equal(roleAllows('kitchen','GET','/api/orders'),false);
  assert.equal(roleAllows('kitchen','POST','/api/orders/abc/close'),false);
});
test('rede LAN sem TLS e configuração explícita é rejeitada',()=>{
  assert.equal(validateLanConfig(null),null);
  assert.throws(()=>validateLanConfig({certPath:'/nonexistent',keyPath:'/nonexistent',tokens:{waiter:waiterToken}}),/não encontrado/);
  assert.throws(()=>validateLanConfig({tokens:{waiter:'123'}}),/TLS/);
});
