/** P2: physical reading captured server-side, short lived and consumed once. */
import {randomUUID} from 'node:crypto';
import {addOrderLine} from '../../../packages/core/src/order.ts';
import {parseScaleSerial,validateSerialDevicePath} from './retail-hardware.mjs';
import {dispatchKitchenTickets} from './restaurant.mjs';
export function weightedPriceCents(pricePerKgCents,weightGrams){
 if(!Number.isSafeInteger(weightGrams)||weightGrams<1||weightGrams>100000)throw new Error('Peso inválido');
 if(!Number.isSafeInteger(pricePerKgCents)||pricePerKgCents<0)throw new Error('Preço por kg inválido');
 const amount=(BigInt(pricePerKgCents)*BigInt(weightGrams)+500n)/1000n;
 if(amount>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Total excede precisão');
 return Number(amount);
}
export async function readSerialWeight({devicePath,baudRate,brand},timeoutMs=6000){
 if(!validateSerialDevicePath(devicePath)||![9600,19200,38400,57600,115200].includes(baudRate))
  throw new Error('Balança não configurada com porta serial válida');
 let SerialPort;
 try{({SerialPort}=await import('serialport'));}
 catch{throw new Error('Adaptador serialport opcional não instalado neste computador');}
 const port=new SerialPort({path:devicePath,baudRate,autoOpen:false});
 return await new Promise((resolve,reject)=>{
  let completed=false,buffer='',previous=null,consecutive=0;
  const finish=(err,val)=>{
   if(completed)return;completed=true;clearTimeout(timeout);
   port.removeAllListeners('data');port.removeAllListeners('error');
   if(port.isOpen)port.close(()=>{});
   if(err)reject(err);else resolve(val);
  };
  const timeout=setTimeout(()=>finish(new Error('Sem peso estável; tente novamente')),timeoutMs);
  port.on('error',e=>finish(e));
  port.on('data',chunk=>{
   buffer+=String(chunk);
   if(buffer.length>2048){finish(new Error('Quadro serial excede limite'));return;}
   const frames=buffer.split(/[\r\n]+/);buffer=frames.pop()??'';
   for(const frame of frames){
    if(!frame.trim())continue;
    let reading;
    try{reading=parseScaleSerial(frame,{brand});}catch{previous=null;consecutive=0;continue;}
    if(!reading.stable||reading.weightGrams<1){previous=null;consecutive=0;continue;}
    consecutive=reading.weightGrams===previous?consecutive+1:1;
    previous=reading.weightGrams;
    if(consecutive>=2){finish(null,{weightGrams:reading.weightGrams,stable:true,brand});return;}
   }
  });
  port.open(e=>{if(e)finish(e)});
 });
}
export function scaleRead(db,method,route){
 if(method!=='GET'||route!=='/api/hardware/scale/config')return null;
 const config=db.prepare('SELECT device_path AS devicePath,baud_rate AS baudRate,brand FROM scale_config WHERE id=?').get('default');
 return {status:200,body:{config:config??null,driverRequired:true}};
}
export function scaleWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 if(route==='/api/hardware/scale/config')return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Balança exige supervisor','SUPERVISOR_REQUIRED');
  if(!validateSerialDevicePath(body.devicePath)||![9600,19200,38400,57600,115200].includes(body.baudRate)
   ||!['generic','toledo','filizola'].includes(body.brand))h.bad('Parâmetros da balança inválidos');
  db.prepare(`INSERT INTO scale_config(id,device_path,baud_rate,brand) VALUES('default',?,?,?)
    ON CONFLICT(id) DO UPDATE SET device_path=excluded.device_path,baud_rate=excluded.baud_rate,brand=excluded.brand`)
    .run(body.devicePath,body.baudRate,body.brand);
  h.audit(db,'r-local','SCALE_CONFIGURED',{devicePath:body.devicePath,baudRate:body.baudRate,brand:body.brand});
  return {configured:true};
 });
 const m=route.match(/^\/api\/orders\/([^/]+)\/weighted-lines$/);
 if(!m)return null;
 return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,m[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status))h.conflict('Pedido encerrado');
  if(db.prepare('SELECT suspended_at FROM sales_order WHERE id=?').get(order.id)?.suspended_at)h.conflict('Retome a venda primeiro');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=?').get(order.id))h.conflict('Comanda já possui pagamento','ORDER_ALREADY_PAID');
  if(typeof body.readingId!=='string')h.bad('Leitura da balança obrigatória');
  const reading=db.prepare('SELECT * FROM scale_reading WHERE id=?').get(body.readingId);
  if(!reading||reading.stable!==1||reading.consumed_line_id||Date.parse(reading.expires_at)<=Date.now())
    h.conflict('Peso expirado, instável ou já utilizado','INVALID_WEIGHT_READING');
  const product=db.prepare("SELECT id,name,price_cents AS pricePerKgCents FROM menu_product WHERE id=? AND active=1 AND sale_unit='kg'").get(body.productId);
  if(!product)h.missing('Produto ativo configurado para venda por kg');
  const price=weightedPriceCents(product.pricePerKgCents,reading.weight_grams);
  const label='Peso '+(reading.weight_grams/1000).toFixed(3)+' kg';
  const next=addOrderLine(order,{id:randomUUID(),productId:product.id,productName:product.name,unitPriceCents:price,quantity:1});
  const line=next.lines.at(-1);
  db.prepare(`INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity,note_snapshot)
    VALUES(?,?,?,?,?,?,?)`).run(line.id,order.id,product.id,product.name,price,1,label);
  h.snapshotLineRecipe(db,line.id,product.id);
  // Ficha técnica do produto por kg; snapshot de consumo reflete os gramas reais, sem segundo estoque.
  const recipes=db.prepare('SELECT ingredient_id,quantity_milli FROM order_line_recipe_snapshot WHERE line_id=?').all(line.id);
  for(const x of recipes){
   const qty=Number((BigInt(x.quantity_milli)*BigInt(reading.weight_grams)+500n)/1000n);
   if(!Number.isSafeInteger(qty)||qty<1)h.conflict('Ficha técnica incompatível com peso');
   db.prepare('UPDATE order_line_recipe_snapshot SET quantity_milli=? WHERE line_id=? AND ingredient_id=?').run(qty,line.id,x.ingredient_id);
  }
  db.prepare('INSERT INTO order_line_weight(line_id,reading_id,weight_grams,price_per_kg_cents) VALUES(?,?,?,?)')
   .run(line.id,reading.id,reading.weight_grams,product.pricePerKgCents);
  db.prepare('UPDATE scale_reading SET consumed_line_id=? WHERE id=?').run(line.id,reading.id);
  db.prepare('UPDATE sales_order SET revision=? WHERE id=?').run(next.revision,order.id);
  if(next.status==='OPEN')dispatchKitchenTickets(db,order.id,h.stamp);
  h.audit(db,order.id,'WEIGHTED_ITEM_ADDED',{lineId:line.id,readingId:reading.id,weightGrams:reading.weight_grams,pricePerKgCents:product.pricePerKgCents,amountCents:price});
  return {order:h.databaseOrder(db,order.id),weight:{lineId:line.id,weightGrams:reading.weight_grams,pricePerKgCents:product.pricePerKgCents,amountCents:price}};
 });
}
export function recordScaleCapture(db,reading,h){
 if(!reading.stable||!Number.isSafeInteger(reading.weightGrams)||reading.weightGrams<1)h.conflict('Leitura instável','UNSTABLE_WEIGHT');
 const id=randomUUID(),now=h.stamp(),expires=new Date(Date.now()+30000).toISOString();
 db.prepare('INSERT INTO scale_reading(id,weight_grams,stable,created_at,expires_at) VALUES(?,?,1,?,?)').run(id,reading.weightGrams,now,expires);
 h.audit(db,'r-local','SCALE_WEIGHT_CAPTURED',{readingId:id,weightGrams:reading.weightGrams});
 return {readingId:id,weightGrams:reading.weightGrams,stable:true,expiresAt:expires};
}
