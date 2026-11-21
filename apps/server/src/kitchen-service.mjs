/** KDS: tickets persistentes por lineId, revisão otimista e transições válidas. */
import {randomUUID} from 'node:crypto';
export function dispatchKitchenTickets(db,orderId,stamp) {
  // Uma linha de pedido gera um ticket, inclusive quando adicionada após confirmação.
  const lines=db.prepare('SELECT id FROM order_line WHERE order_id=?').all(orderId);
  const insert=db.prepare("INSERT OR IGNORE INTO kitchen_ticket(id,order_id,line_id,status,revision,created_at,updated_at) VALUES(?,?,?,'PENDING',0,?,?)");
  for(const line of lines) {
    const now=stamp();
    insert.run(randomUUID(),orderId,line.id,now,now);
  }
}
const transitions=Object.freeze({PENDING:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['SERVED','CANCELLED'],SERVED:[],CANCELLED:[]});
export function kitchenTransitionAllowed(from,to){return Array.isArray(transitions[from])&&transitions[from].includes(to);}
export function kitchenRead(db,method,route){
 if(method!=='GET')return null;
 if(route==='/api/kitchen/tickets') {
    const tickets=db.prepare(`SELECT kt.id,kt.order_id AS orderId,kt.line_id AS lineId,kt.status,kt.revision,
      kt.created_at AS createdAt,ol.product_name_snapshot AS productName,ol.quantity,ol.note_snapshot AS note,
      (SELECT group_concat(name_snapshot, ', ') FROM order_line_modifier WHERE line_id=kt.line_id) AS modifiers,
      (SELECT group_concat(quantity||'x '||product_name_snapshot, ', ') FROM order_line_combo_item WHERE line_id=kt.line_id) AS comboDetails,
      so.service_mode AS serviceMode,st.label AS tableLabel
      FROM kitchen_ticket kt JOIN order_line ol ON ol.id=kt.line_id
      JOIN sales_order so ON so.id=kt.order_id LEFT JOIN service_table st ON st.id=so.service_table_id
      WHERE kt.status IN ('PENDING','PREPARING','READY') ORDER BY kt.created_at ASC LIMIT 200`).all();
    return {status:200,body:{tickets}};
  }
 return null;
}
export function kitchenWrite(db,method,route,body,h){
 const {transact,missing,conflict,audit,stamp}=h;
 const ticket=route.match(/^\/api\/kitchen\/tickets\/([^/]+)\/status$/);
  if(method==='POST'&&ticket)return transact(db,route,body,()=>{
    const id=ticket[1];const row=db.prepare('SELECT * FROM kitchen_ticket WHERE id=?').get(id);
    if(!row)missing('Ticket da cozinha');
    if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==row.revision)conflict('Ticket alterado por outro dispositivo','REVISION_CONFLICT');
    if(!kitchenTransitionAllowed(row.status,body.status))conflict('Mudança de preparo inválida','INVALID_KITCHEN_TRANSITION');
    db.prepare('UPDATE kitchen_ticket SET status=?,revision=revision+1,updated_at=? WHERE id=?').run(body.status,stamp(),id);
    audit(db,row.order_id,'KITCHEN_STATUS_CHANGED',{ticketId:id,from:row.status,to:body.status});
    return {ticket:{id,status:body.status,revision:row.revision+1}};
  });
 return null;
}
