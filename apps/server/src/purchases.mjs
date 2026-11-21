/** Purchase orders over canonical SQLite inventory. No balance duplication. */
import {randomUUID} from 'node:crypto';
import {recordReceivedBatch} from './retail-supply.mjs';
import {receiveIngredientMovement} from './inventory.mjs';
const positive=x=>Number.isSafeInteger(x)&&x>0;
const cents=x=>Number.isSafeInteger(x)&&x>=0;
export function purchasesRead(db,method,route){
 if(method!=='GET')return null;
 if(route==='/api/purchases'){
  const purchases=db.prepare("SELECT p.id,p.supplier_id AS supplierId,s.name AS supplierName,p.status,p.note,p.created_at AS createdAt,p.received_at AS receivedAt FROM purchase_order p JOIN supplier s ON s.id=p.supplier_id ORDER BY p.created_at DESC,p.id DESC LIMIT 100").all();
  return {status:200,body:{purchases}};
 }
 const match=route.match(/^\/api\/purchases\/([^/]+)$/);
 if(!match)return null;
 const order=db.prepare("SELECT id,supplier_id AS supplierId,status,note,created_at AS createdAt,received_at AS receivedAt FROM purchase_order WHERE id=?").get(match[1]);
 if(!order)return {status:404,body:{code:'NOT_FOUND',message:'Compra não encontrada'}};
 const items=db.prepare("SELECT id,ingredient_id AS ingredientId,quantity_milli AS quantityMilli,cost_cents AS costCents,lot_code AS lotCode,expiry_date AS expiryDate FROM purchase_order_line WHERE purchase_id=? ORDER BY rowid").all(match[1]);
 return {status:200,body:{purchase:{...order,items}}};
}
export function purchasesWrite(db,method,route,body,h){
 if(method==='POST'&&route==='/api/purchases')return h.transact(db,route,body,()=>{
  if(typeof body.supplierId!=='string')h.bad('Fornecedor obrigatório');
  const supplier=db.prepare('SELECT id FROM supplier WHERE id=? AND active=1').get(body.supplierId);
  if(!supplier)h.missing('Fornecedor ativo');
  const note=body.note===undefined?'':h.requireString(body.note,'Observação',240);
  if(!Array.isArray(body.items)||!body.items.length||body.items.length>50)h.bad('Informe de 1 a 50 itens');
  const lines=body.items.map(item=>{
   if(typeof item!=='object'||!item||typeof item.ingredientId!=='string'||!positive(item.quantityMilli)||!cents(item.costCents))
    h.bad('Ingrediente, quantidade ou custo inválido');
   const ing=db.prepare('SELECT id,active FROM stock_ingredient WHERE id=?').get(item.ingredientId);
   if(!ing||!ing.active)h.missing('Ingrediente ativo');
   const hasLot=item.lotCode!==undefined||item.expiryDate!==undefined;
   if(hasLot){
    if(typeof item.lotCode!=='string'||!item.lotCode.trim()||item.lotCode.length>64||
      typeof item.expiryDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(item.expiryDate))
       h.bad('Lote e data de validade obrigatórios juntos');
    const d=new Date(item.expiryDate+'T00:00:00.000Z');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==item.expiryDate)h.bad('Validade inválida');
   }
   return {id:randomUUID(),ingredientId:item.ingredientId,quantityMilli:item.quantityMilli,costCents:item.costCents,
     lotCode:hasLot?item.lotCode.trim():null,expiryDate:hasLot?item.expiryDate:null};
  });
  const id=randomUUID(),createdAt=h.stamp();
  db.prepare("INSERT INTO purchase_order(id,supplier_id,note,actor_id,created_at) VALUES(?,?,?,?,?)").run(id,supplier.id,note,h.actor,createdAt);
  const insert=db.prepare("INSERT INTO purchase_order_line(id,purchase_id,ingredient_id,quantity_milli,cost_cents,lot_code,expiry_date) VALUES(?,?,?,?,?,?,?)");
  for(const line of lines)insert.run(line.id,id,line.ingredientId,line.quantityMilli,line.costCents,line.lotCode,line.expiryDate);
  h.audit(db,id,'PURCHASE_CREATED',{supplierId:supplier.id,lineCount:lines.length});
  return {purchase:{id,supplierId:supplier.id,status:'DRAFT',createdAt,items:lines}};
 },201);
 const receiver=route.match(/^\/api\/purchases\/([^/]+)\/(receive|cancel)$/);
 if(method!=='POST'||!receiver)return null;
 const [,id,action]=receiver;
 return h.transact(db,route,body,()=>{
  const order=db.prepare('SELECT * FROM purchase_order WHERE id=?').get(id);
  if(!order)h.missing('Compra');
  if(order.status!=='DRAFT')h.conflict('Pedido de compra já encerrado','PURCHASE_CLOSED');
  if(action==='cancel'){
   const reason=h.requireString(body.reason,'Motivo',240);
   db.prepare("UPDATE purchase_order SET status='CANCELLED' WHERE id=?").run(id);
   h.audit(db,id,'PURCHASE_CANCELLED',{reason});
   return {purchaseId:id,status:'CANCELLED'};
  }
  const lines=db.prepare('SELECT * FROM purchase_order_line WHERE purchase_id=? ORDER BY rowid').all(id);
  const movements=[];
  for(const line of lines){
   const lot=recordReceivedBatch(db,line.ingredient_id,{
     ...(line.lot_code?{lotCode:line.lot_code,expiryDate:line.expiry_date,supplierId:order.supplier_id}:{})
   },line.quantity_milli,h.stamp,h.bad,h.missing);
   const movement=receiveIngredientMovement(db,line.ingredient_id,line.quantity_milli,line.cost_cents,h.actor,id,h.missing);
   movements.push({ingredientId:line.ingredient_id,movementId:movement.id,batchId:lot});
  }
  const receivedAt=h.stamp();
  db.prepare("UPDATE purchase_order SET status='RECEIVED',received_at=? WHERE id=?").run(receivedAt,id);
  h.audit(db,id,'PURCHASE_RECEIVED',{movements});
  return {purchaseId:id,status:'RECEIVED',receivedAt,movements};
 },201);
}
