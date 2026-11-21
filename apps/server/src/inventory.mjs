import {recordReceivedBatch,allocateFefo} from './retail-supply.mjs';
/** Single-writer inventory ledger; no parallel balance/cost store. Quantities: thousandths of g/ml/unit. */
import {randomUUID} from 'node:crypto';
const isInteger=x=>Number.isSafeInteger(x);
const nonneg=x=>isInteger(x)&&x>=0;
const positive=x=>isInteger(x)&&x>0;
function safeAdd(a,b){const v=a+b;if(!nonneg(v))throw new Error('Saldo ultrapassa limite de precisão');return v;}
function proportional(value,part,total){
  if(part===total)return value;
  const result=Number((BigInt(value)*BigInt(part)+BigInt(total)/2n)/BigInt(total));
  if(!nonneg(result))throw new Error('Custo ultrapassa limite seguro');
  return result;
}
function ingredient(db,id,missing){
  const row=db.prepare("SELECT * FROM stock_ingredient WHERE id=? AND restaurant_id='r-local'").get(id);
  if(!row)missing('Ingrediente');
  return row;
}
function applyMovement(db,ing,delta,costCents,kind,reason,actor,orderId=null){
  if(!isInteger(delta)||delta===0)throw new Error('Quantidade inválida');
  let nextQty,nextValue,valueDelta;
  if(delta>0){
    if(!nonneg(costCents))throw new Error('Custo de entrada inválido');
    nextQty=safeAdd(ing.on_hand_milli,delta);
    nextValue=safeAdd(ing.book_value_cents,costCents);
    valueDelta=costCents;
  }else{
    const amount=-delta;
    if(!positive(amount)||amount>ing.on_hand_milli)throw new Error('Estoque insuficiente para baixa');
    const consumed=proportional(ing.book_value_cents,amount,ing.on_hand_milli);
    nextQty=ing.on_hand_milli-amount;
    nextValue=ing.book_value_cents-consumed;
    valueDelta=-consumed;
  }
  const movement={id:randomUUID(),ingredientId:ing.id,kind,quantityDeltaMilli:delta,valueDeltaCents:valueDelta,
    balanceAfterMilli:nextQty,valueAfterCents:nextValue,sourceOrderId:orderId,actorId:actor,reason,createdAt:new Date().toISOString()};
  db.prepare('UPDATE stock_ingredient SET on_hand_milli=?,book_value_cents=? WHERE id=?').run(nextQty,nextValue,ing.id);
  db.prepare('INSERT INTO stock_movement(id,ingredient_id,kind,quantity_delta_milli,value_delta_cents,balance_after_milli,value_after_cents,source_order_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(movement.id,ing.id,kind,delta,valueDelta,nextQty,nextValue,orderId,reason,actor,movement.createdAt);
  return movement;
}
export function snapshotLineRecipe(db,lineId,productId){
  const components=db.prepare('SELECT r.ingredient_id AS ingredientId,i.name AS ingredientName,r.quantity_milli AS quantityMilli,1 AS multiplier '+
    'FROM stock_recipe_item r JOIN stock_ingredient i ON i.id=r.ingredient_id WHERE r.product_id=? '+
    'UNION ALL SELECT r.ingredient_id,i.name,r.quantity_milli,c.quantity '+
    'FROM menu_combo_item c JOIN stock_recipe_item r ON r.product_id=c.product_id '+
    'JOIN stock_ingredient i ON i.id=r.ingredient_id WHERE c.combo_id=?').all(productId,productId);
  const combined=new Map();
  for(const c of components){
    const part=c.quantityMilli*c.multiplier;
    if(!positive(part))throw new Error('Ficha técnica excede limite seguro');
    const row=combined.get(c.ingredientId)??{id:c.ingredientId,name:c.ingredientName,quantityMilli:0};
    row.quantityMilli=safeAdd(row.quantityMilli,part);
    combined.set(c.ingredientId,row);
  }
  const insert=db.prepare('INSERT INTO order_line_recipe_snapshot(line_id,ingredient_id,ingredient_name_snapshot,quantity_milli) VALUES(?,?,?,?)');
  for(const row of combined.values())insert.run(lineId,row.id,row.name,row.quantityMilli);
}
export function consumeStockForOrder(db,orderId,actor,conflict){
  const rows=db.prepare('SELECT s.ingredient_id AS ingredientId,s.quantity_milli AS quantityMilli,l.quantity '+
    'FROM order_line_recipe_snapshot s JOIN order_line l ON l.id=s.line_id WHERE l.order_id=? AND l.cancelled_at IS NULL').all(orderId);
  const usage=new Map();
  for(const x of rows){
    const qty=x.quantityMilli*x.quantity;
    if(!positive(qty))throw new Error('Quantidade da ficha técnica inválida');
    usage.set(x.ingredientId,safeAdd(usage.get(x.ingredientId)??0,qty));
  }
  // Caller wraps consumption and payments in the same BEGIN IMMEDIATE transaction.
  const plans=[];
  for(const [id,qty] of usage){
    const ing=db.prepare('SELECT * FROM stock_ingredient WHERE id=?').get(id);
    if(!ing||ing.on_hand_milli<qty)conflict('Estoque insuficiente: '+(ing?.name??id),'STOCK_INSUFFICIENT');
    plans.push({ing,qty});
  }
  let cogsCents=0;
  for(const {ing,qty} of plans){
    allocateFefo(db,ing.id,qty,actor,orderId,conflict);
    const movement=applyMovement(db,ing,-qty,0,'SALE','Consumo da venda '+orderId,actor,orderId);
    cogsCents=safeAdd(cogsCents,-movement.valueDeltaCents);
  }
  return {cogsCents,ingredients:plans.length};
}
export function inventoryRead(db,method,route,params,h){
  if(method!=='GET')return null;
  if(route==='/api/stock/ingredients'){
    const ingredients=db.prepare("SELECT id,name,unit,on_hand_milli AS onHandMilli,book_value_cents AS bookValueCents,low_stock_milli AS lowStockMilli,active FROM stock_ingredient WHERE restaurant_id='r-local' ORDER BY name COLLATE NOCASE").all();
    return {status:200,body:{ingredients}};
  }
  const history=route.match(/^\/api\/stock\/ingredients\/([^/]+)\/movements$/);
  if(history){
    ingredient(db,history[1],h.missing);
    return {status:200,body:{movements:db.prepare('SELECT id,kind,quantity_delta_milli AS quantityDeltaMilli,value_delta_cents AS valueDeltaCents,balance_after_milli AS balanceAfterMilli,value_after_cents AS valueAfterCents,source_order_id AS sourceOrderId,reason,actor_id AS actorId,created_at AS createdAt FROM stock_movement WHERE ingredient_id=? ORDER BY created_at DESC,rowid DESC LIMIT 300').all(history[1])}};
  }
  const recipe=route.match(/^\/api\/stock\/recipes\/([^/]+)$/);
  if(recipe){
    if(!db.prepare('SELECT 1 FROM menu_product WHERE id=?').get(recipe[1]))h.missing('Produto');
    return {status:200,body:{productId:recipe[1],items:db.prepare('SELECT ingredient_id AS ingredientId,quantity_milli AS quantityMilli FROM stock_recipe_item WHERE product_id=? ORDER BY ingredient_id').all(recipe[1])}};
  }
  if(route==='/api/stock/report'){
    const ingredients=db.prepare("SELECT id,name,unit,on_hand_milli AS onHandMilli,book_value_cents AS bookValueCents,low_stock_milli AS lowStockMilli,active FROM stock_ingredient WHERE restaurant_id='r-local' AND active=1 ORDER BY name COLLATE NOCASE").all();
    const totalValueCents=ingredients.reduce((x,i)=>safeAdd(x,i.bookValueCents),0);
    return {status:200,body:{ingredients:ingredients.map(i=>({...i,lowStock:i.lowStockMilli>0&&i.onHandMilli<=i.lowStockMilli})),totalValueCents,lowStockCount:ingredients.filter(i=>i.lowStockMilli>0&&i.onHandMilli<=i.lowStockMilli).length}};
  }
  if(route==='/api/reports/margin'){
    const from=params.get('from'),to=params.get('to');
    const date=v=>{if(v===null||v==='')return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const date=new Date(v+'T00:00:00.000Z');return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===v?v:null;};
    const start=date(from),end=date(to);
    if((from&&start===null)||(to&&end===null)||(start&&end&&start>end))h.bad('Período inválido');
    const orders=db.prepare("SELECT o.id,o.closed_at AS closedAt,r.amount_cents AS refundCents FROM sales_order o LEFT JOIN order_refund r ON r.order_id=o.id WHERE o.status='CLOSED' AND (? IS NULL OR substr(o.closed_at,1,10)>=?) AND (? IS NULL OR substr(o.closed_at,1,10)<=?)").all(start,start,end,end);
    const lines=db.prepare('SELECT COALESCE(SUM(unit_price_cents*quantity),0) AS gross FROM order_line WHERE order_id=? AND cancelled_at IS NULL');
    const cogs=db.prepare("SELECT COALESCE(SUM(-value_delta_cents),0) AS cost FROM stock_movement WHERE source_order_id=? AND kind='SALE'");
    let grossSalesCents=0,refundedCents=0,cogsCents=0;
    for(const order of orders){
      grossSalesCents=safeAdd(grossSalesCents,lines.get(order.id).gross);
      refundedCents=safeAdd(refundedCents,order.refundCents??0);
      cogsCents=safeAdd(cogsCents,cogs.get(order.id).cost);
    }
    return {status:200,body:{period:{from:start,to:end},orders:orders.length,grossSalesCents,refundedCents,netSalesCents:grossSalesCents-refundedCents,cogsCents,grossMarginCents:grossSalesCents-refundedCents-cogsCents}};
  }
  return null;
}
export function inventoryWrite(db,method,route,body,h){
  const {transact,requireString,bad,missing,conflict,audit,stamp}=h;
  if(method==='POST'&&route==='/api/stock/ingredients')return transact(db,route,body,()=>{
    const name=requireString(body.name,'Ingrediente',100);
    if(!['g','ml','unit'].includes(body.unit))bad('Unidade inválida: g, ml ou unit');
    const low=body.lowStockMilli??0;if(!nonneg(low))bad('Estoque mínimo inválido');
    if(db.prepare("SELECT 1 FROM stock_ingredient WHERE restaurant_id='r-local' AND name=? COLLATE NOCASE").get(name))conflict('Ingrediente já cadastrado');
    const id=randomUUID();
    db.prepare("INSERT INTO stock_ingredient(id,restaurant_id,name,unit,low_stock_milli,created_at) VALUES(?,'r-local',?,?,?,?)").run(id,name,body.unit,low,stamp());
    audit(db,id,'INGREDIENT_CREATED',{name,unit:body.unit,lowStockMilli:low});
    return {ingredient:{id,name,unit:body.unit,onHandMilli:0,bookValueCents:0,lowStockMilli:low}};
  },201);
  const receive=route.match(/^\/api\/stock\/ingredients\/([^/]+)\/receive$/);
  if(method==='POST'&&receive)return transact(db,route,body,()=>{
    const ing=ingredient(db,receive[1],missing);
    if(!positive(body.quantityMilli)||!nonneg(body.costCents))bad('Quantidade ou custo inválidos');
    const batchId=recordReceivedBatch(db,ing.id,body,body.quantityMilli,stamp,bad,missing);
    const movement=applyMovement(db,ing,body.quantityMilli,body.costCents,'RECEIVE','Entrada de estoque',h.actor);
    audit(db,ing.id,'STOCK_RECEIVED',{...movement,batchId});
    return {movement,batchId};
  },201);
  const adjust=route.match(/^\/api\/stock\/ingredients\/([^/]+)\/adjust$/);
  if(method==='POST'&&adjust)return transact(db,route,body,()=>{
    const ing=ingredient(db,adjust[1],missing),qty=body.quantityMilli;
    if(!isInteger(qty)||qty===0)bad('Quantidade inválida');
    const reason=requireString(body.reason,'Motivo',240);
    if(qty>0&&!nonneg(body.costCents))bad('Informe custo de entrada no ajuste positivo');
    if(qty<0&&qty*-1>ing.on_hand_milli)conflict('Estoque insuficiente','STOCK_INSUFFICIENT');
    const batchId=qty>0?recordReceivedBatch(db,ing.id,body,qty,stamp,bad,missing):null;
    if(qty<0)allocateFefo(db,ing.id,-qty,h.actor,null,conflict,{allowExpired:true});
    const movement=applyMovement(db,ing,qty,qty>0?body.costCents:0,qty>0?'ADJUST_IN':'ADJUST_OUT',reason,h.actor);
    audit(db,ing.id,'STOCK_ADJUSTED',movement);
    return {movement};
  },201);
  const recipe=route.match(/^\/api\/stock\/recipes\/([^/]+)$/);
  if(method==='POST'&&recipe)return transact(db,route,body,()=>{
    const product=db.prepare('SELECT id,is_combo FROM menu_product WHERE id=?').get(recipe[1]);
    if(!product)missing('Produto');
    if(product.is_combo)bad('Ficha técnica do combo é formada pelas fichas dos componentes');
    if(!Array.isArray(body.items)||body.items.length>30)bad('Máximo de 30 ingredientes por ficha');
    const unique=new Set();
    for(const item of body.items){
      if(typeof item.ingredientId!=='string'||!positive(item.quantityMilli))bad('Ingrediente ou quantidade inválida');
      if(unique.has(item.ingredientId))bad('Ingrediente duplicado');
      unique.add(item.ingredientId);
      const ing=ingredient(db,item.ingredientId,missing);
      if(!ing.active)bad('Ingrediente inativo');
    }
    db.prepare('DELETE FROM stock_recipe_item WHERE product_id=?').run(product.id);
    const insert=db.prepare('INSERT INTO stock_recipe_item(product_id,ingredient_id,quantity_milli) VALUES(?,?,?)');
    for(const item of body.items)insert.run(product.id,item.ingredientId,item.quantityMilli);
    audit(db,product.id,'RECIPE_UPDATED',{items:body.items});
    return {productId:product.id,items:body.items};
  });
  return null;
}

/** Purchase receipts must use the same average-cost ledger as manual stock entries. */
export function receiveIngredientMovement(db,ingredientId,quantityMilli,costCents,actor,purchaseId,missing){
 const ing=ingredient(db,ingredientId,missing);
 if(!ing.active)throw new Error('Ingrediente inativo');
 if(!positive(quantityMilli)||!nonneg(costCents))throw new Error('Quantidade ou custo inválidos');
 return applyMovement(db,ing,quantityMilli,costCents,'RECEIVE','Compra recebida '+purchaseId,actor);
}
