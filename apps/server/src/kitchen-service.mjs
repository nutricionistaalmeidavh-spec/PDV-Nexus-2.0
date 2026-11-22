/** KDS: tickets persistentes por lineId, revisão otimista e transições válidas. */
import {randomUUID} from 'node:crypto';
export function dispatchKitchenTickets(db,orderId,stamp) {
  // Uma linha de pedido gera um ticket, inclusive quando adicionada após confirmação.
  const lines=db.prepare(`SELECT ol.id,p.kitchen_station_id AS stationId FROM order_line ol
    JOIN menu_product p ON p.id=ol.product_id WHERE ol.order_id=? AND ol.cancelled_at IS NULL`).all(orderId);
  const insert=db.prepare("INSERT OR IGNORE INTO kitchen_ticket(id,order_id,line_id,status,revision,created_at,updated_at,kitchen_station_id) VALUES(?,?,?,'PENDING',0,?,?,?)");
  for(const line of lines) {
    const now=stamp();
    insert.run(randomUUID(),orderId,line.id,now,now,line.stationId??null);
  }
}
const transitions=Object.freeze({PENDING:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['SERVED','CANCELLED'],SERVED:[],CANCELLED:[]});
export function kitchenTransitionAllowed(from,to){return Array.isArray(transitions[from])&&transitions[from].includes(to);}
const priority=status=>status==='PENDING'?0:status==='PREPARING'?1:2;
function decodePageCursor(raw,h){
 if(raw===null)return null;
 if(typeof raw!=='string'||raw.length<12||raw.length>512||!/^[A-Za-z0-9_-]+$/.test(raw))h.bad('Cursor de paginação inválido');
 let data;
 try{
  const text=Buffer.from(raw,'base64url').toString('utf8');
  if(Buffer.from(text).toString('base64url')!==raw)throw Error('canonical');
  data=JSON.parse(text);
 }catch{h.bad('Cursor de paginação inválido');}
 if(!Array.isArray(data)||data.length!==3||![0,1,2].includes(data[0])||
   typeof data[1]!=='string'||!/^\\d{4}-\\d{2}-\\d{2}T/.test(data[1])||data[1].length>40||
   typeof data[2]!=='string'||!/^[-a-z0-9]{8,64}$/i.test(data[2]))
   h.bad('Cursor de paginação inválido');
 return data;
}
function encodePageCursor(ticket){
 return Buffer.from(JSON.stringify([priority(ticket.status),ticket.createdAt,ticket.id])).toString('base64url');
}
export function kitchenRead(db,method,route,h,params=new URLSearchParams()){
 if(method!=='GET')return null;
 if(route==='/api/kitchen/tickets') {
    const rawLimit=params.get('limit'),limit=rawLimit===null?200:Number(rawLimit);
    if(rawLimit!==null&&(!/^[1-9]\\d*$/.test(rawLimit)||!Number.isSafeInteger(limit)||limit>200))
      h.bad('Limite de paginação inválido');
    const cursor=decodePageCursor(params.get('cursor'),h);
    const station=params.get('stationId');
    if(station!==null&&(station.length>128||!/^[-_a-zA-Z0-9]+$/.test(station)))h.bad('Estação inválida');
    const rank="CASE kt.status WHEN 'PENDING' THEN 0 WHEN 'PREPARING' THEN 1 ELSE 2 END";
    const tickets=db.prepare(`SELECT kt.id,kt.order_id AS orderId,kt.line_id AS lineId,kt.status,kt.revision,
      kt.created_at AS createdAt,kt.change_note AS changeNote,kt.kitchen_station_id AS stationId,ks.name AS stationName,ol.product_name_snapshot AS productName,ol.quantity,ol.note_snapshot AS note,
      (SELECT group_concat(name_snapshot, ', ') FROM order_line_modifier WHERE line_id=kt.line_id) AS modifiers,
      (SELECT group_concat(quantity||'x '||product_name_snapshot, ', ') FROM order_line_combo_item WHERE line_id=kt.line_id) AS comboDetails,
      so.service_mode AS serviceMode,st.label AS tableLabel,
      so.status AS orderStatus,so.id AS attendanceId,
      CASE WHEN so.status='CLOSED' THEN 1 ELSE 0 END AS paid,
      ow.waiter_device_id AS waiterDeviceId,pd.label AS waiterName,
      dc.waiter_device_id AS claimedBy
      FROM kitchen_ticket kt JOIN order_line ol ON ol.id=kt.line_id
      JOIN sales_order so ON so.id=kt.order_id LEFT JOIN service_table st ON st.id=so.service_table_id LEFT JOIN kitchen_station ks ON ks.id=kt.kitchen_station_id
      LEFT JOIN order_waiter ow ON ow.order_id=so.id LEFT JOIN paired_device pd ON pd.id=ow.waiter_device_id
      LEFT JOIN kitchen_delivery_claim dc ON dc.ticket_id=kt.id
      WHERE (kt.status IN ('PENDING','PREPARING','READY') OR (kt.status='CANCELLED' AND kt.change_note IS NOT NULL AND kt.updated_at>=?))
        AND (? IS NULL OR kt.kitchen_station_id=?)
        AND (? IS NULL OR ${rank}>? OR (${rank}=? AND kt.created_at<?) OR (${rank}=? AND kt.created_at=? AND kt.id<?))
      ORDER BY ${rank}, kt.created_at DESC, kt.id DESC LIMIT ?`).all(
        new Date(Date.now()-12*3600*1000).toISOString(),station,station,
        cursor?1:null,cursor?.[0]??0,cursor?.[0]??0,cursor?.[1]??'',cursor?.[0]??0,cursor?.[1]??'',cursor?.[2]??'',limit+1
      );
    const hasMore=tickets.length>limit;
    const visible=tickets.slice(0,limit);
    for(const ticket of visible)ticket.paid=!!ticket.paid;
    return {status:200,body:{tickets:visible,hasMore,nextCursor:hasMore?encodePageCursor(visible.at(-1)):null,pageSize:limit}};
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
