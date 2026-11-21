/** QR de mesa: capabilities com hash, aprovação transacional e portal público isolado. */
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {addOrderLine,confirmOrder} from '../../../packages/core/src/order.ts';
import {dispatchKitchenTickets} from './restaurant.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const okCents=n=>Number.isSafeInteger(n)&&n>=0;
class GuestError extends Error{
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const guestBad=(message,code='INVALID_TABLE_REQUEST')=>{throw new GuestError(400,code,message);};
const guestGone=()=>{throw new GuestError(404,'TABLE_QR_UNAVAILABLE','QR de mesa inválido ou expirado');};
const guestConflict=(message,code='TABLE_REQUEST_CONFLICT')=>{throw new GuestError(409,code,message);};
const validateToken=token=>typeof token==='string'&&/^[0-9a-f]{64}$/.test(token);
function sessionFor(db,token){
  if(!validateToken(token))guestGone();
  const session=db.prepare(`SELECT q.*,t.label AS table_label,o.status AS order_status,
    o.service_table_id AS current_table_id FROM table_qr_session q
    JOIN service_table t ON t.id=q.table_id
    JOIN sales_order o ON o.id=q.order_id WHERE q.token_hash=?`).get(sha(token));
  if(!session||session.revoked_at||Date.parse(session.expires_at)<=Date.now()
    ||session.current_table_id!==session.table_id||!['DRAFT','OPEN'].includes(session.order_status))guestGone();
  return session;
}
function catalog(db){
  const products=db.prepare(`SELECT p.id,p.name,p.price_cents AS priceCents,c.name AS categoryName
    FROM menu_product p JOIN menu_category c ON c.id=p.category_id
    WHERE p.active=1 AND c.active=1 AND p.sale_unit='unit' ORDER BY c.sort_order,c.name,p.name LIMIT 250`).all();
  const mod=db.prepare('SELECT id,name,price_cents AS priceCents FROM product_modifier WHERE product_id=? AND active=1 ORDER BY name');
  return products.map(p=>({...p,modifiers:mod.all(p.id)}));
}
function acceptedOrder(db,request,h){
  const current=h.databaseOrder(db,request.order_id);
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=?').get(current.id))throw new GuestError(409,'TABLE_ALREADY_PAID','Após o primeiro recebimento, novas solicitações exigem outra comanda');
  if(current.suspendedAt)throw new GuestError(409,'TABLE_SUSPENDED','A comanda foi suspensa');
  if(!['DRAFT','OPEN'].includes(current.status))throw new GuestError(409,'TABLE_CLOSED','Mesa já encerrada');
  const session=db.prepare('SELECT table_id FROM table_qr_session WHERE id=?').get(request.session_id);
  if(current.tableId!==session?.table_id)throw new GuestError(409,'TABLE_MOVED','Mesa transferida: solicitação requer revisão');
  const items=db.prepare('SELECT * FROM table_order_request_line WHERE request_id=? ORDER BY rowid').all(request.id);
  if(!items.length)guestConflict('Solicitação sem itens');
  let next=current;
  for(const item of items){
    const line={id:randomUUID(),productId:item.product_id,productName:item.product_name_snapshot,
      unitPriceCents:item.unit_price_cents,quantity:item.quantity};
    next=addOrderLine(next,line);
    db.prepare(`INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity,note_snapshot)
      VALUES(?,?,?,?,?,?,?)`).run(line.id,request.order_id,line.productId,line.productName,line.unitPriceCents,line.quantity,item.note_snapshot);
    for(const m of JSON.parse(item.modifiers_json)){
      db.prepare(`INSERT INTO order_line_modifier(id,line_id,modifier_id,name_snapshot,price_cents_snapshot)
        VALUES(?,?,?,?,?)`).run(randomUUID(),line.id,m.id,m.name,m.priceCents);
    }
    const components=db.prepare(`SELECT c.product_id AS productId,p.name,c.quantity
      FROM menu_combo_item c JOIN menu_product p ON p.id=c.product_id WHERE c.combo_id=?`).all(line.productId);
    for(const c of components)db.prepare(`INSERT INTO order_line_combo_item
      (id,line_id,product_id,product_name_snapshot,quantity) VALUES(?,?,?,?,?)`)
      .run(randomUUID(),line.id,c.productId,c.name,c.quantity);
    h.snapshotLineRecipe(db,line.id,line.productId);
  }
  if(next.totalCents!==undefined&&next.totalCents<0)guestConflict('Total inválido');
  if(next.status==='DRAFT')next=confirmOrder(next);
  db.prepare('UPDATE sales_order SET status=?,revision=? WHERE id=?').run(next.status,next.revision,next.id);
  dispatchKitchenTickets(db,next.id,h.stamp);
  db.prepare(`UPDATE table_order_request SET status='ACCEPTED',decided_at=? WHERE id=?`).run(h.stamp(),request.id);
  h.audit(db,next.id,'TABLE_QR_REQUEST_ACCEPTED',{requestId:request.id,items:items.length});
  return h.databaseOrder(db,next.id);
}
export function tableQrRead(db,method,route,h){
  if(method!=='GET')return null;
  const m=route.match(/^\/api\/tables\/([^/]+)\/requests$/);
  if(!m)return null;
  if(!db.prepare('SELECT 1 FROM service_table WHERE id=?').get(m[1]))h.missing('Mesa');
  const requests=db.prepare(`SELECT r.id,r.guest_name AS guestName,r.status,r.total_cents AS totalCents,
    r.created_at AS createdAt,r.decided_at AS decidedAt,r.reason
    FROM table_order_request r JOIN table_qr_session s ON s.id=r.session_id
    WHERE s.table_id=? ORDER BY r.created_at DESC LIMIT 50`).all(m[1]);
  const get=db.prepare(`SELECT product_name_snapshot AS productName,quantity,note_snapshot AS note,
    unit_price_cents AS unitPriceCents,modifiers_json AS modifiersJson
    FROM table_order_request_line WHERE request_id=? ORDER BY rowid`);
  for(const x of requests)x.items=get.all(x.id).map(y=>({...y,modifiers:JSON.parse(y.modifiersJson),modifiersJson:undefined}));
  return {status:200,body:{requests}};
}
export function tableQrWrite(db,method,route,body,h){
  if(method!=='POST')return null;
  const qr=route.match(/^\/api\/tables\/([^/]+)\/qr$/);
  if(qr){
    // Não persistir token bearer em command_receipt: somente o hash fica no SQLite.
    // Replay do comando não reemite nem invalida silenciosamente um QR previamente mostrado.
    const commandId=h.requireString(body.commandId,'Identificador do comando',128);
    if(!/^[a-zA-Z0-9_-]{3,128}$/.test(commandId))h.bad('Identificador inválido');
    db.exec('BEGIN IMMEDIATE');
    try{
      if(db.prepare('SELECT 1 FROM command_receipt WHERE command_id=?').get(commandId))
        h.conflict('QR já emitido; gere um novo QR se necessário','QR_ISSUE_REPLAY');
      const result=(()=>{

    const table=db.prepare(`SELECT st.id,st.label,so.id AS orderId
      FROM service_table st LEFT JOIN sales_order so ON so.service_table_id=st.id AND so.status IN ('DRAFT','OPEN')
      WHERE st.id=?`).get(qr[1]);
    if(!table)h.missing('Mesa');
    if(!table.orderId)h.conflict('Abra a comanda antes de gerar o QR','TABLE_NOT_OPEN');
    if(typeof body.publicBaseUrl!=='string'||body.publicBaseUrl.length>512)h.bad('URL pública inválida');
    let base;
    try{base=new URL(body.publicBaseUrl);}catch{h.bad('URL pública inválida');}
    const isLocal=['localhost','127.0.0.1'].includes(base.hostname);
    if(!['https:',...(isLocal?['http:']:[])].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/')
      h.bad('Use a origem HTTPS do portal público (HTTP apenas para localhost)');
    if(body.autoAccept!==undefined&&typeof body.autoAccept!=='boolean')h.bad('Modo de aprovação inválido');
    if(body.autoAccept===true&&!h.supervisor)h.forbidden('Autoaprovação exige supervisor','SUPERVISOR_REQUIRED');
    const raw=randomBytes(32).toString('hex'),id=randomUUID(),now=h.stamp();
    const expiresAt=new Date(Date.now()+12*3600*1000).toISOString();
    db.prepare('UPDATE table_qr_session SET revoked_at=? WHERE order_id=? AND revoked_at IS NULL').run(now,table.orderId);
    db.prepare(`INSERT INTO table_qr_session(id,table_id,order_id,token_hash,auto_accept,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?)`).run(id,table.id,table.orderId,sha(raw),body.autoAccept?1:0,now,expiresAt);
    const url=new URL('table.html?token='+raw,base).toString();
    h.audit(db,table.orderId,'TABLE_QR_ROTATED',{tableId:table.id,sessionId:id,expiresAt,autoAccept:!!body.autoAccept});
    return {url,tableLabel:table.label,expiresAt,autoAccept:!!body.autoAccept};
      })();
      db.prepare('INSERT INTO command_receipt(command_id,request_hash,response_json,created_at) VALUES(?,?,?,?)')
        .run(commandId,sha(JSON.stringify({route,body})),JSON.stringify({status:200,body:{issued:true}}),h.stamp());
      db.exec('COMMIT');
      return {status:200,body:result};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  const decision=route.match(/^\/api\/table-requests\/([^/]+)\/(accept|reject)$/);
  if(!decision)return null;
  return h.transact(db,route,body,()=>{
    const request=db.prepare('SELECT * FROM table_order_request WHERE id=?').get(decision[1]);
    if(!request)h.missing('Solicitação de mesa');
    if(request.status!=='PENDING')h.conflict('Solicitação já processada','REQUEST_ALREADY_DECIDED');
    if(decision[2]==='reject'){
      const reason=h.requireString(body.reason,'Motivo da rejeição',240);
      db.prepare(`UPDATE table_order_request SET status='REJECTED',reason=?,decided_at=? WHERE id=?`)
        .run(reason,h.stamp(),request.id);
      h.audit(db,request.order_id,'TABLE_QR_REQUEST_REJECTED',{requestId:request.id,reason});
      return {requestId:request.id,statusText:'REJECTED'};
    }
    let order;
    try{order=acceptedOrder(db,request,h)}
    catch(e){if(e instanceof GuestError)h.conflict(e.message,e.code);throw e;}
    return {requestId:request.id,statusText:'ACCEPTED',order};
  });
}
export function publicTableRead(db,method,route){
  if(method!=='GET')return null;
  const m=route.match(/^\/api\/public\/table\/([^/]+)(?:\/requests\/([^/]+))?$/);
  if(!m)return null;
  try{
    const session=sessionFor(db,m[1]);
    if(m[2]){
      const request=db.prepare(`SELECT id,status,total_cents AS totalCents,created_at AS createdAt,reason
        FROM table_order_request WHERE id=? AND session_id=?`).get(m[2],session.id);
      if(!request)guestGone();
      return {status:200,body:{requestId:request.id,statusText:request.status,totalCents:request.totalCents,createdAt:request.createdAt,reason:request.reason}};
    }
    return {status:200,body:{tableLabel:session.table_label,expiresAt:session.expires_at,
      approvalMode:session.auto_accept?'automatic':'manual',products:catalog(db)}};
  }catch(e){if(e instanceof GuestError)return {status:e.status,body:{code:e.code,message:e.message}};throw e;}
}
export function publicTableSubmit(db,route,body,h){
  const m=route.match(/^\/api\/public\/table\/([^/]+)\/requests$/);
  if(!m)return null;
  try{
    const session=sessionFor(db,m[1]);
    if(typeof body?.clientRequestId!=='string'||!/^[a-f0-9-]{16,128}$/i.test(body.clientRequestId))guestBad('Identificador de envio inválido');
    if(!Array.isArray(body.items)||!body.items.length||body.items.length>20)guestBad('Informe entre 1 e 20 itens');
    const guestName=body.guestName===undefined||body.guestName===''?null:body.guestName;
    if(guestName!==null&&(typeof guestName!=='string'||guestName.trim().length>80))guestBad('Nome inválido');
    const payloadHash=sha(JSON.stringify({guestName,items:body.items}));
    db.exec('BEGIN IMMEDIATE');
    let result;
    try{
      const old=db.prepare(`SELECT id,status,total_cents AS totalCents,payload_hash AS hash FROM table_order_request
        WHERE session_id=? AND client_request_id=?`).get(session.id,body.clientRequestId);
      if(old){
        if(old.hash!==payloadHash)guestConflict('Identificador usado com outra solicitação','REQUEST_ID_REUSED');
        result={status:202,body:{requestId:old.id,statusText:old.status,totalCents:old.totalCents}};
      }else{
        const inFlight=db.prepare(`SELECT COUNT(*) AS n FROM table_order_request
          WHERE order_id=? AND status='PENDING'`).get(session.order_id).n;
        if(inFlight>=30)guestConflict('Muitas solicitações pendentes. Chame o atendente','TABLE_QUEUE_FULL');
        const prepared=[], products=catalog(db),byId=new Map(products.map(x=>[x.id,x]));
        let total=0;
        for(const item of body.items){
          const p=byId.get(item?.productId);
          if(!p)guestBad('Produto indisponível');
          if(!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>20)guestBad('Quantidade inválida');
          const ids=item.modifierIds??[];
          if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length)guestBad('Adicionais inválidos');
          const mods=[];
          for(const id of ids){
            const mod=p.modifiers.find(x=>x.id===id);
            if(!mod)guestBad('Adicional não disponível para este produto');
            mods.push(mod);
          }
          const note=item.note??'';
          if(typeof note!=='string'||note.trim().length>240)guestBad('Observação inválida');
          const unit=p.priceCents+mods.reduce((n,x)=>n+x.priceCents,0);
          const subtotal=unit*item.quantity;
          if(!okCents(unit)||!okCents(subtotal)||!okCents(total+subtotal))guestBad('Valor excede limite seguro');
          total+=subtotal;
          prepared.push({p,quantity:item.quantity,note:note.trim(),mods,unit});
        }
        const requestId=randomUUID(),stamp=h.stamp();
        db.prepare(`INSERT INTO table_order_request
          (id,session_id,order_id,client_request_id,payload_hash,guest_name,total_cents,status,created_at)
          VALUES(?,?,?,?,?,?,?,'PENDING',?)`).run(requestId,session.id,session.order_id,body.clientRequestId,payloadHash,guestName?.trim()??null,total,stamp);
        const ins=db.prepare(`INSERT INTO table_order_request_line
          (id,request_id,product_id,product_name_snapshot,base_price_cents,unit_price_cents,quantity,note_snapshot,modifiers_json)
          VALUES(?,?,?,?,?,?,?,?,?)`);
        for(const x of prepared)ins.run(randomUUID(),requestId,x.p.id,x.p.name,x.p.priceCents,x.unit,x.quantity,x.note,JSON.stringify(x.mods));
        let state='PENDING';
        if(session.auto_accept){
          const request=db.prepare('SELECT * FROM table_order_request WHERE id=?').get(requestId);
          acceptedOrder(db,request,h);
          state='ACCEPTED';
        }
        result={status:state==='ACCEPTED'?201:202,body:{requestId,statusText:state,totalCents:total}};
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    if(session.auto_accept)h.notifyKitchen?.();
    return result;
  }catch(e){
    if(e instanceof GuestError)return {status:e.status,body:{code:e.code,message:e.message}};
    return {status:500,body:{code:'TABLE_REQUEST_ERROR',message:'Não foi possível registrar a solicitação'}};
  }
}
