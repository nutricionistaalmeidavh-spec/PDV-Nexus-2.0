import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase,latestSchemaVersion} from '../src/db.mjs';
import {inspectBackup} from '../src/restore.mjs';
import {kitchenRead} from '../src/kitchen-service.mjs';
import {allowedOperator} from '../src/operator-auth.mjs';
import {mayFinishExistingOperation} from '../src/license-operation-policy.mjs';
import {roleAllows} from '../src/lan-security.mjs';

test('P0: cashier pode enviar comprovantes sem poder configurar impressora',()=>{
  assert.equal(allowedOperator('cashier','POST','/api/print/jobs/job/send'),true);
  assert.equal(allowedOperator('cashier','GET','/api/printer'),true);
  assert.equal(allowedOperator('cashier','POST','/api/printer'),false);
  assert.equal(allowedOperator('cashier','POST','/api/print/jobs/job/reprint'),true);
});

test('P0: versão do schema segue as migrações em disco; backup atual é aceito',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-migration-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const location=path.join(folder,'nexus.db');
  const db=openDatabase(location);
  const current=db.prepare('SELECT MAX(version) AS n FROM schema_migrations').get().n;
  assert.equal(latestSchemaVersion(),current);
  db.close();
  const backup=inspectBackup(location);
  assert.equal(backup.compatible,true);
  assert.equal(backup.schemaVersion,current);
});

test('P0: KDS prioriza tickets novos ativos mesmo acima de 200 pendências antigas',t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-kds-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const db=openDatabase(path.join(folder,'nexus.db'));
  t.after(()=>db.close());
  const productId=randomUUID();
  db.prepare("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES(?,'c-default','Produto',100)").run(productId);
  const addOrder=db.prepare("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_table_id,service_mode,status,revision,created_at) VALUES(?,'r-local','t-local',NULL,'counter','OPEN',0,?)");
  const addLine=db.prepare('INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES(?,?,?,\'Produto\',100,1)');
  const addTicket=db.prepare("INSERT INTO kitchen_ticket(id,order_id,line_id,status,revision,created_at,updated_at) VALUES(?,?,?,'PENDING',0,?,?)");
  let newest;
  for(let i=0;i<210;i++){
    const orderId=randomUUID(),lineId=randomUUID(),ticketId=randomUUID(),when=new Date(Date.UTC(2026,0,1,0,0,i)).toISOString();
    addOrder.run(orderId,when);
    addLine.run(lineId,orderId,productId);
    addTicket.run(ticketId,orderId,lineId,when,when);
    newest=ticketId;
  }
  const result=kitchenRead(db,'GET','/api/kitchen/tickets',{},new URLSearchParams());
  assert.equal(result.status,200);
  assert.equal(result.body.tickets[0].id,newest);
  assert.equal(result.body.tickets.length,200);
  assert.equal(result.body.hasMore,true);
});

