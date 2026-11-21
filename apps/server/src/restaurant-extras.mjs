/** Fixed-price combos and in-order item/quantity split. No duplicate sales aggregates. */
import {randomUUID} from 'node:crypto';
const cents=(v)=>Number.isSafeInteger(v)&&v>=0;
export function comboRead(db,method,route,{missing}){
 if(method!=='GET')return null;
 const detail=route.match(/^\/api\/combos\/([^/]+)$/);
 if(detail){
  const combo=db.prepare('SELECT id,name,price_cents AS priceCents FROM menu_product WHERE id=? AND is_combo=1').get(detail[1]);
  if(!combo)missing('Combo');
  const components=db.prepare('SELECT product_id AS productId, quantity FROM menu_combo_item WHERE combo_id=? ORDER BY rowid').all(combo.id);
  return {status:200,body:{combo:{...combo,components}}};
 }
 const split=route.match(/^\/api\/orders\/([^/]+)\/split$/);
 if(split){
  if(!db.prepare('SELECT 1 FROM sales_order WHERE id=?').get(split[1]))missing('Pedido');
  return {status:200,body:{split:splitSummary(db,split[1])}};
 }
 return null;
}
export function comboWrite(db,method,route,body,h){
 const {transact,requireString,requireCents,bad,missing,conflict,assertRevision,databaseOrder,audit}=h;
 if(method==='POST'&&route==='/api/combos')return transact(db,route,body,()=>{
  const name=requireString(body.name,'Nome do combo',120),priceCents=requireCents(body.priceCents,'Preco');
  const categoryId=body.categoryId??'c-default';
  if(!db.prepare("SELECT 1 FROM menu_category WHERE id=? AND restaurant_id='r-local' AND active=1").get(categoryId))bad('Categoria invalida');
  if(!Array.isArray(body.components)||!body.components.length||body.components.length>20)bad('Informe de 1 a 20 componentes');
  const unique=new Set(),components=[];
  for(const entry of body.components){
   if(typeof entry.productId!=='string'||!Number.isSafeInteger(entry.quantity)||entry.quantity<1||entry.quantity>100)bad('Componente invalido');
   if(unique.has(entry.productId))bad('Componente duplicado');
   unique.add(entry.productId);
   const product=db.prepare('SELECT id,is_combo AS isCombo,active FROM menu_product WHERE id=?').get(entry.productId);
   if(!product||!product.active||product.isCombo)bad('Combo aceita apenas produtos simples e ativos');
   components.push({productId:product.id,quantity:entry.quantity});
  }
  const id=randomUUID();
  db.prepare('INSERT INTO menu_product(id,category_id,name,price_cents,is_combo) VALUES(?,?,?,?,1)').run(id,categoryId,name,priceCents);
  for(const component of components)
   db.prepare('INSERT INTO menu_combo_item(id,combo_id,product_id,quantity) VALUES(?,?,?,?)')
     .run(randomUUID(),id,component.productId,component.quantity);
  audit(db,id,'COMBO_CREATED',{name,priceCents,components});
  return {combo:{id,name,priceCents,components}};
 },201);
 const split=route.match(/^\/api\/orders\/([^/]+)\/split$/);
 if(method==='POST'&&split)return transact(db,route,body,()=>{
  const id=split[1],order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status))conflict('Comanda encerrada');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(id))conflict('Não altere divisão após pagamentos','SPLIT_LOCKED');
  if(!order.lines.length||order.lines.length>100)bad('Comanda vazia ou grande demais');
  const allocations=body.allocations;
  if(!Array.isArray(allocations)||allocations.length!==order.lines.length)bad('Atribua todas as linhas da comanda');
  const seen=new Set(),entries=[];
  for(const group of allocations){
   const line=order.lines.find(x=>x.id===group.lineId);
   if(!line||seen.has(group.lineId))bad('Linha invalida ou duplicada');
   seen.add(group.lineId);
   if(!Array.isArray(group.guests)||group.guests.length<1||group.guests.length>20)bad('Informe os convidados da linha');
   let total=0;
   const names=new Set();
   for(const part of group.guests){
    const guest=requireString(part.guest,'Convidado',60);
    if(!Number.isSafeInteger(part.quantity)||part.quantity<1)bad('Quantidade por convidado invalida');
    const key=guest.toLocaleLowerCase('pt-BR');
    if(names.has(key))bad('Convidado repetido na linha');
    names.add(key);total+=part.quantity;
    if(!Number.isSafeInteger(total)||total>line.quantity)bad('Quantidade distribuida excede a linha');
    entries.push({lineId:line.id,guest,quantity:part.quantity});
   }
   if(total!==line.quantity)bad('Toda quantidade deve ser atribuida a um convidado');
  }
  db.prepare('DELETE FROM order_guest_split WHERE line_id IN (SELECT id FROM order_line WHERE order_id=?)').run(id);
  const insert=db.prepare('INSERT INTO order_guest_split(line_id,guest,quantity) VALUES(?,?,?)');
  for(const e of entries)insert.run(e.lineId,e.guest,e.quantity);
  db.prepare('UPDATE sales_order SET revision=revision+1 WHERE id=?').run(id);
  audit(db,id,'ORDER_SPLIT_ALLOCATED',{guests:[...new Set(entries.map(e=>e.guest))]});
  return {split:splitSummary(db,id),order:databaseOrder(db,id)};
 });
 return null;
}
export function splitSummary(db,orderId){
 const lines=db.prepare('SELECT id,unit_price_cents AS unitPriceCents,quantity FROM order_line WHERE order_id=? AND cancelled_at IS NULL').all(orderId);
 const alloc=db.prepare('SELECT s.line_id AS lineId,s.guest,s.quantity,l.unit_price_cents AS unitPriceCents FROM order_guest_split s JOIN order_line l ON l.id=s.line_id WHERE l.order_id=? AND l.cancelled_at IS NULL ORDER BY s.guest COLLATE NOCASE,s.line_id').all(orderId);
 const groups=new Map();
 for(const x of alloc){
  const total=x.unitPriceCents*x.quantity;if(!cents(total))throw new Error('Subtotais invalidos');
  const group=groups.get(x.guest)??{guest:x.guest,totalCents:0,items:[]};
  group.totalCents+=total;if(!cents(group.totalCents))throw new Error('Soma excedeu limite seguro');
  group.items.push({lineId:x.lineId,quantity:x.quantity,totalCents:total});
  groups.set(x.guest,group);
 }
 const gross=lines.reduce((s,x)=>s+x.quantity*x.unitPriceCents,0);
 if(!cents(gross))throw new Error('Total invalido');
 const fullyAssigned=alloc.length>0&&lines.every(line=>alloc.filter(x=>x.lineId===line.id).reduce((s,x)=>s+x.quantity,0)===line.quantity);
 return {orderId,totalCents:gross,fullyAssigned,guests:[...groups.values()].sort((a,b)=>a.guest.localeCompare(b.guest,'pt-BR'))};
}
export function assertSplitConsistent(db,orderId){
 const has=db.prepare('SELECT 1 FROM order_guest_split s JOIN order_line l ON l.id=s.line_id WHERE l.order_id=? AND l.cancelled_at IS NULL LIMIT 1').get(orderId);
 if(has&&!splitSummary(db,orderId).fullyAssigned)throw new Error('Distribuicao por convidado precisa ser refeita antes do pagamento');
}
