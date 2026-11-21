/** Canonical order lifecycle: create, confirm, close and cancel within caller transaction. */
import {randomUUID} from 'node:crypto';
import {createOrder,confirmOrder,closeOrder,cancelOrder} from '../../../packages/core/src/order.ts';
import {HttpError,bad,conflict,missing,requireString,requireCents,safeCents,assertRevision} from './request-validation.mjs';
import {databaseOrder,writeOrder} from './order-read.mjs';
import {dispatchKitchenTickets} from './restaurant.mjs';
import {assertSplitConsistent} from './restaurant-extras.mjs';
import {consumeStockForOrder} from './inventory.mjs';
const stamp=()=>new Date().toISOString();
export function orderLifecycleWrite(db,method,route,body,h){
 if(method!=='POST')return null;
 const {transact,audit,actor,operatorRole,deviceRole,cashSession}=h;
 if(method==='POST'&&route==='/api/orders') {
          return transact(db,route,body,()=>{
            if(body.serviceMode==='table') {
              if(!body.tableId)bad('Mesa obrigatória');
              if(!db.prepare("SELECT 1 FROM service_table WHERE id=? AND restaurant_id='r-local'").get(body.tableId))missing('Mesa');
              if(db.prepare("SELECT 1 FROM sales_order WHERE service_table_id=? AND status IN ('DRAFT','OPEN')").get(body.tableId))conflict('Mesa ocupada','TABLE_OCCUPIED');
            } else if(body.tableId!==undefined)bad('Mesa apenas para atendimento em mesa');
            const order=createOrder({id:randomUUID(),serviceMode:body.serviceMode,createdAt:stamp()});
            db.prepare('INSERT INTO sales_order(id,restaurant_id,terminal_id,service_table_id,service_mode,status,revision,created_at) VALUES(?,?,?,?,?,?,?,?)')
              .run(order.id,'r-local','t-local',body.serviceMode==='table'?body.tableId:null,order.serviceMode,order.status,order.revision,order.createdAt);
            audit(db,order.id,'ORDER_CREATED',{serviceMode:order.serviceMode});
            return {order:databaseOrder(db,order.id)};
          },201);
        } else if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/confirm$/)) {
          const id=route.split('/')[3];
          return transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            const next=confirmOrder(order);writeOrder(db,next);dispatchKitchenTickets(db,id,stamp);audit(db,id,'ORDER_CONFIRMED');return {order:databaseOrder(db,id)};
          });
        } else if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/close$/)) {
          const id=route.split('/')[3];
          return transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            try{assertSplitConsistent(db,id);}catch(e){conflict(e.message,'INCOMPLETE_SPLIT');}
            const session=cashSession(db);if(!session)conflict('Abra o caixa antes de receber pagamento','CASH_CLOSED');
            const payments=body.payments;if(!Array.isArray(payments)||payments.length===0||payments.length>10)bad('Pagamentos inválidos');
            let amount=0,change=0;
            for(const p of payments) {
              if(!['cash','pix','credit','debit','other'].includes(p.method))bad('Meio de pagamento inválido');
              requireCents(p.amountCents,'Pagamento',false);
              if(p.method==='cash') {
                requireCents(p.tenderedCents??p.amountCents,'Valor recebido');
                if((p.tenderedCents??p.amountCents)<p.amountCents)bad('Dinheiro recebido inferior ao pagamento');
                change+= (p.tenderedCents??p.amountCents)-p.amountCents;
              } else if(p.tenderedCents!==undefined) bad('Troco somente para dinheiro');
              amount+=p.amountCents;
              if(!safeCents(amount)||!safeCents(change))bad('Valor excedeu limite seguro');
            }
            let next;try{next=closeOrder(order,amount);}catch(e){bad(e.message);}
            const stock=consumeStockForOrder(db,id,actor,conflict);
            for(const p of payments)db.prepare('INSERT INTO payment(id,order_id,method,amount_cents,state,created_at,cash_session_id) VALUES(?,?,?,?,?,?,?)')
              .run(randomUUID(),id,p.method,p.amountCents,'CONFIRMED',stamp(),session.id);
            writeOrder(db,next);
            db.prepare('INSERT INTO outbox_event(id,kind,aggregate_id,payload_json,status,created_at) VALUES (?,?,?,?,?,?)')
              .run(randomUUID(),'PRINT_RECEIPT',id,JSON.stringify({id,lines:next.lines,totalCents:amount}),'PENDING',stamp());
            audit(db,id,'ORDER_CLOSED',{payments,changeCents:change,cogsCents:stock.cogsCents});
            return {order:databaseOrder(db,id),changeCents:change};
          });
        } else if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/cancel$/)) {
          const id=route.split('/')[3];
          return transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            const reason=requireString(body.reason,'Motivo do cancelamento',240);
            // Após confirmar, só supervisor local ou gerente LAN pode cancelar.
            if(order.status==='OPEN'&&operatorRole!=='admin'&&deviceRole!=='manager')
              throw new HttpError(403,'SUPERVISOR_REQUIRED','Cancelamento de comanda confirmada exige supervisor');
            const production=db.prepare("SELECT 1 FROM kitchen_ticket WHERE order_id=? AND status IN ('PREPARING','READY','SERVED') LIMIT 1").get(id);
            if(production)conflict('Produção já iniciada: faça o procedimento gerencial de ocorrência, sem apagar a comanda','KITCHEN_ALREADY_STARTED');
            if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(id))
              conflict('Comanda possui pagamento registrado; utilize o fluxo financeiro de devolução','ORDER_HAS_PAYMENT');
            const next=cancelOrder(order);writeOrder(db,next);
            db.prepare("UPDATE kitchen_ticket SET status='CANCELLED',revision=revision+1,updated_at=? WHERE order_id=? AND status NOT IN ('SERVED','CANCELLED')").run(stamp(),id);
            audit(db,id,'ORDER_CANCELLED',{reason});return {order:databaseOrder(db,id)};
          });
        
 }
 return null;
}