test('P0: supervisor gerencia operadores, revoga sessao e protege ultimo administrador',async t=>{
  const {createApp}=await import('../src/server.mjs');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-users-'));
  const app=createApp({dataPath:path.join(folder,'nexus.db')});
  const origin=await app.listen({port:0});
  t.after(async()=>{await app.close();fs.rmSync(folder,{force:true,recursive:true});});
  let cookie='';
  const req=async(method,route,body,useCookie=true)=>{
    const response=await fetch(origin+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(useCookie&&cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    const session=response.headers.get('set-cookie');
    if(useCookie&&session)cookie=session.split(';')[0];
    return {status:response.status,body:await response.json()};
  };
  assert.equal((await req('POST','/api/auth/setup',{username:'admin',password:'senhaForteParaTestes2026'})).status,201);
  const employee=await req('POST','/api/auth/operators',{username:'caixa01',password:'senhaInicialValida123',role:'cashier'});
  assert.equal(employee.status,201);
  const id=employee.body.user.id;
  const users=await req('GET','/api/auth/operators');
  assert.equal(users.status,200);
  assert.equal(users.body.users.some(u=>u.id===id&&u.role==='cashier'),true);
  const adm=users.body.users.find(u=>u.username==='admin');
  assert.equal((await req('PATCH','/api/auth/operators/'+adm.id,{enabled:false})).status,409);
  assert.equal((await req('POST','/api/auth/operators/'+id+'/password',{password:'novaSenhaForte12345'})).status,200);
  assert.equal((await req('PATCH','/api/auth/operators/'+id,{enabled:false})).status,200);
  assert.equal((await req('POST','/api/auth/logout',{})).status,200);
  assert.equal((await req('POST','/api/auth/login',{username:'caixa01',password:'novaSenhaForte12345'})).status,401);
});

test('P0: backup automático validado preserva versões recentes e rotaciona somente seus próprios arquivos',async t=>{
  const {createAutomaticBackupScheduler}=await import('../src/backup-scheduler.mjs');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-autobackup-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const database=path.join(folder,'nexus.db');
  const db=openDatabase(database);
  t.after(()=>db.close());
  let now=1_800_000_000_000;
  const jobs=createAutomaticBackupScheduler(db,database,{now:()=>now,retention:2,intervalMs:60_000});
  const manual=path.join(folder,'backups','manual-user.sqlite');
  fs.mkdirSync(path.dirname(manual),{recursive:true});
  fs.writeFileSync(manual,'preserve');
  const first=await jobs.runOnce();
  assert.equal(inspectBackup(first).compatible,true);
  assert.equal(await jobs.runOnce(),null,'intervalo mínimo evita duplicar snapshots');
  now+=60_001;
  await jobs.runOnce();
  now+=60_001;
  const third=await jobs.runOnce();
  const autos=fs.readdirSync(path.join(folder,'backups')).filter(x=>x.startsWith('auto-'));
  assert.equal(autos.length,2);
  assert.equal(fs.existsSync(third),true);
  assert.equal(fs.existsSync(manual),true);
});

test('P0: vencimento comercial preserva fechamento e execução de pedidos já iniciados',()=>{
  assert.equal(mayFinishExistingOperation('POST','/api/orders/abc/close'),true);
  assert.equal(mayFinishExistingOperation('POST','/api/orders/abc/payments/partial'),true);
  assert.equal(mayFinishExistingOperation('POST','/api/cash/close'),true);
  assert.equal(mayFinishExistingOperation('POST','/api/kitchen/tickets/abc/status'),true);
  assert.equal(mayFinishExistingOperation('POST','/api/print/jobs/abc/send'),true);
  assert.equal(mayFinishExistingOperation('POST','/api/delivery/orders/abc/status'),true);
  assert.equal(mayFinishExistingOperation('POST','/api/orders'),false);
  assert.equal(mayFinishExistingOperation('POST','/api/products'),false);
  assert.equal(mayFinishExistingOperation('POST','/api/stock/ingredients'),false);
});

test('P0: supervisor consegue finalizar falta de estoque com motivo e débito rastreável',async t=>{
  const {createApp}=await import('../src/server.mjs');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-stock-'));
  const app=createApp({dataPath:path.join(folder,'nexus.db')});
  const origin=await app.listen({port:0});
  t.after(async()=>{await app.close();fs.rmSync(folder,{force:true,recursive:true});});
  let cookie='';
  const req=async(method,route,body)=>{
    const response=await fetch(origin+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    const session=response.headers.get('set-cookie');
    if(session)cookie=session.split(';')[0];
    return {status:response.status,body:await response.json()};
  };
  assert.equal((await req('POST','/api/auth/setup',{username:'admin',password:'senhaForteEstoque2026'})).status,201);
  assert.equal((await req('POST','/api/cash/open',{commandId:'st-open',openingCents:0})).status,201);
  const product=(await req('POST','/api/products',{commandId:'st-product',name:'Misto',priceCents:1200})).body.product;
  const ingredient=(await req('POST','/api/stock/ingredients',{commandId:'st-ingredient',name:'Queijo',unit:'g'})).body.ingredient;
  assert.equal((await req('POST','/api/stock/recipes/'+product.id,{commandId:'st-recipe',items:[{ingredientId:ingredient.id,quantityMilli:1000}]})).status,200);
  const order=(await req('POST','/api/orders',{commandId:'st-order',serviceMode:'counter'})).body.order;
  assert.equal((await req('POST','/api/orders/'+order.id+'/lines',{commandId:'st-line',expectedRevision:0,productId:product.id,quantity:1})).status,200);
  assert.equal((await req('POST','/api/orders/'+order.id+'/confirm',{commandId:'st-confirm',expectedRevision:1})).status,200);
  const settlement={commandId:'st-close-first',expectedRevision:2,payments:[{method:'pix',amountCents:1200}]};
  assert.equal((await req('POST','/api/orders/'+order.id+'/close',settlement)).status,409);
  assert.equal((await req('POST','/api/orders/'+order.id+'/close',{...settlement,commandId:'st-close-approved',inventoryOverrideReason:'Conferência física divergente autorizada pelo supervisor'})).status,200);
  const stock=await req('GET','/api/stock/report');
  assert.equal(stock.body.ingredients.find(x=>x.id===ingredient.id).shortageMilli,1000);
  assert.equal(stock.body.ingredients.find(x=>x.id===ingredient.id).onHandMilli,0);
});

test('P0: garçom pode consultar pizza e incluir linha, mas nunca configurar cardápio',()=>{
  assert.equal(roleAllows('waiter','GET','/api/pizza/products/p-1/config'),true);
  assert.equal(roleAllows('waiter','POST','/api/orders/o-1/pizza-lines'),true);
  assert.equal(roleAllows('waiter','POST','/api/pizza/products/p-1/sizes'),false);
});
