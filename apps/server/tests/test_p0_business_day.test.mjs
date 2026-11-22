import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {businessDay,sqlBusinessDay,sqlBusinessHour} from '../src/business-day.mjs';

test('P0: hora após 21h no Brasil permanece no dia operacional local',()=>{
  assert.equal(businessDay('2026-11-23T00:30:00.000Z'),'2026-11-22');
  assert.equal(businessDay('2026-11-23T02:59:59.999Z'),'2026-11-22');
  assert.equal(businessDay('2026-11-23T03:00:00.000Z'),'2026-11-23');
  const db=new DatabaseSync(':memory:');
  try{
    const sql=`SELECT ${sqlBusinessDay('?')} AS day, ${sqlBusinessHour('?')} AS hour`;
    const r=db.prepare(sql).get('2026-11-23T00:30:00.000Z','2026-11-23T00:30:00.000Z');
    assert.equal(r.day,'2026-11-22');
    assert.equal(r.hour,'21');
  }finally{db.close();}
});

test('P0: financeiro, margem, exportação, BI e resumo concordam sobre venda 21h30 Brasil',async t=>{
  const fs=await import('node:fs');
  const os=await import('node:os');
  const path=await import('node:path');
  const {openDatabase}=await import('../src/db.mjs');
  const {financialRead}=await import('../src/retail-finance.mjs');
  const {buildSalesDocument}=await import('../src/sales-export.mjs');
  const {localSummary}=await import('../src/multiunit-sync.mjs');
  const {businessIntelligenceRead}=await import('../src/management-intelligence.mjs');
  const {inventoryRead}=await import('../src/inventory.mjs');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-businessday-'));
  const db=openDatabase(path.join(folder,'nexus.db'));
  t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
  const closedAt='2026-11-23T00:30:00.000Z';
  db.prepare("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES('tz-p','c-default','Venda noturna',1500)").run();
  db.prepare("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,created_at,closed_at) VALUES('tz-o','r-local','t-local','counter','CLOSED',?,?)").run(closedAt,closedAt);
  db.prepare("INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES('tz-l','tz-o','tz-p','Venda noturna',1500,1)").run();
  db.prepare("INSERT INTO payment(id,order_id,method,amount_cents,state,created_at) VALUES('tz-pay','tz-o','pix',1500,'CONFIRMED',?)").run(closedAt);
  const date=new URLSearchParams('from=2026-11-22&to=2026-11-22');
  const report=financialRead(db,'GET','/api/reports/financial',date);
  assert.equal(report.body.orders,1);
  assert.equal(report.body.byDay[0].day,'2026-11-22');
  assert.equal(buildSalesDocument(db,date).sales.length,1);
  assert.equal(localSummary(db)[0].day,'2026-11-22');
  const margin=inventoryRead(db,'GET','/api/reports/margin',date,{bad:message=>{throw Error(message)}});
  assert.equal(margin.body.orders,1);
  const dashboard=businessIntelligenceRead(db,'GET','/api/bi/dashboard',date);
  assert.equal(dashboard.status,200,JSON.stringify(dashboard.body));
  assert.equal(dashboard.body.totals.orders,1);
  assert.equal(dashboard.body.byHour[0].hour,'21');
  assert.equal(financialRead(db,'GET','/api/reports/financial',new URLSearchParams('from=2026-11-23&to=2026-11-23')).body.orders,0);
});
