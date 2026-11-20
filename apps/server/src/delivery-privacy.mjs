/** Explicit local data minimization for completed/rejected delivery requests. */
const now=()=>new Date().toISOString();
function eligible(db,id){
 const row=db.prepare(`SELECT r.id,r.status,r.anonymized_at AS anonymizedAt,
   d.status AS deliveryStatus,o.status AS orderStatus
   FROM delivery_request r LEFT JOIN delivery_order d ON d.request_id=r.id
   LEFT JOIN sales_order o ON o.id=d.order_id WHERE r.id=?`).get(id);
 if(!row)return null;
 return {...row,mayAnonymize:row.status==='REJECTED'||(row.status==='ACCEPTED'&&
   ['DELIVERED','CANCELLED'].includes(row.deliveryStatus)&&['CLOSED','CANCELLED'].includes(row.orderStatus))};
}
function anonymize(db,id){
 const stamp=now();
 db.prepare("UPDATE delivery_request SET customer_name='Cliente anonimizado',phone='00000000000',address='Endereço anonimizado',note='',decision_reason='',request_fingerprint=NULL,anonymized_at=? WHERE id=? AND anonymized_at IS NULL")
   .run(stamp,id);
 // A rejected-delivery audit may contain an operator-entered reason; do not retain its free text.
 db.prepare("UPDATE audit_log SET payload_json='{\"redacted\":true}' WHERE aggregate_id=? AND action='DELIVERY_REJECTED'").run(id);
 return stamp;
}
export function privacyRead(db,method,route){
 if(method!=='GET'||route!=='/api/delivery/privacy/report')return null;
 const states=db.prepare('SELECT status,COUNT(*) AS amount FROM delivery_request GROUP BY status').all();
 const obj={pending:0,accepted:0,rejected:0,anonymized:db.prepare('SELECT COUNT(*) AS c FROM delivery_request WHERE anonymized_at IS NOT NULL').get().c};
 for(const state of states)obj[state.status.toLowerCase()]=state.amount;
 return {status:200,body:obj};
}
export function privacyWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const requestId=route.match(/^\/api\/delivery\/requests\/([^/]+)\/anonymize$/);
 if(requestId)return h.transact(db,route,body,()=>{
  const current=eligible(db,requestId[1]);
  if(!current)h.missing('Solicitação');
  if(!current.mayAnonymize)h.conflict('Dados de entrega ainda necessários ao atendimento','DELIVERY_NOT_FINALIZED');
  if(current.anonymizedAt)return {anonymized:true,alreadyAnonymized:true,requestId:requestId[1]};
  const when=anonymize(db,requestId[1]);
  h.audit(db,requestId[1],'DELIVERY_ANONYMIZED',{at:when});
  return {anonymized:true,requestId:requestId[1]};
 });
 if(route==='/api/delivery/privacy/purge')return h.transact(db,route,body,()=>{
  const days=body.olderThanDays;
  if(!Number.isSafeInteger(days)||days<30||days>3650)h.bad('Prazo inválido: de 30 a 3650 dias');
  const cutoff=new Date(Date.now()-days*86400000).toISOString();
  const rows=db.prepare(`SELECT r.id FROM delivery_request r WHERE r.created_at<? AND r.anonymized_at IS NULL AND
    (r.status='REJECTED' OR (r.status='ACCEPTED' AND EXISTS
     (SELECT 1 FROM delivery_order d JOIN sales_order o ON o.id=d.order_id WHERE d.request_id=r.id
      AND d.status IN ('DELIVERED','CANCELLED') AND o.status IN ('CLOSED','CANCELLED'))))
    ORDER BY r.created_at ASC LIMIT 500`).all(cutoff);
  for(const row of rows)anonymize(db,row.id);
  h.audit(db,'r-local','DELIVERY_RETENTION_PURGE',{olderThanDays:days,anonymized:rows.length});
  return {anonymized:rows.length,cutoff};
 });
 return null;
}
