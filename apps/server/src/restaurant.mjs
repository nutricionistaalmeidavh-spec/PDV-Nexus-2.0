/** Restaurante P1: mesas, comandas e KDS; usa transação/idempotência do host. */
import { randomUUID } from 'node:crypto';
import { createOrder } from '../../../packages/core/src/order.ts';

export function dispatchKitchenTickets(db,orderId,stamp) {
  // Uma linha de pedido gera um ticket, inclusive quando adicionada após confirmação.
  const lines=db.prepare('SELECT id FROM order_line WHERE order_id=? AND cancelled_at IS NULL').all(orderId);
  const insert=db.prepare("INSERT OR IGNORE INTO kitchen_ticket(id,order_id,line_id,status,revision,created_at,updated_at) VALUES(?,?,?,'PENDING',0,?,?)");
  for(const line of lines) {
    const now=stamp();
    insert.run(randomUUID(),orderId,line.id,now,now);
  }
}

export function restaurantRead(db,method,route,{missing}) {
  if(method!=='GET') return null;
  if(route==='/api/tables') {
    const tables=db.prepare(`SELECT st.id,st.label,
      (SELECT so.id FROM sales_order so WHERE so.service_table_id=st.id AND so.status IN ('DRAFT','OPEN') LIMIT 1) AS orderId,
      (SELECT so.status FROM sales_order so WHERE so.service_table_id=st.id AND so.status IN ('DRAFT','OPEN') LIMIT 1) AS orderStatus
      FROM service_table st WHERE st.restaurant_id='r-local' ORDER BY st.label COLLATE NOCASE`).all();
    return {status:200,body:{tables}};
  }
  const modifiers=route.match(/^\/api\/products\/([^/]+)\/modifiers$/);
  if(modifiers) {
    if(!db.prepare('SELECT 1 FROM menu_product WHERE id=?').get(modifiers[1])) missing('Produto');
    return {status:200,body:{modifiers:db.prepare('SELECT id,name,price_cents AS priceCents,active FROM product_modifier WHERE product_id=? ORDER BY name').all(modifiers[1])}};
  }
  if(route==='/api/kitchen/tickets') {
    const tickets=db.prepare(`SELECT kt.id,kt.order_id AS orderId,kt.line_id AS lineId,kt.status,kt.revision,
      kt.created_at AS createdAt,kt.change_note AS changeNote,ol.product_name_snapshot AS productName,ol.quantity,ol.note_snapshot AS note,
      (SELECT group_concat(name_snapshot, ', ') FROM order_line_modifier WHERE line_id=kt.line_id) AS modifiers,
      (SELECT group_concat(quantity||'x '||product_name_snapshot, ', ') FROM order_line_combo_item WHERE line_id=kt.line_id) AS comboDetails,
      so.service_mode AS serviceMode,st.label AS tableLabel
      FROM kitchen_ticket kt JOIN order_line ol ON ol.id=kt.line_id
      JOIN sales_order so ON so.id=kt.order_id LEFT JOIN service_table st ON st.id=so.service_table_id
      WHERE kt.status IN ('PENDING','PREPARING','READY') OR (kt.status='CANCELLED' AND kt.change_note IS NOT NULL AND kt.updated_at>=?) ORDER BY kt.created_at ASC LIMIT 200`).all(new Date(Date.now()-12*3600*1000).toISOString());
    return {status:200,body:{tickets}};
  }
  if(route==='/api/restaurant/summary') {
    const activeOrders=db.prepare("SELECT COUNT(*) AS n FROM sales_order WHERE status IN ('DRAFT','OPEN')").get().n;
    const occupiedTables=db.prepare("SELECT COUNT(DISTINCT service_table_id) AS n FROM sales_order WHERE service_table_id IS NOT NULL AND status IN ('DRAFT','OPEN')").get().n;
    const pendingTickets=db.prepare("SELECT COUNT(*) AS n FROM kitchen_ticket WHERE status IN ('PENDING','PREPARING')").get().n;
    return {status:200,body:{activeOrders,occupiedTables,pendingTickets}};
  }
  return null;
}

