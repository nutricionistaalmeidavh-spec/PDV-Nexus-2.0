import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('P2: salão, KDS, garçom e divisão usam Mantine com ações canônicas',()=>{
 const source=read('../src/RestaurantTangerine.jsx');
 const app=read('../src/App.jsx');
 for(const name of ['RestaurantTables','RestaurantKitchen','RestaurantWaiter','RestaurantSplit'])
  assert.match(source,new RegExp('export function '+name+'\\('));
 for(const label of ['Mapa do salão','Painel KDS','Garçom mobile','Fechamento de mesa','Nova mesa','Abrir comanda','Iniciar preparo','Marcar como pronto','Entregar'])
  assert.ok(source.includes(label),'Faltou: '+label);
 for(const selector of ['table-card','kds-ticket','phone-preview','tables-grid','phone-products'])
  assert.ok(source.includes(selector),'Seletor legado requerido para QA: '+selector);
 assert.match(source,/onUpdate\(ticket,group.next\)/);
 assert.match(source,/onOpenTable\(target\)/);
 assert.match(app,/RestaurantTables as Tables/);
 assert.match(app,/RestaurantKitchen as Kitchen/);
 assert.match(app,/RestaurantWaiter as Waiter/);
 assert.match(app,/RestaurantSplit as Split/);
});
test('P2: comanda continua com revisão/commandId, KDS e rateio sem pagamentos inventados',()=>{
 const source=read('../src/TableOrderPanel.jsx');
 assert.match(source,/expectedRevision:order.revision/);
 assert.match(source,/commandId:uuid\(\)/);
 for(const fragment of ['/confirm','/lines','/transfer-table','/split','onCheckout\(order\)','Adicionar à comanda','Confirmar e enviar à cozinha']){
  assert.ok(source.includes(fragment),'Fluxo ausente: '+fragment);
 }
 assert.match(source,/from '@mantine\/core'/);
});
test('P3: DataTable e gráficos usam APIs financeiras e estoque canônicas e custos locais',()=>{
 const source=read('../src/ManagementTangerine.jsx');
 const business=read('../src/BusinessPanels.jsx');
 for(const value of ['DataTable','FinancialTrend','FinancialPayments','StockLedger','EmptyChart']){
  assert.ok(source.includes(value),'Componente gestão ausente '+value);
 }
 assert.match(source,/@mantine\/charts/);
 assert.match(source,/mantine-datatable/);
 assert.match(business,/\/api\/reports\/financial/);
 assert.match(business,/\/api\/stock\/ingredients/);
 assert.match(business,/FinancialTrend/);
 assert.match(business,/StockLedger/);
 assert.doesNotMatch(source,/fetch\s*\(|localStorage|setInterval\s*\(/);
});
