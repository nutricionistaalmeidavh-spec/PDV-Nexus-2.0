/** Supplier/FEFO metadata over the existing single-writer ingredient ledger. */
import { randomUUID } from 'node:crypto';
import {businessDay} from './business-day.mjs';
const validDate=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00.000Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;};
const positive=n=>Number.isSafeInteger(n)&&n>0;
export function supplyRead(db,method,route,params){
  if(method!=='GET')return null;
  if(route==='/api/suppliers')
    return {status:200,body:{suppliers:db.prepare('SELECT id,name,document,active,created_at AS createdAt FROM supplier ORDER BY name COLLATE NOCASE').all()}};
  if(route==='/api/stock/batches'){
    const ingredientId=params.get('ingredientId');
    if(!ingredientId||ingredientId.length>128)return {status:400,body:{code:'INVALID_INPUT',message:'Selecione o ingrediente'}};
    const batches=db.prepare('SELECT id,ingredient_id AS ingredientId,supplier_id AS supplierId,lot_code AS lotCode,expiry_date AS expiryDate,received_milli AS receivedMilli,remaining_milli AS remainingMilli,created_at AS createdAt FROM ingredient_batch WHERE ingredient_id=? ORDER BY expiry_date,created_at,id').all(ingredientId);
    const onHand=db.prepare('SELECT on_hand_milli AS amount FROM stock_ingredient WHERE id=?').get(ingredientId)?.amount??0;
    const tracked=batches.reduce((a,b)=>a+b.remainingMilli,0);
    return {status:200,body:{batches,untrackedMilli:onHand-tracked}};
  }
  return null;
}
export function supplyWrite(db,method,route,body,h){
  const {transact,requireString,bad,missing,audit,stamp}=h;
  if(method==='POST'&&route==='/api/suppliers')return transact(db,route,body,()=>{
    const name=requireString(body.name,'Fornecedor',120);
    const document=body.document===undefined?'':String(body.document).trim();
    if(document.length>30)bad('Documento do fornecedor inválido');
    if(db.prepare('SELECT 1 FROM supplier WHERE name=? COLLATE NOCASE').get(name))h.conflict('Fornecedor já cadastrado');
    const supplier={id:randomUUID(),name,document,active:1,createdAt:stamp()};
    db.prepare('INSERT INTO supplier(id,name,document,created_at) VALUES(?,?,?,?)').run(supplier.id,name,document,supplier.createdAt);
    audit(db,supplier.id,'SUPPLIER_CREATED',{name});
    return {supplier};
  },201);
  const change=route.match(/^\/api\/suppliers\/([^/]+)$/);
  if(method==='PATCH'&&change)return transact(db,route,body,()=>{
    const found=db.prepare('SELECT * FROM supplier WHERE id=?').get(change[1]);if(!found)missing('Fornecedor');
    const name=body.name===undefined?found.name:requireString(body.name,'Fornecedor',120);
    if(typeof body.active!=='boolean'&&body.active!==undefined)bad('Estado inválido');
    const active=body.active===undefined?found.active:Number(body.active);
    db.prepare('UPDATE supplier SET name=?,active=? WHERE id=?').run(name,active,found.id);
    audit(db,found.id,'SUPPLIER_UPDATED',{name,active});
    return {supplier:{id:found.id,name,active}};
  });
  return null;
}
export function recordReceivedBatch(db,ingredientId,body,quantity,stamp,bad,missing){
  const hasMeta=body.lotCode!==undefined||body.expiryDate!==undefined||body.supplierId!==undefined;
  if(!hasMeta)return null; // legacy untracked inventory stays valid
  if(typeof body.lotCode!=='string'||body.lotCode.trim().length<1||body.lotCode.length>64||!validDate(body.expiryDate))
    bad('Para receber lote, informe código e validade real no formato AAAA-MM-DD');
  if(body.supplierId!==undefined){
    if(typeof body.supplierId!=='string'||!db.prepare('SELECT 1 FROM supplier WHERE id=? AND active=1').get(body.supplierId))missing('Fornecedor ativo');
  }
  if(!positive(quantity))bad('Quantidade do lote inválida');
  const id=randomUUID(),lotCode=body.lotCode.trim(),supplierId=body.supplierId??null;
  const found=db.prepare('SELECT id,supplier_id FROM ingredient_batch WHERE ingredient_id=? AND lot_code=? AND expiry_date=?').get(ingredientId,lotCode,body.expiryDate);
  if(found&&found.supplier_id!==supplierId)bad('Fornecedor divergente para o mesmo lote');
  if(found){
    db.prepare('UPDATE ingredient_batch SET received_milli=received_milli+?,remaining_milli=remaining_milli+? WHERE id=?').run(quantity,quantity,found.id);
    return found.id;
  }
  db.prepare('INSERT INTO ingredient_batch(id,ingredient_id,supplier_id,lot_code,expiry_date,received_milli,remaining_milli,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,ingredientId,supplierId,lotCode,body.expiryDate,quantity,quantity,stamp());
  return id;
}
/** Updates batches in same transaction as stock_movement. Untracked portion is the difference, never a second balance. */
export function allocateFefo(db,ingredientId,quantity,actor,orderId,conflict,{allowExpired=false}={}){
  if(!positive(quantity))throw new Error('Quantidade de lote inválida');
  const current=db.prepare('SELECT on_hand_milli FROM stock_ingredient WHERE id=?').get(ingredientId);
  if(!current||current.on_hand_milli<quantity)conflict('Estoque insuficiente','STOCK_INSUFFICIENT');
  const all=db.prepare('SELECT id,expiry_date AS expiryDate,remaining_milli AS remainingMilli FROM ingredient_batch WHERE ingredient_id=? AND remaining_milli>0 ORDER BY expiry_date,created_at,id').all(ingredientId);
  const tracked=all.reduce((sum,b)=>sum+b.remainingMilli,0);
  if(tracked>current.on_hand_milli)throw new Error('Divergência entre lotes e saldo canônico');
  const untracked=current.on_hand_milli-tracked;
  const today=businessDay();
  const eligible=all.filter(b=>allowExpired||b.expiryDate>=today);
  const usable=untracked+eligible.reduce((sum,b)=>sum+b.remainingMilli,0);
  if(usable<quantity)conflict('Estoque válido insuficiente: há lote vencido','STOCK_EXPIRED');
  let remaining=quantity;
  const changes=[];
  for(const batch of eligible){
    if(!remaining)break;
    const used=Math.min(remaining,batch.remainingMilli);
    if(!used)continue;
    db.prepare('UPDATE ingredient_batch SET remaining_milli=remaining_milli-? WHERE id=?').run(used,batch.id);
    db.prepare('INSERT INTO batch_consumption(id,batch_id,order_id,quantity_milli,actor_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),batch.id,orderId,used,actor,new Date().toISOString());
    changes.push({batchId:batch.id,quantityMilli:used});
    remaining-=used;
  }
  if(remaining>untracked)throw new Error('Saldo de lote inconsistente');
  return {changes,untrackedConsumedMilli:remaining};
}