export function restaurantWrite(db,method,route,body,h) {
  const {transact,requireString,requireCents,bad,conflict,missing,assertRevision,databaseOrder,audit,stamp}=h;
  if(method==='POST' && route==='/api/tables') return transact(db,route,body,()=>{
    const label=requireString(body.label,'Identificação da mesa',60);
    if(db.prepare("SELECT 1 FROM service_table WHERE restaurant_id='r-local' AND label=? COLLATE NOCASE").get(label)) conflict('Já existe uma mesa com este nome');
    const table={id:randomUUID(),label};
    db.prepare('INSERT INTO service_table(id,restaurant_id,label) VALUES(?,?,?)').run(table.id,'r-local',label);
    audit(db,table.id,'TABLE_CREATED',{label});
    return {table};
  },201);
  const editTable=route.match(/^\/api\/tables\/([^/]+)$/);
  if(method==='PATCH'&&editTable) return transact(db,route,body,()=>{
    const id=editTable[1],label=requireString(body.label,'Identificação da mesa',60);
    if(!db.prepare('SELECT 1 FROM service_table WHERE id=?').get(id)) missing('Mesa');
    if(db.prepare('SELECT 1 FROM service_table WHERE restaurant_id=? AND label=? COLLATE NOCASE AND id<>?').get('r-local',label,id))conflict('Já existe mesa com este nome');
    db.prepare('UPDATE service_table SET label=? WHERE id=?').run(label,id);audit(db,id,'TABLE_RENAMED',{label});return {table:{id,label}};
  });
  const openTable=route.match(/^\/api\/tables\/([^/]+)\/open$/);
  if(method==='POST'&&openTable)return transact(db,route,body,()=>{
    const tableId=openTable[1];if(!db.prepare("SELECT 1 FROM service_table WHERE id=? AND restaurant_id='r-local'").get(tableId))missing('Mesa');
    const current=db.prepare("SELECT id FROM sales_order WHERE service_table_id=? AND status IN ('DRAFT','OPEN')").get(tableId);
    if(current)return {order:databaseOrder(db,current.id),reused:true};
    const order=createOrder({id:randomUUID(),serviceMode:'table',createdAt:stamp()});
    db.prepare('INSERT INTO sales_order(id,restaurant_id,terminal_id,service_table_id,service_mode,status,revision,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(order.id,'r-local','t-local',tableId,'table',order.status,order.revision,order.createdAt);
    audit(db,order.id,'ORDER_CREATED',{serviceMode:'table',tableId});
    return {order:databaseOrder(db,order.id),reused:false};
  },201);
  const createModifier=route.match(/^\/api\/products\/([^/]+)\/modifiers$/);
  if(method==='POST'&&createModifier) return transact(db,route,body,()=>{
    const productId=createModifier[1];
    if(!db.prepare('SELECT 1 FROM menu_product WHERE id=?').get(productId))missing('Produto');
    const name=requireString(body.name,'Nome do adicional',80),priceCents=requireCents(body.priceCents,'Preço');
    const modifier={id:randomUUID(),productId,name,priceCents};
    db.prepare('INSERT INTO product_modifier(id,product_id,name,price_cents) VALUES(?,?,?,?)').run(modifier.id,productId,name,priceCents);
    audit(db,productId,'MODIFIER_CREATED',modifier);return {modifier};
  },201);
  const move=route.match(/^\/api\/orders\/([^/]+)\/transfer-table$/);
  if(method==='POST'&&move)return transact(db,route,body,()=>{
    const id=move[1],order=databaseOrder(db,id);
    assertRevision(order,body.expectedRevision);
    if(order.serviceMode!=='table'|| !['DRAFT','OPEN'].includes(order.status))conflict('Transferência exige comanda de mesa aberta');
    const tableId=requireString(body.tableId,'Mesa de destino',128);
    if(!db.prepare("SELECT 1 FROM service_table WHERE id=? AND restaurant_id='r-local'").get(tableId))missing('Mesa');
    const current=db.prepare("SELECT id FROM sales_order WHERE service_table_id=? AND status IN ('DRAFT','OPEN') AND id<>?").get(tableId,id);
    if(current)conflict('Mesa de destino ocupada','TABLE_OCCUPIED');
    db.prepare('UPDATE sales_order SET service_table_id=?,revision=revision+1 WHERE id=?').run(tableId,id);
    audit(db,id,'ORDER_TRANSFERRED',{from:order.tableId,to:tableId});return {order:databaseOrder(db,id)};
  });
  const ticket=route.match(/^\/api\/kitchen\/tickets\/([^/]+)\/status$/);
  if(method==='POST'&&ticket)return transact(db,route,body,()=>{
    const id=ticket[1];const row=db.prepare('SELECT * FROM kitchen_ticket WHERE id=?').get(id);
    if(!row)missing('Ticket da cozinha');
    if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==row.revision)conflict('Ticket alterado por outro dispositivo','REVISION_CONFLICT');
    const transitions={PENDING:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['SERVED','CANCELLED'],SERVED:[],CANCELLED:[]};
    if(!transitions[row.status].includes(body.status))conflict('Mudança de preparo inválida','INVALID_KITCHEN_TRANSITION');
    db.prepare('UPDATE kitchen_ticket SET status=?,revision=revision+1,updated_at=? WHERE id=?').run(body.status,stamp(),id);
    audit(db,row.order_id,'KITCHEN_STATUS_CHANGED',{ticketId:id,from:row.status,to:body.status});
    return {ticket:{id,status:body.status,revision:row.revision+1}};
  });
  return null;
}
