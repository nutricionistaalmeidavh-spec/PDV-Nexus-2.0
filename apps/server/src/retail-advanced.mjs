/** P2: venda por quilo e operações avançadas de balcão; transações canônicas. */
import {randomUUID} from 'node:crypto';
import {addOrderLine} from '../../../packages/core/src/order.ts';
import {dispatchKitchenTickets} from './restaurant.mjs';
import {priceForWeight} from './scale-capture.mjs';
const safe=n=>Number.isSafeInteger(n)&&n>=0;
export function retailAdvancedRead(db,method,route,h){
 if(method!=='GET')return null;
 const match=route.match(/^\/api\/orders\/([^/]+)\/price-history$/);
 if(!match)return null;
 if(!db.prepare('SELECT 1 FROM sales_order WHERE id=?').get(match[1]))h.missing('Pedido');
 const changes=db.prepare(`SELECT line_id AS lineId,previous_unit_price_cents AS beforeCents,
 new_unit_price_cents AS afterCents,reason,actor_id AS actorId,created_at AS createdAt
 FROM order_line_price_change WHERE order_id=? ORDER BY created_at,rowid`).all(match[1]);
 return {status:200,body:{changes}};
}
export function retailAdvancedWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const saleUnit=route.match(/^\/api\/products\/([^/]+)\/sale-unit$/);
 if(saleUnit)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Configuração exige supervisor','SUPERVISOR_REQUIRED');
  if(!['unit','kg'].includes(body.saleUnit))h.bad('Unidade inválida');
  const product=db.prepare('SELECT id FROM menu_product WHERE id=?').get(saleUnit[1]);
  if(!product)h.missing('Produto');
  db.prepare('UPDATE menu_product SET sale_unit=? WHERE id=?').run(body.saleUnit,product.id);
  h.audit(db,product.id,'PRODUCT_SALE_UNIT_SET',{saleUnit:body.saleUnit});
  return {productId:product.id,saleUnit:body.saleUnit};
 });
 const weight=route.match(/^\/api\/orders\/([^/]+)\/weight-lines$/);
 if(weight)return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,weight[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status)||order.suspended)h.conflict('Comanda indisponível');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(order.id))h.conflict('Comanda já recebeu pagamento');
  const product=db.prepare('SELECT * FROM menu_product WHERE id=? AND active=1 AND sale_unit=\'kg\'').get(body.productId);
  if(!product)h.missing('Produto vendido por kg');
  const stored=body.measurementId?h.scaleReadings?.get(body.measurementId):null;
  if(body.measurementId&&!stored)h.conflict('Leitura de balança ausente, expirada ou utilizada','SCALE_READING_EXPIRED');
  if(stored&&Date.now()>stored.expiresAt)h.conflict('Leitura expirada','SCALE_READING_EXPIRED');
  if(body.stable===false)h.bad('Peso instável: aguarde nova leitura');
  if(!stored&&!(h.supervisor&&body.manualConfirmed===true&&body.stable===true))
   h.conflict('Peso manual requer supervisor e confirmação explícita ou leitura serial estável','SCALE_CONFIRMATION_REQUIRED');
  const grams=stored?.weightGrams??body.weightGrams;
  let unitPriceCents;
  try{unitPriceCents=priceForWeight(product.price_cents,grams);}
  catch(e){h.bad(e.message)}
  const line={id:randomUUID(),productId:product.id,productName:product.name,unitPriceCents,quantity:1};
  const next=addOrderLine(order,line);
  db.prepare(`INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity)
  VALUES(?,?,?,?,?,1)`).run(line.id,order.id,product.id,product.name,unitPriceCents);
  const source=stored?'serial-stable':'manual-confirmed';
  db.prepare(`INSERT INTO order_line_weight(line_id,weight_grams,price_per_kg_cents,source,capture_brand,captured_at)
   VALUES(?,?,?,?,?,?)`).run(line.id,grams,product.price_cents,source,stored?.brand??null,stored?.capturedAt??h.stamp());
  h.snapshotLineRecipe(db,line.id,product.id);
  // Receitas para itens vendidos por kg expressam consumo por 1kg; ajustar snapshot por gramas.
  const snapshots=db.prepare('SELECT ingredient_id AS id,quantity_milli AS qty FROM order_line_recipe_snapshot WHERE line_id=?').all(line.id);
  for(const s of snapshots){
   const qty=Number((BigInt(s.qty)*BigInt(grams)+500n)/1000n);
   if(!safe(qty)||qty<1)h.conflict('Ficha técnica muito pequena ou fora de precisão para esta pesagem','INVALID_WEIGHT_RECIPE');
   db.prepare('UPDATE order_line_recipe_snapshot SET quantity_milli=? WHERE line_id=? AND ingredient_id=?').run(qty,line.id,s.id);
  }
  db.prepare('UPDATE sales_order SET revision=? WHERE id=?').run(next.revision,order.id);
  if(order.status==='OPEN')dispatchKitchenTickets(db,order.id,h.stamp);
  if(stored)h.scaleReadings.delete(body.measurementId);
  h.audit(db,order.id,'WEIGHT_LINE_ADDED',{lineId:line.id,weightGrams:grams,source,unitPriceCents});
  return {order:h.databaseOrder(db,order.id),weightGrams:grams,source};
 });
 const suspend=route.match(/^\/api\/orders\/([^/]+)\/(suspend|resume)$/);
 if(suspend)return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,suspend[1]);
  h.assertRevision(order,body.expectedRevision);
  if(order.status!=='DRAFT'||order.serviceMode!=='counter')h.conflict('Apenas venda de balcão em rascunho pode ser suspensa');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(order.id))h.conflict('Venda com pagamentos não pode ser suspensa');
  if(suspend[2]==='suspend'&&order.suspended||suspend[2]==='resume'&&!order.suspended)h.conflict('Estado de suspensão já atualizado');
  db.prepare('UPDATE sales_order SET suspended_at=?,revision=revision+1 WHERE id=?').run(suspend[2]==='suspend'?h.stamp():null,order.id);
  h.audit(db,order.id,suspend[2]==='suspend'?'ORDER_SUSPENDED':'ORDER_RESUMED');
  return {order:h.databaseOrder(db,order.id)};
 });
 const discount=route.match(/^\/api\/orders\/([^/]+)\/lines\/([^/]+)\/discount$/);
 if(discount)return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,discount[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status)||order.suspended)h.conflict('Comanda indisponível');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(order.id))
   h.conflict('Venda com pagamento não permite desconto','ORDER_HAS_PAYMENT');
  const bps=body.discountBps;
  if(!Number.isSafeInteger(bps)||bps<1||bps>10000)h.bad('Percentual de desconto inválido: use 1 a 10000 pontos-base');
  // Política conservadora: operador de caixa até 10%, acima disso somente supervisor.
  if(bps>1000&&!h.supervisor)h.conflict('Desconto acima de 10% exige supervisor','DISCOUNT_SUPERVISOR_REQUIRED');
  const reason=h.requireString(body.reason,'Justificativa do desconto',240);
  const line=db.prepare(`SELECT id,unit_price_cents AS unitPriceCents,quantity
    FROM order_line WHERE id=? AND order_id=? AND cancelled_at IS NULL`).get(discount[2],order.id);
  if(!line)h.missing('Linha da comanda');
  if(db.prepare('SELECT 1 FROM order_line_price_change WHERE line_id=? LIMIT 1').get(line.id))
   h.conflict('Item já teve ajuste de preço; reverta com supervisor em procedimento separado','DISCOUNT_ALREADY_APPLIED');
  const discountCents=Number((BigInt(line.unitPriceCents)*BigInt(bps)+5000n)/10000n);
  const nextPrice=line.unitPriceCents-discountCents;
  if(!safe(nextPrice)||!safe(nextPrice*line.quantity))h.bad('Valor excede limite monetário');
  db.prepare('UPDATE order_line SET unit_price_cents=? WHERE id=?').run(nextPrice,line.id);
  db.prepare('UPDATE sales_order SET revision=revision+1 WHERE id=?').run(order.id);
  db.prepare(`INSERT INTO order_line_price_change
   (id,line_id,order_id,previous_unit_price_cents,new_unit_price_cents,reason,actor_id,created_at)
   VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),line.id,order.id,line.unitPriceCents,nextPrice,reason,h.actor,h.stamp());
  h.audit(db,order.id,'ORDER_LINE_DISCOUNT_APPLIED',{lineId:line.id,discountBps:bps,unitDiscountCents:discountCents,reason});
  return {order:h.databaseOrder(db,order.id),discountCents:discountCents*line.quantity,discountBps:bps};
 });
 const price=route.match(/^\/api\/orders\/([^/]+)\/lines\/([^/]+)\/override-price$/);
 if(price)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Alteração de preço exige supervisor','SUPERVISOR_REQUIRED');
  const order=h.databaseOrder(db,price[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status)||order.suspended)h.conflict('Comanda indisponível');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(order.id))h.conflict('Não altere itens com pagamentos');
  const line=db.prepare(`SELECT id,unit_price_cents AS unitPriceCents,quantity
   FROM order_line WHERE id=? AND order_id=? AND cancelled_at IS NULL`).get(price[2],order.id);
  if(!line)h.missing('Linha');
  h.requireCents(body.unitPriceCents,'Novo preço');
  if(!safe(body.unitPriceCents*line.quantity))h.bad('Valor fora da precisão');
  const reason=h.requireString(body.reason,'Justificativa',240);
  db.prepare('UPDATE order_line SET unit_price_cents=? WHERE id=?').run(body.unitPriceCents,line.id);
  db.prepare('UPDATE sales_order SET revision=revision+1 WHERE id=?').run(order.id);
  db.prepare(`INSERT INTO order_line_price_change
    (id,line_id,order_id,previous_unit_price_cents,new_unit_price_cents,reason,actor_id,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(),line.id,order.id,line.unitPriceCents,body.unitPriceCents,reason,h.actor,h.stamp());
  db.prepare(`UPDATE kitchen_ticket SET change_note=?,revision=revision+1,updated_at=?
    WHERE line_id=? AND status<>'CANCELLED'`).run('PREÇO ALTERADO: confira pré-conta',h.stamp(),line.id);
  h.audit(db,order.id,'ORDER_LINE_PRICE_OVERRIDDEN',{lineId:line.id,from:line.unitPriceCents,to:body.unitPriceCents,reason});
  return {order:h.databaseOrder(db,order.id)};
 });
 const merge=route.match(/^\/api\/orders\/([^/]+)\/merge$/);
 if(merge)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Junção de mesas exige supervisor','SUPERVISOR_REQUIRED');
  const target=h.databaseOrder(db,merge[1]),source=h.databaseOrder(db,body.sourceOrderId);
  h.assertRevision(target,body.expectedRevision);
  if(target.id===source.id||target.serviceMode!=='table'||source.serviceMode!=='table'||
    !target.tableId||!source.tableId||!['DRAFT','OPEN'].includes(target.status)||
    !['DRAFT','OPEN'].includes(source.status))h.conflict('Selecione duas comandas de mesa ativas e distintas');
  if(!Number.isSafeInteger(body.expectedSourceRevision)||source.revision!==body.expectedSourceRevision)
   h.conflict('Comanda de origem alterada','REVISION_CONFLICT');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id IN (?,?) LIMIT 1').get(target.id,source.id))
   h.conflict('Não junte comandas após receber pagamentos');
  db.prepare('UPDATE order_line SET order_id=? WHERE order_id=?').run(target.id,source.id);
  db.prepare('UPDATE kitchen_ticket SET order_id=? WHERE order_id=?').run(target.id,source.id);
  const nextStatus=target.status==='OPEN'||source.status==='OPEN'?'OPEN':'DRAFT';
  db.prepare('UPDATE sales_order SET status=?,revision=revision+1 WHERE id=?').run(nextStatus,target.id);
  db.prepare(`UPDATE sales_order SET status='CANCELLED',revision=revision+1 WHERE id=?`).run(source.id);
  if(nextStatus==='OPEN')dispatchKitchenTickets(db,target.id,h.stamp);
  h.audit(db,target.id,'TABLE_ORDERS_MERGED',{sourceOrderId:source.id,sourceTableId:source.tableId,lineIds:source.lines.map(x=>x.id)});
  h.audit(db,source.id,'ORDER_MERGED_INTO',{targetOrderId:target.id});
  return {order:h.databaseOrder(db,target.id),mergedFrom:source.id};
 });
 return null;
}
