/** Durable audit event; the actor comes exclusively from the authenticated request context. */
import {randomUUID} from 'node:crypto';
export function audit(db,aggregateId,action,payload={},actor){
 if(typeof actor!=='string'||!actor.trim())throw new Error('Identidade de auditoria obrigatória');
 db.prepare('INSERT INTO audit_log(id,aggregate_id,action,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?)')
  .run(randomUUID(),aggregateId,action,actor,JSON.stringify(payload),new Date().toISOString());
}
