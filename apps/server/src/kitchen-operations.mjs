/** P1: setores KDS, perfis de impressão e comprovantes não fiscais. */
import {randomUUID} from 'node:crypto';
import {isPrivateIpv4} from './private-network.mjs';
import {validateSerialDevicePath} from './retail-hardware.mjs';
import {validatePrinterQueueName} from './windows-raw-printer.mjs';
const allowedKind={PREBILL:'PRINT_PREBILL',KITCHEN:'PRINT_KITCHEN'};
export function kitchenOperationsRead(db,method,route){
 if(method!=='GET')return null;
 if(route==='/api/kitchen/stations'){
  const stations=db.prepare(`SELECT s.id,s.name,s.active,s.printer_profile_id AS printerProfileId,
    (SELECT COUNT(*) FROM kitchen_ticket t WHERE t.kitchen_station_id=s.id AND t.status IN ('PENDING','PREPARING')) AS activeTickets
    FROM kitchen_station s WHERE s.restaurant_id='r-local' ORDER BY s.name`).all();
  return {status:200,body:{stations}};
 }
 if(route==='/api/printer/profiles'){
  const profiles=db.prepare(`SELECT id,host,port,enabled,transport,device_path AS devicePath,baud_rate AS baudRate
    FROM printer_profile ORDER BY id`).all();
  return {status:200,body:{profiles}};
 }
 return null;
}
export function kitchenOperationsWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 if(route==='/api/kitchen/stations')return h.transact(db,route,body,()=>{
  const name=h.requireString(body.name,'Estação',80);
  if(db.prepare('SELECT id FROM kitchen_station WHERE name=? COLLATE NOCASE').get(name))h.conflict('Estação já existente','STATION_EXISTS');
  const station={id:randomUUID(),name,active:1,printerProfileId:null};
  db.prepare(`INSERT INTO kitchen_station(id,restaurant_id,name) VALUES(?,'r-local',?)`).run(station.id,station.name);
  h.audit(db,station.id,'KITCHEN_STATION_CREATED',{name});
  return {station};
 },201);
 const assign=route.match(/^\/api\/products\/([^/]+)\/station$/);
 if(assign)return h.transact(db,route,body,()=>{
  const product=db.prepare('SELECT id FROM menu_product WHERE id=?').get(assign[1]);
  if(!product)h.missing('Produto');
  if(body.stationId!==null&&typeof body.stationId!=='string')h.bad('Estação inválida');
  if(body.stationId&&!db.prepare('SELECT id FROM kitchen_station WHERE id=? AND active=1').get(body.stationId))
   h.missing('Estação ativa');
  db.prepare('UPDATE menu_product SET kitchen_station_id=? WHERE id=?').run(body.stationId,product.id);
  h.audit(db,product.id,'PRODUCT_STATION_ASSIGNED',{stationId:body.stationId});
  return {productId:product.id,stationId:body.stationId};
 });
 const profile=route.match(/^\/api\/kitchen\/stations\/([^/]+)\/profile$/);
 if(profile)return h.transact(db,route,body,()=>{
  if(!db.prepare('SELECT id FROM kitchen_station WHERE id=?').get(profile[1]))h.missing('Estação');
  if(body.profileId!==null&&typeof body.profileId!=='string')h.bad('Perfil inválido');
  if(body.profileId&&!db.prepare('SELECT 1 FROM printer_profile WHERE id=? AND enabled=1').get(body.profileId))h.missing('Impressora habilitada');
  db.prepare('UPDATE kitchen_station SET printer_profile_id=? WHERE id=?').run(body.profileId,profile[1]);
  h.audit(db,profile[1],'STATION_PRINTER_ASSIGNED',{profileId:body.profileId});
  return {stationId:profile[1],profileId:body.profileId};
 });
 if(route==='/api/printer/profiles')return h.transact(db,route,body,()=>{
  const id=h.requireString(body.id,'Identificador de impressora',64);
  if(!/^[a-zA-Z0-9_-]{2,64}$/.test(id)||id==='default')h.bad('Use um identificador exclusivo');
  const transport=body.transport??'tcp';
  if(!['tcp','serial','windows'].includes(transport))h.bad('Transporte inválido');
  let host='127.0.0.1',port=9100,devicePath=null,baudRate=9600;
  if(transport==='tcp'){
   host=h.requireString(body.host,'IP da impressora',64);
   port=body.port;
   if(!isPrivateIpv4(host)||!Number.isInteger(port)||port<1||port>65535)h.bad('IP privado/porta inválidos');
  }else{
   devicePath=h.requireString(body.devicePath,'Porta ou fila da impressora',128);
   if(transport==='serial'){
    if(!validateSerialDevicePath(devicePath))h.bad('Porta serial inválida');
    baudRate=body.baudRate??9600;
    if(![9600,19200,38400,57600,115200].includes(baudRate))h.bad('Baud rate inválido');
   }else if(!validatePrinterQueueName(devicePath))h.bad('Fila Windows inválida');
  }
  if(db.prepare('SELECT 1 FROM printer_profile WHERE id=?').get(id))h.conflict('Perfil existente');
  db.prepare(`INSERT INTO printer_profile(id,host,port,enabled,transport,device_path,baud_rate)
   VALUES(?,?,?,1,?,?,?)`).run(id,host,port,transport,devicePath,baudRate);
  h.audit(db,id,'PRINTER_PROFILE_CREATED',{transport,host,port,devicePath});
  return {profile:{id,host,port,transport,devicePath,baudRate}};
 },201);
 const orderPrint=route.match(/^\/api\/orders\/([^/]+)\/print$/);
 if(orderPrint)return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,orderPrint[1]);
  if(!['PREBILL','KITCHEN'].includes(body.type))h.bad('Tipo de comprovante inválido');
  if(order.status==='CANCELLED')h.conflict('Pedido cancelado');
  let lines=order.lines,profileId=null,stationName=null;
  if(body.type==='KITCHEN'){
   if(order.status==='DRAFT')h.conflict('Confirme a comanda para imprimir cozinha');
   if(body.stationId!==null&&body.stationId!==undefined){
    const station=db.prepare('SELECT name,printer_profile_id AS profileId FROM kitchen_station WHERE id=? AND active=1').get(body.stationId);
    if(!station)h.missing('Estação');
    stationName=station.name;profileId=station.profileId;
   }
   const ticketLines=db.prepare(`SELECT line_id FROM kitchen_ticket WHERE order_id=?
     AND kitchen_station_id IS ? AND status<>'CANCELLED'`).all(order.id,body.stationId??null).map(x=>x.line_id);
   lines=order.lines.filter(x=>ticketLines.includes(x.id));
   if(!lines.length)h.conflict('Nenhum ticket para essa estação');
  }
  const id=randomUUID(),kind=allowedKind[body.type];
  db.prepare(`INSERT INTO outbox_event(id,kind,aggregate_id,payload_json,status,created_at)
   VALUES(?,?,?,?,'PENDING',?)`).run(id,kind,order.id,JSON.stringify({
    id:order.id,orderNumber:order.orderNumber,kind:body.type,stationName,profileId,lines,totalCents:lines.reduce((sum,l)=>sum+l.quantity*l.unitPriceCents,0),
    tableId:order.tableId,nonFiscal:true
   }),h.stamp());
  h.audit(db,order.id,'OPERATIONAL_PRINT_QUEUED',{jobId:id,kind,stationId:body.stationId??null});
  return {printJob:{id,kind,profileId,status:'PENDING'}};
 },201);
 if(route==='/api/cash/print')return h.transact(db,route,body,()=>{
  const session=body.sessionId?db.prepare('SELECT * FROM cash_session WHERE id=?').get(body.sessionId):
   db.prepare('SELECT * FROM cash_session ORDER BY opened_at DESC LIMIT 1').get();
  if(!session)h.missing('Sessão do caixa');
  if(session.status!=='CLOSED')h.conflict('Feche o caixa antes de imprimir');
  const id=randomUUID();
  const payload={kind:'CASH_CLOSING',id:session.id,openedAt:session.opened_at,closedAt:session.closed_at,
    expectedCents:session.expected_amount_cents,countedCents:session.counted_amount_cents,
    differenceCents:session.counted_amount_cents-session.expected_amount_cents,lines:[],totalCents:session.expected_amount_cents};
  db.prepare(`INSERT INTO outbox_event(id,kind,aggregate_id,payload_json,status,created_at)
   VALUES(?,'PRINT_CASH_CLOSING',?,?,'PENDING',?)`).run(id,session.id,JSON.stringify(payload),h.stamp());
  h.audit(db,session.id,'CASH_CLOSING_PRINT_QUEUED',{jobId:id});
  return {printJob:{id,kind:'PRINT_CASH_CLOSING'}};
 },201);
 return null;
}
