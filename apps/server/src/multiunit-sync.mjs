/** Zero-cloud, manual snapshot exchange. Never updates a peer's orders/stock. */
import {createHash,randomUUID} from 'node:crypto';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const now=()=>new Date().toISOString();
const safe=x=>Number.isSafeInteger(x)&&x>=0;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const keyset=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const packetKeys=['schemaVersion','documentType','unitId','daily','revision','previousHash','hash'];
const dayKeys=['day','orderCount','grossSalesCents','refundedCents','cogsCents','netSalesCents'];
const noHash=p=>({schemaVersion:p.schemaVersion,documentType:p.documentType,unitId:p.unitId,daily:p.daily,revision:p.revision,previousHash:p.previousHash});
const coreOf=p=>({schemaVersion:p.schemaVersion,documentType:p.documentType,unitId:p.unitId,daily:p.daily});
function unitId(db){return db.prepare("SELECT unit_id FROM installation_identity WHERE id='local'").get().unit_id;}
function totals(rows){
 const out={orders:0,grossSalesCents:0,refundedCents:0,cogsCents:0,netSalesCents:0};
 for(const row of rows){
   out.orders+=row.orderCount;
   for(const key of ['grossSalesCents','refundedCents','cogsCents','netSalesCents'])out[key]+=row[key];
   if(Object.values(out).some(x=>!safe(x)))throw Error('Agregado fora do limite seguro');
 }
 return out;
}
export function localSummary(db){
 const daily=db.prepare(`
  WITH gross AS (SELECT order_id,SUM(unit_price_cents*quantity) AS total FROM order_line WHERE cancelled_at IS NULL GROUP BY order_id),
       full_refunds AS (SELECT order_id,SUM(amount_cents) AS total FROM order_refund GROUP BY order_id),
       item_refunds AS (SELECT order_id,SUM(amount_cents) AS total FROM order_line_refund GROUP BY order_id),
       costs AS (SELECT source_order_id AS order_id,SUM(-value_delta_cents) AS total
                 FROM stock_movement WHERE kind='SALE' GROUP BY source_order_id)
  SELECT substr(o.closed_at,1,10) AS day,COUNT(*) AS orderCount,
         SUM(g.total) AS grossSalesCents,
         SUM(COALESCE(ref.total,0)+COALESCE(item_refunds.total,0)) AS refundedCents,
         SUM(COALESCE(costs.total,0)) AS cogsCents
  FROM sales_order o JOIN gross g ON g.order_id=o.id
  LEFT JOIN full_refunds ref ON ref.order_id=o.id
  LEFT JOIN item_refunds ON item_refunds.order_id=o.id
  LEFT JOIN costs ON costs.order_id=o.id
  WHERE o.status='CLOSED' AND o.closed_at IS NOT NULL
  GROUP BY substr(o.closed_at,1,10) ORDER BY day ASC`).all();
 return daily.map(r=>{
  const row={...r,netSalesCents:r.grossSalesCents-r.refundedCents};
  if(!keyset(row,dayKeys)||!validateDay(row))throw Error('Resumo financeiro inconsistente');
  return row;
 });
}
function validateDay(d){
 return keyset(d,dayKeys)&&typeof d.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d.day)&&
  Number.isFinite(Date.parse(d.day+'T00:00:00Z'))&&new Date(d.day+'T00:00:00Z').toISOString().slice(0,10)===d.day&&
  ['orderCount','grossSalesCents','refundedCents','cogsCents','netSalesCents'].every(k=>safe(d[k]))&&
  d.refundedCents<=d.grossSalesCents&&d.netSalesCents===d.grossSalesCents-d.refundedCents;
}
export function exportSnapshot(db){
 const content={schemaVersion:1,documentType:'PDV_NEXUS_UNIT_SUMMARY',unitId:unitId(db),daily:localSummary(db)};
 const contentHash=sha(content);
 db.exec('BEGIN IMMEDIATE');
 try{
  const previous=db.prepare("SELECT * FROM multiunit_export_state WHERE id='local'").get();
  if(previous?.content_hash===contentHash){db.exec('COMMIT');return JSON.parse(previous.packet_json);}
  const rev=(previous?.revision??0)+1;
  const payload={...content,revision:rev,previousHash:previous?.packet_hash??null};
  const packet={...payload,hash:sha(payload)};
  db.prepare("INSERT INTO multiunit_export_state(id,revision,content_hash,packet_hash,packet_json,updated_at) VALUES('local',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,content_hash=excluded.content_hash,packet_hash=excluded.packet_hash,packet_json=excluded.packet_json,updated_at=excluded.updated_at")
    .run(rev,contentHash,packet.hash,JSON.stringify(packet),now());
  db.exec('COMMIT');return packet;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
function validatePacket(p,bad){
 if(!keyset(p,packetKeys)||p.schemaVersion!==1||p.documentType!=='PDV_NEXUS_UNIT_SUMMARY'||
 !/^unit-[a-f0-9]{32}$/.test(p.unitId)||!safe(p.revision)||p.revision===0||
 !(p.previousHash===null||hex(p.previousHash))||!hex(p.hash)||!Array.isArray(p.daily)||p.daily.length>2000)
  bad('Pacote de unidade inválido');
 let last='';
 for(const day of p.daily){if(!validateDay(day)||day.day<=last)bad('Período inválido no pacote');last=day.day;}
 totals(p.daily);
 if(sha(noHash(p))!==p.hash)bad('Hash do pacote não confere; não importar dados alterados');
}
function readUnits(db){
 const local=localSummary(db);
 const peers=db.prepare('SELECT unit_id AS unitId,revision,packet_json AS packetJson,imported_at AS importedAt FROM multiunit_peer_snapshot ORDER BY unit_id').all();
 const units=[{unitId:unitId(db),local:true,revision:db.prepare("SELECT revision FROM multiunit_export_state WHERE id='local'").get()?.revision??0,totals:totals(local)}];
 for(const row of peers){
  const packet=JSON.parse(row.packetJson);
  units.push({unitId:row.unitId,local:false,revision:row.revision,importedAt:row.importedAt,totals:totals(packet.daily)});
 }
 const combined={orders:0,grossSalesCents:0,refundedCents:0,cogsCents:0,netSalesCents:0};
 for(const unit of units){for(const key of Object.keys(combined)){combined[key]+=unit.totals[key];if(!safe(combined[key]))throw Error('Total consolidado fora do limite');}}
 return {units,totals:combined,mode:'MANUAL_OPT_IN',operationalReplication:false};
}
export function syncRead(db,method,route){
 if(method!=='GET')return null;
 if(route==='/api/sync/export')return {status:200,body:exportSnapshot(db)};
 if(route==='/api/sync/units')return {status:200,body:readUnits(db)};
 if(route==='/api/sync/conflicts')return {status:200,body:{conflicts:db.prepare('SELECT id,unit_id AS unitId,revision,reason,created_at AS createdAt,resolved_at AS resolvedAt FROM multiunit_conflict ORDER BY created_at DESC LIMIT 100').all()}};
 return null;
}
export function syncWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 if(route==='/api/sync/import'){
  validatePacket(body.snapshot,h.bad);
  if(body.snapshot.unitId===unitId(db))h.bad('Não é possível importar dados da própria unidade');
  const result=h.transact(db,route,body,()=>{
   const p=body.snapshot;
   const previous=db.prepare('SELECT revision,packet_hash FROM multiunit_peer_snapshot WHERE unit_id=?').get(p.unitId);
   if(previous?.revision===p.revision&&previous.packet_hash===p.hash)return {imported:false,unitId:p.unitId,revision:p.revision};
   let reason;
   if(previous){
    if(p.revision<=previous.revision)reason='Revisão antiga ou divergente';
    else if(p.revision!==previous.revision+1||p.previousHash!==previous.packet_hash)reason='Histórico divergente: importe revisões intermediárias';
   }
   if(reason){
    db.prepare('INSERT INTO multiunit_conflict(id,unit_id,revision,attempted_hash,expected_hash,reason,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(),p.unitId,p.revision,p.hash,previous.packet_hash,reason,now());
    h.audit(db,p.unitId,'MULTIUNIT_CONFLICT',{revision:p.revision,reason});
    return {imported:false,conflict:true,code:'SYNC_CONFLICT',message:reason,unitId:p.unitId};
   }
   db.prepare('INSERT INTO multiunit_peer_snapshot(unit_id,revision,packet_hash,packet_json,imported_at) VALUES(?,?,?,?,?) ON CONFLICT(unit_id) DO UPDATE SET revision=excluded.revision,packet_hash=excluded.packet_hash,packet_json=excluded.packet_json,imported_at=excluded.imported_at')
     .run(p.unitId,p.revision,p.hash,JSON.stringify(p),now());
   h.audit(db,p.unitId,'MULTIUNIT_IMPORTED',{revision:p.revision,hash:p.hash});
   return {imported:true,unitId:p.unitId,revision:p.revision};
  });
  return {...result,status:result.body.conflict?409:result.body.imported?201:200};
 }
 const resolved=route.match(/^\/api\/sync\/conflicts\/([^/]+)\/dismiss$/);
 if(resolved)return h.transact(db,route,body,()=>{
  const row=db.prepare('SELECT * FROM multiunit_conflict WHERE id=?').get(resolved[1]);
  if(!row)h.missing('Conflito');
  db.prepare('UPDATE multiunit_conflict SET resolved_at=? WHERE id=? AND resolved_at IS NULL').run(now(),row.id);
  h.audit(db,row.unit_id,'MULTIUNIT_CONFLICT_DISMISSED',{id:row.id});
  return {dismissed:true,id:row.id};
 });
 return null;
}
