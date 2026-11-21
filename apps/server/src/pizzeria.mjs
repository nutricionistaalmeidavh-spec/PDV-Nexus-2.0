/** P2: explicit pizza pricing and frozen ingredient fractions in canonical order lines. */
import {randomUUID} from 'node:crypto';
import {addOrderLine} from '../../../packages/core/src/order.ts';
import {dispatchKitchenTickets} from './restaurant.mjs';
const cents=n=>Number.isSafeInteger(n)&&n>=0;
function addRecipe(db,lineId,productId,denominator){
 if(!productId)return;
 const recipe=db.prepare('SELECT ingredient_id,quantity_milli FROM stock_recipe_item WHERE product_id=?').all(productId);
 for(const item of recipe){
  const qty=Number((BigInt(item.quantity_milli)+BigInt(denominator)/2n)/BigInt(denominator));
  if(!Number.isSafeInteger(qty)||qty<1)continue;
  const ing=db.prepare('SELECT name FROM stock_ingredient WHERE id=?').get(item.ingredient_id);
  db.prepare(`INSERT INTO order_line_recipe_snapshot(line_id,ingredient_id,ingredient_name_snapshot,quantity_milli)
    VALUES(?,?,?,?) ON CONFLICT(line_id,ingredient_id) DO UPDATE
    SET quantity_milli=quantity_milli+excluded.quantity_milli`).run(lineId,item.ingredient_id,ing.name,qty);
 }
}
export function pizzaRead(db,method,route){
 if(method!=='GET'||route!=='/api/pizza/catalog')return null;
 return {status:200,body:{
  sizes:db.prepare('SELECT id,name,base_price_cents AS basePriceCents,active FROM pizza_size ORDER BY name').all(),
  flavors:db.prepare('SELECT id,name,price_cents AS priceCents,product_id AS productId,active FROM pizza_flavor ORDER BY name').all(),
  borders:db.prepare('SELECT id,name,price_cents AS priceCents,product_id AS productId,active FROM pizza_border ORDER BY name').all()
 }};
}
export function pizzaWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const table={ '/api/pizza/sizes':['pizza_size','size'],
  '/api/pizza/flavors':['pizza_flavor','flavor'],
  '/api/pizza/borders':['pizza_border','border']}[route];
 if(table)return h.transact(db,route,body,()=>{
  if(!h.supervisor)h.conflict('Configuração de pizzaria exige supervisor','SUPERVISOR_REQUIRED');
  const [nameTable,kind]=table;
  const name=h.requireString(body.name,'Nome',80),price=h.requireCents(kind==='size'?body.basePriceCents:body.priceCents,'Preço');
  const productId=kind!=='size'&&body.productId?body.productId:null;
  if(productId&&!db.prepare('SELECT 1 FROM menu_product WHERE id=?').get(productId))h.missing('Produto da ficha técnica');
  const id=randomUUID();
  if(kind==='size')db.prepare('INSERT INTO pizza_size(id,name,base_price_cents) VALUES(?,?,?)').run(id,name,price);
  else db.prepare('INSERT INTO '+nameTable+'(id,name,price_cents,product_id) VALUES(?,?,?,?)').run(id,name,price,productId);
  const entity={id,name,...(kind==='size'?{basePriceCents:price}:{priceCents:price,productId})};
  h.audit(db,id,'PIZZA_'+kind.toUpperCase()+'_CREATED',entity);
  return {[kind]:entity};
 },201);
 const m=route.match(/^\/api\/orders\/([^/]+)\/pizzas$/);
 if(!m)return null;
 return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,m[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status))h.conflict('Comanda fechada');
  if(db.prepare('SELECT suspended_at FROM sales_order WHERE id=?').get(order.id)?.suspended_at)h.conflict('Retome a venda primeiro');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=?').get(order.id))h.conflict('Comanda já possui pagamento','ORDER_ALREADY_PAID');
  if(!Number.isSafeInteger(body.quantity)||body.quantity<1||body.quantity>10)h.bad('Quantidade de pizzas inválida');
  const template=db.prepare('SELECT id,name FROM menu_product WHERE id=? AND active=1').get(body.templateProductId);
  if(!template)h.missing('Produto de pizza ativo');
  const size=db.prepare('SELECT id,name,base_price_cents AS basePriceCents FROM pizza_size WHERE id=? AND active=1').get(body.sizeId);
  if(!size)h.missing('Tamanho da pizza');
  const ids=body.flavorIds;
  if(!Array.isArray(ids)||ids.length<1||ids.length>4||new Set(ids).size!==ids.length)h.bad('Escolha de 1 a 4 sabores distintos');
  const flavors=[];
  for(const id of ids){
   const flavor=db.prepare('SELECT id,name,price_cents AS priceCents,product_id AS productId FROM pizza_flavor WHERE id=? AND active=1').get(id);
   if(!flavor)h.missing('Sabor de pizza');
   flavors.push(flavor);
  }
  let border=null;
  if(body.borderId){
   border=db.prepare('SELECT id,name,price_cents AS priceCents,product_id AS productId FROM pizza_border WHERE id=? AND active=1').get(body.borderId);
   if(!border)h.missing('Borda de pizza');
  }
  const rule=body.priceRule??'highest';
  if(!['highest','proportional','fixed'].includes(rule))h.bad('Regra de preço inválida');
  const parts=flavors.map(x=>x.priceCents);
  const flavorCents=rule==='highest'?Math.max(...parts):rule==='proportional'?
    Math.floor((parts.reduce((a,b)=>a+b,0)+Math.floor(parts.length/2))/parts.length):
    h.requireCents(body.fixedPriceCents,'Preço fixo');
  if(rule==='fixed'&&!h.supervisor)h.conflict('Preço fixo exige supervisor','SUPERVISOR_REQUIRED');
  const unitPriceCents=size.basePriceCents+flavorCents+(border?.priceCents??0);
  if(!cents(unitPriceCents)||!cents(unitPriceCents*body.quantity))h.bad('Preço excede precisão');
  const label=template.name+' '+size.name+' — '+flavors.map(x=>x.name).join(' / ')+(border?' + '+border.name:'');
  const note=body.note??'';
  if(typeof note!=='string'||note.length>240)h.bad('Observação inválida');
  const next=addOrderLine(order,{id:randomUUID(),productId:template.id,productName:label,unitPriceCents,quantity:body.quantity});
  const line=next.lines.at(-1);
  db.prepare(`INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity,note_snapshot)
    VALUES(?,?,?,?,?,?,?)`).run(line.id,order.id,template.id,label,unitPriceCents,line.quantity,note.trim());
  h.snapshotLineRecipe(db,line.id,template.id);
  for(const x of flavors)addRecipe(db,line.id,x.productId,flavors.length);
  if(border)addRecipe(db,line.id,border.productId,1);
  db.prepare(`INSERT INTO order_line_pizza(line_id,size_name_snapshot,flavors_json,border_json,price_rule,pizza_price_cents)
    VALUES(?,?,?,?,?,?)`).run(line.id,size.name,JSON.stringify(flavors),border?JSON.stringify(border):null,rule,unitPriceCents);
  db.prepare('UPDATE sales_order SET revision=? WHERE id=?').run(next.revision,order.id);
  if(next.status==='OPEN')dispatchKitchenTickets(db,order.id,h.stamp);
  h.audit(db,order.id,'PIZZA_ADDED',{lineId:line.id,size:size.name,flavors:flavors.map(x=>x.name),rule,border:border?.name??null,unitPriceCents});
  return {order:h.databaseOrder(db,order.id),pizza:{lineId:line.id,size,flavors,border,priceRule:rule,unitPriceCents}};
 });
}
