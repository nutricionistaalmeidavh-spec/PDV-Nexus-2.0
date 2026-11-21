/** Interface pública de restaurante preservada para o host e outros serviços.
    As operações concretas vivem em módulos com responsabilidades isoladas. */
import {tableRead,tableWrite} from './table-service.mjs';
import {modifierRead,modifierWrite} from './modifier-service.mjs';
import {kitchenRead,kitchenWrite} from './kitchen-service.mjs';
export {dispatchKitchenTickets} from './kitchen-service.mjs';

export function restaurantRead(db,method,route,h,params=new URLSearchParams()){
 if(method!=='GET')return null;
 const handled=tableRead(db,method,route,h)??modifierRead(db,method,route,h)??kitchenRead(db,method,route,h,params);
 if(handled)return handled;
 if(route==='/api/restaurant/summary') {
    const activeOrders=db.prepare("SELECT COUNT(*) AS n FROM sales_order WHERE status IN ('DRAFT','OPEN')").get().n;
    const occupiedTables=db.prepare("SELECT COUNT(DISTINCT service_table_id) AS n FROM sales_order WHERE service_table_id IS NOT NULL AND status IN ('DRAFT','OPEN')").get().n;
    const pendingTickets=db.prepare("SELECT COUNT(*) AS n FROM kitchen_ticket WHERE status IN ('PENDING','PREPARING')").get().n;
    return {status:200,body:{activeOrders,occupiedTables,pendingTickets}};
  }
 return null;
}
export function restaurantWrite(db,method,route,body,h){
 return tableWrite(db,method,route,body,h)??modifierWrite(db,method,route,body,h)??kitchenWrite(db,method,route,body,h);
}
