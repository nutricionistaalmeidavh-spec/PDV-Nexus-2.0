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
import {mayFinishExistingOperation,mayOpenCashForUnfinishedOrders} from '../src/license-operation-policy.mjs';
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
  const db=openDatabase(path.join(folder,'nexus.db'));
  t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
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
  const database=path.join(folder,'nexus.db');
  const db=openDatabase(database);
  t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
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
  const autos=fs.readdirSync(path.join(folder,'backups')).filter(x=>/^auto-\d{13}-[0-9a-f-]{36}\.sqlite$/.test(x));
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

test('P0: entrega não vira entregue sem pagamento e cancelamento encerra pedido vinculado',async t=>{
  const {createApp}=await import('../src/server.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-delivery-'));
  const app=createApp({dataPath:path.join(dir,'nexus.db'),publicMenuEnabled:true});
  const origin=await app.listen({port:0});
  t.after(async()=>{await app.close();fs.rmSync(dir,{force:true,recursive:true});});
  let cookie='';
  const request=async(method,route,body,guest=false)=>{
    const response=await fetch(origin+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(!guest&&cookie?{cookie}:{})},
      body:body?JSON.stringify(body):undefined});
    const session=response.headers.get('set-cookie');if(!guest&&session)cookie=session.split(';')[0];
    return {status:response.status,body:await response.json()};
  };
  await request('POST','/api/auth/setup',{username:'admin',password:'senhaForteDelivery2026'});
  const product=(await request('POST','/api/products',{commandId:'del-product',name:'Entrega',priceCents:800})).body.product;
  const create=async id=>{
    const req=await request('POST','/api/public/delivery/requests',{customerName:'Cliente',phone:'16999999999',address:'Rua Central 123',items:[{productId:product.id,quantity:1}]},true);
    assert.equal(req.status,202);
    const accepted=await request('POST','/api/delivery/requests/'+req.body.requestId+'/accept',{commandId:'del-accept-'+id});
    assert.equal(accepted.status,201);
    return accepted.body.order;
  };
  const pending=await create('a');
  assert.equal((await request('POST','/api/delivery/orders/'+pending.id+'/status',{commandId:'del-cancel',status:'CANCELLED'})).status,200);
  assert.equal((await request('GET','/api/orders/'+pending.id)).body.order.status,'CANCELLED');
  const order=await create('b');
  const confirmed=await request('POST','/api/orders/'+order.id+'/confirm',{commandId:'del-confirm',expectedRevision:order.revision});
  assert.equal(confirmed.status,200);
  assert.equal((await request('POST','/api/delivery/orders/'+order.id+'/status',{commandId:'del-prep',status:'PREPARING'})).status,200);
  assert.equal((await request('POST','/api/delivery/orders/'+order.id+'/status',{commandId:'del-dispatch',status:'OUT_FOR_DELIVERY'})).status,200);
  assert.equal((await request('POST','/api/delivery/orders/'+order.id+'/status',{commandId:'del-unpaid',status:'DELIVERED'})).status,409);
  assert.equal((await request('POST','/api/cash/open',{commandId:'del-cash',openingCents:0})).status,201);
  assert.equal((await request('POST','/api/orders/'+order.id+'/close',{commandId:'del-paid',expectedRevision:confirmed.body.order.revision,payments:[{method:'pix',amountCents:800}]})).status,200);
  assert.equal((await request('POST','/api/delivery/orders/'+order.id+'/status',{commandId:'del-delivered',status:'DELIVERED'})).status,200);
  const list=(await request('GET','/api/delivery/orders')).body.orders;
  assert.equal(list.find(x=>x.orderId===order.id).paymentStatus,'PAID');
});

