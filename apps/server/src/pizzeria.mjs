/** P2 pizzaria: precificação em centavos, snapshots e baixa de receita por fração. */
import {randomUUID} from 'node:crypto';
import {addOrderLine} from '../../../packages/core/src/order.ts';
import {dispatchKitchenTickets} from './restaurant.mjs';
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const boundedInt=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
function roundPart(value,numerator,denominator){
 const x=(BigInt(value)*BigInt(numerator)+BigInt(denominator)/2n)/BigInt(denominator);
 if(x>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Quantidade excedeu precisão');
 return Number(x);
}
export function pizzaRead(db,method,route,h){
 if(method!=='GET')return null;
 const m=route.match(/^\/api\/pizza\/products\/([^/]+)\/config$/);
 if(!m)return null;
 const product=db.prepare(`SELECT p.id,p.name,p.active,p.category_id AS categoryId
   FROM pizza_product z JOIN menu_product p ON p.id=z.product_id WHERE p.id=?`).get(m[1]);
 if(!product)h.missing('Pizza');
 const sizes=db.prepare(`SELECT id,name,base_price_cents AS basePriceCents,
 pricing_rule AS pricingRule,max_flavors AS maxFlavors,active FROM pizza_size WHERE product_id=? ORDER BY name`).all(product.id);
 const flavors=db.prepare(`SELECT id,name,additional_price_cents AS additionalPriceCents,
 recipe_product_id AS recipeProductId,active FROM pizza_flavor WHERE product_id=? ORDER BY name`).all(product.id);
 const borders=db.prepare(`SELECT id,name,price_cents AS priceCents,active
   FROM pizza_border WHERE product_id=? ORDER BY name`).all(product.id);
 return {status:200,body:{product,sizes,flavors,borders}};
}
export function pizzaWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 if(route==='/api/pizza/products')return h.transact(db,route,body,()=>{
  const name=h.requireString(body.name,'Nome da pizza',120);
  const categoryId=body.categoryId??'c-default';
  if(!db.prepare('SELECT id FROM menu_category WHERE id=? AND active=1').get(categoryId))h.missing('Categoria');
  const id=randomUUID();
  db.prepare('INSERT INTO menu_product(id,category_id,name,price_cents) VALUES(?,?,?,0)').run(id,categoryId,name);
  db.prepare('INSERT INTO pizza_product(product_id) VALUES(?)').run(id);
  h.audit(db,id,'PIZZA_PRODUCT_CREATED',{name});
  return {product:{id,name,categoryId,priceCents:0,isPizza:true}};
 },201);
 const config=route.match(/^\/api\/pizza\/products\/([^/]+)\/(sizes|flavors|borders)$/);
 if(config)return h.transact(db,route,body,()=>{
  const pizzaId=config[1],kind=config[2];
  if(!db.prepare('SELECT 1 FROM pizza_product WHERE product_id=?').get(pizzaId))h.missing('Pizza');
  const name=h.requireString(body.name,'Nome',80),id=randomUUID();
  let result;
  if(kind==='sizes'){
   h.requireCents(body.basePriceCents,'Preço base');
   if(!['MAX','AVERAGE','FIXED'].includes(body.pricingRule)||!boundedInt(body.maxFlavors,1,4))
    h.bad('Regra de preço ou limite de sabores inválido');
   db.prepare(`INSERT INTO pizza_size(id,product_id,name,base_price_cents,pricing_rule,max_flavors)
   VALUES(?,?,?,?,?,?)`).run(id,pizzaId,name,body.basePriceCents,body.pricingRule,body.maxFlavors);
   result={id,productId:pizzaId,name,basePriceCents:body.basePriceCents,pricingRule:body.pricingRule,maxFlavors:body.maxFlavors};
  }else if(kind==='flavors'){
   h.requireCents(body.additionalPriceCents,'Valor do sabor');
   if(body.recipeProductId!==undefined&&body.recipeProductId!==null&&
      !db.prepare('SELECT 1 FROM menu_product WHERE id=?').get(body.recipeProductId))h.missing('Produto para ficha técnica');
   db.prepare(`INSERT INTO pizza_flavor(id,product_id,name,additional_price_cents,recipe_product_id)
    VALUES(?,?,?,?,?)`).run(id,pizzaId,name,body.additionalPriceCents,body.recipeProductId??null);
   result={id,productId:pizzaId,name,additionalPriceCents:body.additionalPriceCents,recipeProductId:body.recipeProductId??null};
  }else{
   h.requireCents(body.priceCents,'Valor da borda');
   db.prepare('INSERT INTO pizza_border(id,product_id,name,price_cents) VALUES(?,?,?,?)').run(id,pizzaId,name,body.priceCents);
   result={id,productId:pizzaId,name,priceCents:body.priceCents};
  }
  h.audit(db,pizzaId,'PIZZA_OPTION_CREATED',{kind,option:result});
  return {[kind.slice(0,-1)]:result};
 },201);
 const m=route.match(/^\/api\/orders\/([^/]+)\/pizza-lines$/);
 if(!m)return null;
 return h.transact(db,route,body,()=>{
  const order=h.databaseOrder(db,m[1]);h.assertRevision(order,body.expectedRevision);
  if(!['DRAFT','OPEN'].includes(order.status))h.conflict('Comanda encerrada');
  if(order.suspended)h.conflict('Retome a comanda antes de adicionar itens');
  if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(order.id))h.conflict('Comanda já possui pagamentos');
  const product=db.prepare(`SELECT p.id,p.name,p.kitchen_station_id AS stationId FROM pizza_product z
   JOIN menu_product p ON p.id=z.product_id WHERE p.id=? AND p.active=1`).get(body.productId);
  if(!product)h.missing('Pizza ativa');
  const size=db.prepare('SELECT * FROM pizza_size WHERE id=? AND product_id=? AND active=1').get(body.sizeId,product.id);
  if(!size)h.missing('Tamanho da pizza');
  if(!Array.isArray(body.flavorIds)||!body.flavorIds.length||body.flavorIds.length>size.max_flavors
     ||new Set(body.flavorIds).size!==body.flavorIds.length)h.bad('Selecione sabores distintos dentro do limite');
  if(!boundedInt(body.quantity,1,30))h.bad('Quantidade inválida');
  const getFlavor=db.prepare('SELECT * FROM pizza_flavor WHERE id=? AND product_id=? AND active=1');
  const flavors=body.flavorIds.map(id=>getFlavor.get(id,product.id));
  if(flavors.some(x=>!x))h.bad('Sabor indisponível para esta pizza');
  const border=body.borderId?db.prepare('SELECT * FROM pizza_border WHERE id=? AND product_id=? AND active=1').get(body.borderId,product.id):null;
  if(body.borderId&&!border)h.bad('Borda indisponível para esta pizza');
  let surcharge=0;
  if(size.pricing_rule==='MAX')surcharge=Math.max(...flavors.map(x=>x.additional_price_cents));
  if(size.pricing_rule==='AVERAGE')surcharge=roundPart(flavors.reduce((s,x)=>s+x.additional_price_cents,0),1,flavors.length);
  const unitPriceCents=size.base_price_cents+surcharge+(border?.price_cents??0);
  if(!safe(unitPriceCents)||!safe(unitPriceCents*body.quantity))h.bad('Preço da pizza excedeu precisão');
  const note=body.note??'';
  if(typeof note!=='string'||note.trim().length>240)h.bad('Observação inválida');
  const next=addOrderLine(order,{id:randomUUID(),productId:product.id,productName:product.name,
   unitPriceCents,quantity:body.quantity});
  const line=next.lines.at(-1);
  db.prepare(`INSERT INTO order_line
    (id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity,note_snapshot)
    VALUES(?,?,?,?,?,?,?)`).run(line.id,order.id,line.productId,
    line.productName+' '+size.name,line.unitPriceCents,line.quantity,note.trim());
  const frozen=flavors.map(x=>({id:x.id,name:x.name,additionalPriceCents:x.additional_price_cents,recipeProductId:x.recipe_product_id}));
  const frozenBorder=border?{id:border.id,name:border.name,priceCents:border.price_cents}:null;
  db.prepare(`INSERT INTO order_line_pizza(line_id,size_id,size_name_snapshot,flavors_json,border_json,pricing_rule_snapshot,unit_price_cents)
   VALUES(?,?,?,?,?,?,?)`).run(line.id,size.id,size.name,JSON.stringify(frozen),
   frozenBorder?JSON.stringify(frozenBorder):null,size.pricing_rule,unitPriceCents);
  // Ficha técnica da base, ou das receitas de cada sabor divididas pelo número de frações.
  // O estoque é consumido uma vez ao receber a venda completa.
  const recipe=new Map();
  const getRecipe=db.prepare(`SELECT r.ingredient_id AS ingredientId,i.name,r.quantity_milli AS quantityMilli
   FROM stock_recipe_item r JOIN stock_ingredient i ON i.id=r.ingredient_id WHERE r.product_id=?`);
  for(const flavor of flavors){
   const sourceId=flavor.recipe_product_id??product.id;
   for(const item of getRecipe.all(sourceId)){
    const value=roundPart(item.quantityMilli,1,flavors.length);
    if(value<1)continue;
    const old=recipe.get(item.ingredientId);
    recipe.set(item.ingredientId,{name:item.name,quantityMilli:(old?.quantityMilli??0)+value});
   }
  }
  for(const [ingredientId,item] of recipe)
   db.prepare(`INSERT INTO order_line_recipe_snapshot
     (line_id,ingredient_id,ingredient_name_snapshot,quantity_milli) VALUES(?,?,?,?)`)
     .run(line.id,ingredientId,item.name,item.quantityMilli);
  db.prepare('UPDATE sales_order SET revision=? WHERE id=?').run(next.revision,order.id);
  if(order.status==='OPEN')dispatchKitchenTickets(db,order.id,h.stamp);
  h.audit(db,order.id,'PIZZA_LINE_ADDED',{lineId:line.id,sizeId:size.id,
    flavorIds:flavors.map(f=>f.id),borderId:border?.id??null,unitPriceCents});
  return {order:h.databaseOrder(db,order.id)};
 });
}
