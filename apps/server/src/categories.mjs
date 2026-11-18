/** Categories live in the existing canonical menu_category table. Historical orders retain snapshots. */
import {randomUUID} from 'node:crypto';
function activeCategory(db,id){return db.prepare("SELECT id FROM menu_category WHERE id=? AND restaurant_id='r-local' AND active=1").get(id);}
export function categoryRead(db,method,route){
  if(method!=='GET'||route!=='/api/categories')return null;
  return {status:200,body:{categories:db.prepare("SELECT id,name,sort_order AS sortOrder,active FROM menu_category WHERE restaurant_id='r-local' ORDER BY sort_order,name COLLATE NOCASE").all()}};
}
export function categoryWrite(db,method,route,body,h){
  const {transact,requireString,bad,missing,audit,conflict}=h;
  if(method==='POST'&&route==='/api/categories')return transact(db,route,body,()=>{
    const name=requireString(body.name,'Nome da categoria',80);
    if(db.prepare("SELECT 1 FROM menu_category WHERE restaurant_id='r-local' AND name=? COLLATE NOCASE AND active=1").get(name))conflict('Categoria ja existe');
    const item={id:randomUUID(),name,active:1,sortOrder:0};
    db.prepare('INSERT INTO menu_category(id,restaurant_id,name) VALUES(?,?,?)').run(item.id,'r-local',name);
    audit(db,item.id,'CATEGORY_CREATED',item);
    return {category:item};
  },201);
  const patch=route.match(/^\/api\/categories\/([^/]+)$/);
  if(method==='PATCH'&&patch)return transact(db,route,body,()=>{
    const id=patch[1],name=requireString(body.name,'Nome da categoria',80);
    const previous=db.prepare("SELECT id,active FROM menu_category WHERE id=? AND restaurant_id='r-local'").get(id);
    if(!previous)missing('Categoria');
    if(!previous.active)conflict('Categoria arquivada');
    if(db.prepare("SELECT 1 FROM menu_category WHERE restaurant_id='r-local' AND id<>? AND name=? COLLATE NOCASE AND active=1").get(id,name))conflict('Categoria ja existe');
    db.prepare('UPDATE menu_category SET name=? WHERE id=?').run(name,id);
    audit(db,id,'CATEGORY_RENAMED',{name});return {category:{id,name,active:1}};
  });
  const archive=route.match(/^\/api\/categories\/([^/]+)\/archive$/);
  if(method==='POST'&&archive)return transact(db,route,body,()=>{
    const id=archive[1];
    const category=db.prepare("SELECT id,name,active FROM menu_category WHERE id=? AND restaurant_id='r-local'").get(id);
    if(!category)missing('Categoria');
    if(category.id==='c-default')conflict('Categoria padrao nao pode ser arquivada');
    if(!category.active)conflict('Categoria ja arquivada');
    db.prepare('UPDATE menu_category SET active=0 WHERE id=?').run(id);
    audit(db,id,'CATEGORY_ARCHIVED',{name:category.name});
    return {category:{...category,active:0}};
  });
  return null;
}
export {activeCategory};
