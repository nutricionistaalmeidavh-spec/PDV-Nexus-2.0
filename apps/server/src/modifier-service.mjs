/** Personalização: adicionais específicos de produtos, sem reprecificar linhas já vendidas. */
import {randomUUID} from 'node:crypto';
export function modifierRead(db,method,route,{missing}){
 if(method!=='GET')return null;
 const modifiers=route.match(/^\/api\/products\/([^/]+)\/modifiers$/);
  if(modifiers) {
    if(!db.prepare('SELECT 1 FROM menu_product WHERE id=?').get(modifiers[1])) missing('Produto');
    return {status:200,body:{modifiers:db.prepare('SELECT id,name,price_cents AS priceCents,active FROM product_modifier WHERE product_id=? ORDER BY name').all(modifiers[1])}};
  }
 return null;
}
export function modifierWrite(db,method,route,body,h){
 const {transact,requireString,requireCents,missing,audit}=h;
 const createModifier=route.match(/^\/api\/products\/([^/]+)\/modifiers$/);
  if(method==='POST'&&createModifier) return transact(db,route,body,()=>{
    const productId=createModifier[1];
    if(!db.prepare('SELECT 1 FROM menu_product WHERE id=?').get(productId))missing('Produto');
    const name=requireString(body.name,'Nome do adicional',80),priceCents=requireCents(body.priceCents,'Preço');
    const modifier={id:randomUUID(),productId,name,priceCents};
    db.prepare('INSERT INTO product_modifier(id,product_id,name,price_cents) VALUES(?,?,?,?)').run(modifier.id,productId,name,priceCents);
    audit(db,productId,'MODIFIER_CREATED',modifier);return {modifier};
  },201);
 return null;
}
