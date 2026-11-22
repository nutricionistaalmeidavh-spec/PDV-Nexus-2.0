/** Resumo financeiro remoto via HTTPS privado, somente leitura e sem PII.
 * O endpoint não grava revisões, pedidos, pagamentos ou inventário. */
import {createHash} from 'node:crypto';
import {localSummary} from './multiunit-sync.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safe=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const keys=['schemaVersion','documentType','unitId','generatedAt','daily'];
const dailyKeys=['day','orderCount','grossSalesCents','refundedCents','cogsCents','netSalesCents'];
const validDay=x=>{
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;
 const date=new Date(x+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===x;
};
function payload(p){return {schemaVersion:p.schemaVersion,documentType:p.documentType,
 unitId:p.unitId,generatedAt:p.generatedAt,daily:p.daily};}
export function verifyLiveSummary(p){
 if(!exact(p,[...keys,'hash'])||p.schemaVersion!==1||p.documentType!=='PDV_NEXUS_BI_DAILY_READONLY'||
   !/^unit-[a-f0-9]{32}$/.test(p.unitId)||typeof p.generatedAt!=='string'||
   !Number.isFinite(Date.parse(p.generatedAt))||!Array.isArray(p.daily)||p.daily.length>2000||
   typeof p.hash!=='string'||! /^[a-f0-9]{64}$/.test(p.hash))
  throw Error('Pacote de BI inválido');
 let previous='';
 for(const row of p.daily){
  if(!exact(row,dailyKeys)||!validDay(row.day)||row.day<=previous||
     !dailyKeys.slice(1).every(k=>safe(row[k]))||
     row.refundedCents>row.grossSalesCents||
     row.netSalesCents!==row.grossSalesCents-row.refundedCents)
    throw Error('Linha de resumo inválida');
  previous=row.day;
 }
 if(Buffer.byteLength(JSON.stringify(p),'utf8')>524288)throw Error('Resumo de BI excede limite');
 if(hash(payload(p))!==p.hash)throw Error('Hash do resumo de BI não confere');
 return p;
}
export function liveSummaryRead(db,method,route){
 if(method!=='GET'||route!=='/api/sync/summary/daily')return null;
 const unitId=db.prepare("SELECT unit_id AS unitId FROM installation_identity WHERE id='local'").get().unitId;
 const content={schemaVersion:1,documentType:'PDV_NEXUS_BI_DAILY_READONLY',
  unitId,generatedAt:new Date().toISOString(),daily:localSummary(db)};
 const packet={...content,hash:hash(content)};
 verifyLiveSummary(packet);
 return {status:200,body:packet};
}