test('P0: host despacha automaticamente comprovante pendente após configurar impressora local TCP',async t=>{
 const net=await import('node:net');
 const {createApp}=await import('../src/server.mjs');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-printer-'));
 const chunks=[];
 const tcp=net.createServer(socket=>socket.on('data',data=>chunks.push(data)));
 await new Promise(resolve=>tcp.listen(0,'127.0.0.1',resolve));
 const tcpPort=tcp.address().port;
 const app=createApp({dataPath:path.join(folder,'nexus.db')});
 const origin=await app.listen({port:0});
 t.after(async()=>{await app.close();await new Promise(resolve=>tcp.close(resolve));fs.rmSync(folder,{force:true,recursive:true});});
 let cookie='';
 const req=async(method,route,body)=>{
  const response=await fetch(origin+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})},
   body:body?JSON.stringify(body):undefined});
  const session=response.headers.get('set-cookie');if(session)cookie=session.split(';')[0];
  return {status:response.status,body:await response.json()};
 };
 assert.equal((await req('POST','/api/auth/setup',{username:'admin',password:'senhaImpressaoSegura2026'})).status,201);
 const printer=await req('POST','/api/printer',{commandId:'printer-p0-auto',transport:'tcp',host:'127.0.0.1',port:tcpPort});
 assert.equal(printer.status,200,JSON.stringify(printer.body));
 assert.equal((await req('POST','/api/cash/open',{commandId:'printer-cash',openingCents:0})).status,201);
 const product=(await req('POST','/api/products',{commandId:'printer-product',name:'Cafe',priceCents:500})).body.product;
 const order=(await req('POST','/api/orders',{commandId:'printer-order',serviceMode:'counter'})).body.order;
 await req('POST','/api/orders/'+order.id+'/lines',{commandId:'printer-line',expectedRevision:0,productId:product.id,quantity:1});
 await req('POST','/api/orders/'+order.id+'/confirm',{commandId:'printer-confirm',expectedRevision:1});
 assert.equal((await req('POST','/api/orders/'+order.id+'/close',{commandId:'printer-close',expectedRevision:2,payments:[{method:'pix',amountCents:500}]})).status,200);
 const printed=await app.printPendingOnce();
 assert.equal(printed.status,200,JSON.stringify(printed));
 assert.equal((await req('GET','/api/print/jobs')).body.jobs[0].status,'DONE');
 assert.match(Buffer.concat(chunks).toString('ascii'),/NAO FISCAL/);
 assert.equal(await app.printPendingOnce(),null,'não reimprimir trabalho concluído');
});

test('P0: erro inesperado do financeiro responde 500 genérico sem vazar ID interno',async t=>{
 const {createApp}=await import('../src/server.mjs');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-internal-'));
 const location=path.join(folder,'nexus.db');
 const db=openDatabase(location);
 db.prepare("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES('private-p','c-default','Venda de teste',500)").run();
 db.prepare("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,created_at,closed_at) VALUES('internal-order-secret','r-local','t-local','counter','CLOSED','2026-11-22T12:00:00.000Z','2026-11-22T12:30:00.000Z')").run();
 db.prepare("INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES('private-line','internal-order-secret','private-p','Venda de teste',500,1)").run();
 db.close();
 const app=createApp({dataPath:location});
 const origin=await app.listen({port:0});
 t.after(async()=>{await app.close();fs.rmSync(folder,{force:true,recursive:true});});
 const auth=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({username:'admin',password:'senhaForteErro2026'})});
 assert.equal(auth.status,201);
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 const res=await fetch(origin+'/api/reports/financial',{headers:{cookie}});
 const body=await res.json();
 assert.equal(res.status,500);
 assert.equal(body.code,'INTERNAL_ERROR');
 assert.equal(JSON.stringify(body).includes('internal-order-secret'),false);
});

test('P0: operação iniciada com licença válida pode ser confirmada, cancelada e estornada depois de expirar',()=>{
  for(const action of ['confirm','cancel','close','refund','refund-items','payments/partial'])
    assert.equal(mayFinishExistingOperation('POST','/api/orders/order-123/'+action),true,action);
  assert.equal(mayFinishExistingOperation('POST','/api/cash/print'),true);
  assert.equal(mayFinishExistingOperation('POST','/api/orders'),false);
  assert.equal(mayFinishExistingOperation('POST','/api/orders/new/lines'),false);
  assert.equal(mayFinishExistingOperation('POST','/api/orders/order-123/transfer-table'),false);
  assert.equal(mayFinishExistingOperation('POST','/api/stock/ingredients'),false);
});

test('P0: caixa pode reabrir após licença expirar somente quando há comanda anterior não concluída',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-p0-expired-cash-'));
 const db=openDatabase(path.join(dir,'db.sqlite'));
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(mayOpenCashForUnfinishedOrders(db,'POST','/api/cash/open'),false);
 const id=randomUUID();
 db.prepare("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,revision,created_at) VALUES(?,'r-local','t-local','counter','DRAFT',0,?)").run(id,new Date().toISOString());
 assert.equal(mayOpenCashForUnfinishedOrders(db,'POST','/api/cash/open'),true);
 assert.equal(mayOpenCashForUnfinishedOrders(db,'POST','/api/orders'),false);
 db.prepare("UPDATE sales_order SET status='CANCELLED' WHERE id=?").run(id);
 assert.equal(mayOpenCashForUnfinishedOrders(db,'POST','/api/cash/open'),false);
});
