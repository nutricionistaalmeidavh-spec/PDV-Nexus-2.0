/** P1: station routing and non-fiscal receipt profiles; no mandatory drivers. */
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {validateSerialDevicePath} from './retail-hardware.mjs';
import {validatePrinterQueueName} from './windows-raw-printer.mjs';
const safeIPv4=ip=>net.isIP(ip)===4&&(/^(10|192\.168)\./.test(ip)||/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip));
export function kdsRead(db,method,route,params,h){
 if(method!=='GET')return null;
 if(route==='/api/kitchen/stations'){
  const stations=db.prepare('SELECT id,name,active,print_profile_id AS printProfileId FROM kitchen_station ORDER BY name').all();
  for(const station of stations)station.productIds=db.prepare('SELECT product_id AS productId FROM kitchen_station_product WHERE station_id=?').all(station.id).map(x=>x.productId);
  return {status:200,body:{stations}};
 }
 if(route==='/api/print/profiles')return {status:200,body:{profiles:db.prepare('SELECT id,label,transport,host,port,device_path AS devicePath,baud_rate AS baudRate,enabled FROM print_profile ORDER BY label').all()}};
 return null;
}
export function kdsWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 if(route==='/api/kitchen/stations')return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Configuração de produção exige supervisor','SUPERVISOR_REQUIRED');
  const name=h.requireString(body.name,'Estação',80);
  if(db.prepare('SELECT 1 FROM kitchen_station WHERE name=? COLLATE NOCASE').get(name))h.conflict('Estação já cadastrada');
  const station={id:randomUUID(),name,active:1};
  db.prepare('INSERT INTO kitchen_station(id,name) VALUES(?,?)').run(station.id,name);
  h.audit(db,station.id,'KITCHEN_STATION_CREATED',{name});
  return {station};
 },201);
 const mapping=route.match(/^\/api\/kitchen\/stations\/([^/]+)\/products$/);
 if(mapping)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Roteamento exige supervisor','SUPERVISOR_REQUIRED');
  const station=db.prepare('SELECT * FROM kitchen_station WHERE id=? AND active=1').get(mapping[1]);
  if(!station)h.missing('Estação ativa');
  const product=db.prepare('SELECT id FROM menu_product WHERE id=?').get(body.productId);
  if(!product)h.missing('Produto');
  db.prepare('INSERT INTO kitchen_station_product(product_id,station_id) VALUES(?,?) ON CONFLICT(product_id) DO UPDATE SET station_id=excluded.station_id')
    .run(product.id,station.id);
  h.audit(db,station.id,'KITCHEN_PRODUCT_ROUTED',{productId:product.id});
  return {stationId:station.id,productId:product.id};
 });
 const printer=route.match(/^\/api\/kitchen\/stations\/([^/]+)\/printer$/);
 if(printer)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Perfil de impressão exige supervisor','SUPERVISOR_REQUIRED');
  if(!db.prepare('SELECT 1 FROM kitchen_station WHERE id=?').get(printer[1]))h.missing('Estação');
  const id=body.profileId??null;
  if(id!==null&&!db.prepare('SELECT 1 FROM print_profile WHERE id=? AND enabled=1').get(id))h.missing('Perfil de impressão ativo');
  db.prepare('UPDATE kitchen_station SET print_profile_id=? WHERE id=?').run(id,printer[1]);
  h.audit(db,printer[1],'KITCHEN_PRINTER_ASSIGNED',{profileId:id});
  return {stationId:printer[1],printProfileId:id};
 });
 if(route==='/api/print/profiles')return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Configuração de impressora exige supervisor','SUPERVISOR_REQUIRED');
  const label=h.requireString(body.label,'Nome do perfil',80);
  const transport=body.transport;
  if(!['tcp','serial','windows'].includes(transport))h.bad('Transporte de impressão inválido');
  let host='',devicePath=null,port=9100,baudRate=9600;
  if(transport==='tcp'){
   host=h.requireString(body.host,'IP local',64);if(!safeIPv4(host))h.bad('Impressão exige IP privado');
   port=body.port??9100;if(!Number.isSafeInteger(port)||port<1||port>65535)h.bad('Porta inválida');
  }else{
   devicePath=h.requireString(body.devicePath,'Dispositivo de impressão',255);
   if(transport==='serial'&&!validateSerialDevicePath(devicePath))h.bad('Porta serial inválida');
   if(transport==='windows'&&!validatePrinterQueueName(devicePath))h.bad('Fila de impressão inválida');
   if(transport==='serial'){
    baudRate=body.baudRate??9600;
    if(![9600,19200,38400,57600,115200].includes(baudRate))h.bad('Baud rate inválido');
   }
  }
  const profile={id:randomUUID(),label,transport,host,port,devicePath,baudRate,enabled:1};
  db.prepare(`INSERT INTO print_profile(id,label,transport,host,port,device_path,baud_rate,enabled) VALUES(?,?,?,?,?,?,?,1)`)
    .run(profile.id,label,transport,host,port,devicePath,baudRate);
  h.audit(db,profile.id,'PRINT_PROFILE_CREATED',{label,transport});
  return {profile};
 },201);
 const print=route.match(/^\/api\/orders\/([^/]+)\/print-requests$/);
 if(print)return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,print[1]);
  const type=body.type;
  if(!['prebill','kitchen','close'].includes(type))h.bad('Tipo de comprovante inválido');
  if(type==='close'&&order.status!=='CLOSED')h.conflict('Fechamento ainda não concluído');
  if(type!=='close'&&order.status==='CANCELLED')h.conflict('Comanda cancelada');
  const stationId=body.stationId??null;
  if(stationId&&!db.prepare('SELECT 1 FROM kitchen_station WHERE id=?').get(stationId))h.missing('Estação');
  let profileId=body.profileId??null;
  if(profileId&&!db.prepare('SELECT 1 FROM print_profile WHERE id=? AND enabled=1').get(profileId))h.missing('Perfil de impressão');
  if(!profileId&&stationId)profileId=db.prepare('SELECT print_profile_id AS id FROM kitchen_station WHERE id=?').get(stationId)?.id??null;
  const lines=stationId&&type==='kitchen'?
    order.lines.filter(l=>db.prepare('SELECT station_id AS stationId FROM kitchen_ticket WHERE line_id=?').get(l.id)?.stationId===stationId):
    order.lines;
  if(!lines.length)h.conflict('Não há itens para este comprovante');
  const id=randomUUID(),payload={id:order.id,lines,totalCents:order.totalCents,
    type:type.toUpperCase(),stationId,profileId,createdAt:h.stamp()};
  db.prepare(`INSERT INTO outbox_event(id,kind,aggregate_id,payload_json,status,created_at)
    VALUES(?,'PRINT_RECEIPT',?,?,'PENDING',?)`).run(id,order.id,JSON.stringify(payload),h.stamp());
  h.audit(db,order.id,'OPERATIONAL_PRINT_QUEUED',{jobId:id,type,stationId,profileId});
  return {jobId:id,kind:type.toUpperCase(),orderId:order.id,profileId};
 },201);
 return null;
}
