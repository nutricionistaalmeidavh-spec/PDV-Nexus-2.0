/** Explicit opt-in guest menu on a self-hosted LAN; guest requests remain pending until staff accepts. */
import {randomUUID,createHash} from 'node:crypto';
import {createOrder,addOrderLine} from '../../../packages/core/src/order.ts';
const canPay=x=>Number.isSafeInteger(x)&&x>=0;
const requireText=(x,min,max)=>typeof x==='string'&&x.trim().length>=min&&x.trim().length<=max?x.trim():null;
const phoneValid=x=>typeof x==='string'&&/^\+?[0-9 ()-]{8,20}$/.test(x)&&x.replace(/\D/g,'').length>=8;
const allowedStatus={ACCEPTED:['PREPARING','CANCELLED'],PREPARING:['OUT_FOR_DELIVERY','CANCELLED'],OUT_FOR_DELIVERY:['DELIVERED'],DELIVERED:[],CANCELLED:[]};
export function publicRead(db,method,route){
  if(method!=='GET'||route!=='/api/public/menu')return null;
  const products=db.prepare("SELECT p.id,p.name,p.price_cents AS priceCents,c.name AS categoryName,p.is_combo AS isCombo FROM menu_product p JOIN menu_category c ON c.id=p.category_id WHERE p.active=1 AND c.active=1 AND p.sale_unit='unit' AND NOT EXISTS(SELECT 1 FROM pizza_product z WHERE z.product_id=p.id) ORDER BY c.sort_order,c.name COLLATE NOCASE,p.name COLLATE NOCASE LIMIT 250").all();
  return {status:200,body:{documentType:'NON_FISCAL_CATALOG',products}};
}
export function createPublicRequests(db,{maxPerWindow=8,windowMs=600000}={}){
  const perIp=new Map();
  function submit(body,remoteAddress){
    const clientRequestId=body.clientRequestId??null;
    if(clientRequestId!==null&&(typeof clientRequestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId)))
      return {status:400,body:{code:'INVALID_REQUEST_ID',message:'Identificador da solicitação inválido'}};
    const fingerprint=clientRequestId?createHash('sha256').update(JSON.stringify({
      customerName:body.customerName,phone:body.phone,address:body.address,note:body.note??'',items:body.items
    })).digest('hex'):null;
    if(clientRequestId){
      const old=db.prepare('SELECT id,status,total_cents AS totalCents,request_fingerprint AS fingerprint FROM delivery_request WHERE client_request_id=?').get(clientRequestId);
      if(old){
        if(old.fingerprint!==fingerprint)return {status:409,body:{code:'REQUEST_ID_REUSED',message:'Identificador usado em outra solicitação'}};
        return {status:202,body:{requestId:old.id,status:old.status,totalCents:old.totalCents,notice:'Solicitação já recebida. Não houve duplicação.'}};
      }
    }
    const ip=remoteAddress??'unknown',t=Date.now(),previous=perIp.get(ip);
    const entry=previous&&previous.until>t?previous:{count:0,until:t+windowMs};
    if(entry.count>=maxPerWindow)return {status:429,body:{code:'RATE_LIMIT',message:'Muitas solicitações. Contate a loja.'}};
    entry.count++;perIp.set(ip,entry);
    const customerName=requireText(body.customerName,2,100),address=requireText(body.address,10,240);
    const note=body.note===undefined?'':requireText(body.note,0,240);
    if(!customerName||!address||note===null||!phoneValid(body.phone)||!Array.isArray(body.items)||body.items.length<1||body.items.length>20)
      return {status:400,body:{code:'INVALID_DELIVERY',message:'Dados de entrega ou itens inválidos'}};
    const lines=[];let totalCents=0;
    for(const item of body.items){
      if(typeof item?.productId!=='string'||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>20)
        return {status:400,body:{code:'INVALID_ITEMS',message:'Itens inválidos, repetidos ou quantidade excessiva'}};
      const product=db.prepare("SELECT p.id,p.name,p.price_cents AS priceCents FROM menu_product p JOIN menu_category c ON c.id=p.category_id WHERE p.id=? AND p.active=1 AND c.active=1 AND p.sale_unit='unit' AND NOT EXISTS(SELECT 1 FROM pizza_product z WHERE z.product_id=p.id)").get(item.productId);
      if(!product)return {status:400,body:{code:'PRODUCT_UNAVAILABLE',message:'Produto indisponível'}};
      const lineTotal=product.priceCents*item.quantity;
      if(!canPay(lineTotal)||!canPay(totalCents+lineTotal))return {status:400,body:{code:'AMOUNT_TOO_LARGE',message:'Total inválido'}};
      totalCents+=lineTotal;
      lines.push({...product,quantity:item.quantity});
    }
    // Anti-spam and every line are committed together; no financial side effects.
    const id=randomUUID(),createdAt=new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("INSERT INTO delivery_request(id,restaurant_id,customer_name,phone,address,note,total_cents,created_at,client_request_id,request_fingerprint) VALUES(?,'r-local',?,?,?,?,?,?,?,?)")
        .run(id,customerName,body.phone,address,note,totalCents,createdAt,clientRequestId,fingerprint);
      const ins=db.prepare('INSERT INTO delivery_request_line(id,request_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES(?,?,?,?,?,?)');
      for(const line of lines)ins.run(randomUUID(),id,line.id,line.name,line.priceCents,line.quantity);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return {status:202,body:{requestId:id,status:'PENDING',totalCents,notice:'Solicitação recebida; somente a loja pode aceitá-la. Nenhum pagamento foi processado.'}};
  }
  return {submit};
}
export function deliveryRead(db,method,route){
  if(method!=='GET')return null;
  if(route==='/api/delivery/settings'){
    const setting=db.prepare("SELECT enabled FROM delivery_public_setting WHERE id='local'").get();
    return {status:200,body:{enabled:setting?.enabled===1}};
  }
  if(route==='/api/delivery/requests'){
    const requests=db.prepare("SELECT id,customer_name AS customerName,phone,address,note,total_cents AS totalCents,status,accepted_order_id AS orderId,created_at AS createdAt,decided_at AS decidedAt FROM delivery_request WHERE restaurant_id='r-local' ORDER BY created_at DESC,id DESC LIMIT 100").all();
    return {status:200,body:{requests}};
  }
  const id=route.match(/^\/api\/delivery\/requests\/([^/]+)$/);
  if(id){
    const request=db.prepare('SELECT * FROM delivery_request WHERE id=?').get(id[1]);
    if(!request)return {status:404,body:{code:'NOT_FOUND',message:'Solicitação não encontrada'}};
    const lines=db.prepare('SELECT product_id AS productId,product_name_snapshot AS productName,quantity,unit_price_cents AS unitPriceCents FROM delivery_request_line WHERE request_id=?').all(id[1]);
    return {status:200,body:{request:{id:request.id,status:request.status,customerName:request.customer_name,phone:request.phone,address:request.address,note:request.note,totalCents:request.total_cents,lines}}};
  }
  if(route==='/api/delivery/orders'){
    const orders=db.prepare('SELECT d.order_id AS orderId,d.status,o.status AS orderStatus,r.customer_name AS customerName,r.address,r.created_at AS createdAt FROM delivery_order d JOIN sales_order o ON o.id=d.order_id JOIN delivery_request r ON r.id=d.request_id ORDER BY d.updated_at DESC LIMIT 100').all();
    return {status:200,body:{orders}};
  }
  return null;
}
export function deliveryWrite(db,method,route,body,h){
  if(method!=='POST')return null;
  if(route==='/api/delivery/settings')return h.transact(db,route,body,()=>{
    if(typeof body.enabled!=='boolean')h.bad('Informe enabled como verdadeiro ou falso');
    db.prepare("UPDATE delivery_public_setting SET enabled=? WHERE id='local'").run(body.enabled?1:0);
    h.audit(db,'r-local','PUBLIC_MENU_TOGGLED',{enabled:body.enabled});
    return {enabled:body.enabled};
  });
  const accept=route.match(/^\/api\/delivery\/requests\/([^/]+)\/accept$/);
  if(accept)return h.transact(db,route,body,()=>{
    const request=db.prepare('SELECT * FROM delivery_request WHERE id=?').get(accept[1]);
    if(!request)h.missing('Solicitação');
    if(request.status!=='PENDING')h.conflict('Solicitação já processada');
    const items=db.prepare('SELECT * FROM delivery_request_line WHERE request_id=? ORDER BY rowid').all(request.id);
    if(!items.length)h.conflict('Solicitação sem itens');
    const createdAt=h.stamp(),id=randomUUID();
    let order=createOrder({id,serviceMode:'delivery',createdAt});
    db.prepare("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_table_id,service_mode,status,revision,created_at) VALUES(?,'r-local','t-local',NULL,'delivery',?,?,?)")
      .run(id,'DRAFT',0,createdAt);
    for(const item of items){
      const line={id:randomUUID(),productId:item.product_id,productName:item.product_name_snapshot,unitPriceCents:item.unit_price_cents,quantity:item.quantity};
      order=addOrderLine(order,line);
      db.prepare('INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES(?,?,?,?,?,?)')
        .run(line.id,id,line.productId,line.productName,line.unitPriceCents,line.quantity);
      // Single source of truth for stock recipe snapshot.
      h.snapshotLineRecipe(db,line.id,line.productId);
      const combo=db.prepare('SELECT c.product_id AS productId,p.name,c.quantity FROM menu_combo_item c JOIN menu_product p ON p.id=c.product_id WHERE c.combo_id=?').all(line.productId);
      const save=db.prepare('INSERT INTO order_line_combo_item(id,line_id,product_id,product_name_snapshot,quantity) VALUES(?,?,?,?,?)');
      for(const component of combo)save.run(randomUUID(),line.id,component.productId,component.name,component.quantity);
    }
    if(order.lines.reduce((sum,line)=>sum+line.unitPriceCents*line.quantity,0)!==request.total_cents)h.conflict('Total da solicitação inconsistente');
    db.prepare('UPDATE sales_order SET revision=? WHERE id=?').run(order.revision,id);
    db.prepare("UPDATE delivery_request SET status='ACCEPTED',accepted_order_id=?,decided_at=? WHERE id=?").run(id,h.stamp(),request.id);
    db.prepare("INSERT INTO delivery_order(order_id,request_id,status,updated_at) VALUES(?,?,'ACCEPTED',?)").run(id,request.id,h.stamp());
    h.audit(db,id,'DELIVERY_ACCEPTED',{requestId:request.id});
    return {requestId:request.id,order:h.databaseOrder(db,id)};
  },201);
  const reject=route.match(/^\/api\/delivery\/requests\/([^/]+)\/reject$/);
  if(reject)return h.transact(db,route,body,()=>{
    const request=db.prepare('SELECT status FROM delivery_request WHERE id=?').get(reject[1]);
    if(!request)h.missing('Solicitação');
    if(request.status!=='PENDING')h.conflict('Solicitação já processada');
    const reason=h.requireString(body.reason,'Motivo',240);
    db.prepare("UPDATE delivery_request SET status='REJECTED',decision_reason=?,decided_at=? WHERE id=?").run(reason,h.stamp(),reject[1]);
    h.audit(db,reject[1],'DELIVERY_REJECTED',{reason});
    return {requestId:reject[1],status:'REJECTED'};
  });
  const status=route.match(/^\/api\/delivery\/orders\/([^/]+)\/status$/);
  if(status)return h.transact(db,route,body,()=>{
    const row=db.prepare('SELECT d.status,o.status AS orderStatus FROM delivery_order d JOIN sales_order o ON o.id=d.order_id WHERE d.order_id=?').get(status[1]);
    if(!row)h.missing('Entrega');
    if(!allowedStatus[row.status]?.includes(body.status))h.conflict('Transição de entrega inválida');
    if(body.status==='OUT_FOR_DELIVERY'&&!['OPEN','CLOSED'].includes(row.orderStatus))h.conflict('Confirme o pedido antes da expedição');
    db.prepare('UPDATE delivery_order SET status=?,updated_at=? WHERE order_id=?').run(body.status,h.stamp(),status[1]);
    h.audit(db,status[1],'DELIVERY_STATUS_CHANGED',{from:row.status,to:body.status});
    return {orderId:status[1],status:body.status};
  });
  return null;
}
