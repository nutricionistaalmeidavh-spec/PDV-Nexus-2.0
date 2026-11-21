/** Append a uniquely identified order line and snapshot product/recipe/modifiers atomically. */
import {randomUUID} from 'node:crypto';
import {addOrderLine} from '../../../packages/core/src/order.ts';
import {databaseOrder,writeOrder} from './order-read.mjs';
import {bad,missing,safeCents,assertRevision} from './request-validation.mjs';
import {snapshotLineRecipe} from './inventory.mjs';
import {dispatchKitchenTickets} from './restaurant.mjs';
const stamp=()=>new Date().toISOString();
export function orderLinesWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const {transact,audit}=h;
 if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/lines$/)) {
          const id=route.split('/')[3];
          return transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            const product=db.prepare('SELECT * FROM menu_product WHERE id=? AND active=1').get(body.productId);if(!product)missing('Produto');
            const note=body.note===undefined?'':typeof body.note==='string'?body.note.trim():null;
            if(note===null||note.length>240)bad('Observação inválida');
            const ids=body.modifierIds??[];
            if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length)bad('Adicionais inválidos');
            const modifiers=[];let extraCents=0;
            for(const modifierId of ids) {
              if(typeof modifierId!=='string')bad('Adicional inválido');
              const mod=db.prepare('SELECT * FROM product_modifier WHERE id=? AND product_id=? AND active=1').get(modifierId,product.id);
              if(!mod)bad('Adicional indisponível para este produto');
              extraCents+=mod.price_cents;if(!safeCents(extraCents))bad('Adicionais excedem limite seguro');
              modifiers.push(mod);
            }
            const unitPriceCents=product.price_cents+extraCents;if(!safeCents(unitPriceCents))bad('Preço excede limite seguro');
            const next=addOrderLine(order,{id:randomUUID(),productId:product.id,productName:product.name,unitPriceCents,quantity:body.quantity});
            const line=next.lines.at(-1);
            db.prepare('INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES (?,?,?,?,?,?)').run(line.id,id,line.productId,line.productName,line.unitPriceCents,line.quantity);
            db.prepare('UPDATE order_line SET note_snapshot=? WHERE id=?').run(note,line.id);
            if(product.is_combo){
              const items=db.prepare('SELECT c.product_id AS productId,c.quantity,p.name FROM menu_combo_item c JOIN menu_product p ON p.id=c.product_id WHERE c.combo_id=?').all(product.id);
              if(!items.length)conflict('Combo sem componentes cadastrados');
              const save=db.prepare('INSERT INTO order_line_combo_item(id,line_id,product_id,product_name_snapshot,quantity) VALUES(?,?,?,?,?)');
              for(const item of items)save.run(randomUUID(),line.id,item.productId,item.name,item.quantity);
            }
            snapshotLineRecipe(db,line.id,product.id);
            for(const mod of modifiers)db.prepare('INSERT INTO order_line_modifier(id,line_id,modifier_id,name_snapshot,price_cents_snapshot) VALUES (?,?,?,?,?)').run(randomUUID(),line.id,mod.id,mod.name,mod.price_cents);
            writeOrder(db,next);
            if(next.status==='OPEN')dispatchKitchenTickets(db,id,stamp);
            audit(db,id,'ORDER_ITEM_ADDED',{...line,modifierIds:ids});
            return {order:databaseOrder(db,id)};
          });
        
 }
 return null;
}
