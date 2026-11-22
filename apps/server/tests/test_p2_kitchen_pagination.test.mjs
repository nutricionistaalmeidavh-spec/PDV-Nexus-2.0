import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {kitchenRead} from '../src/kitchen-service.mjs';

test('P2: paginação keyset da cozinha percorre mais de 200 tickets sem repetir registros',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-kds-paged-'));
 const db=openDatabase(path.join(dir,'db.sqlite'));
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const product=randomUUID();
 db.prepare("INSERT INTO menu_product(id,category_id,name,price_cents) VALUES(?,'c-default','Produto',100)").run(product);
 const addOrder=db.prepare("INSERT INTO sales_order(id,restaurant_id,terminal_id,service_mode,status,revision,created_at) VALUES(?,'r-local','t-local','counter','OPEN',0,?)");
 const addLine=db.prepare("INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES(?,?,?,'Produto',100,1)");
 const addTicket=db.prepare("INSERT INTO kitchen_ticket(id,order_id,line_id,status,revision,created_at,updated_at) VALUES(?,?,?,'PENDING',0,?,?)");
 for(let i=0;i<225;i++){
   const order=randomUUID(),line=randomUUID(),ticket=randomUUID();
   const date=new Date(Date.UTC(2026,0,1,1,Math.floor(i/60),i%60)).toISOString();
   addOrder.run(order,date);addLine.run(line,order,product);addTicket.run(ticket,order,line,date,date);
 }
 const all=[],h={bad:message=>{throw Error(message)}};
 let cursor=null;
 do{
  const params=new URLSearchParams({limit:'80',...(cursor?{cursor}:{})});
  const result=kitchenRead(db,'GET','/api/kitchen/tickets',h,params);
  assert.equal(result.status,200);
  assert.ok(result.body.tickets.length<=80);
  all.push(...result.body.tickets.map(t=>t.id));
  cursor=result.body.nextCursor;
  assert.ok(all.length<=240,'A paginação nunca deve repetir páginas');
 }while(cursor);
 assert.equal(all.length,225);
 assert.equal(new Set(all).size,225);
 assert.throws(()=>kitchenRead(db,'GET','/api/kitchen/tickets',h,new URLSearchParams('cursor=invalid')),/cursor|página|paginação/i);
});
