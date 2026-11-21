/** Thin command dispatch; preserves existing /api/orders contracts. */
import {orderLifecycleWrite} from './order-lifecycle.mjs';
import {orderLinesWrite} from './order-lines.mjs';
export function orderWrite(db,method,route,body,helpers){
 return orderLifecycleWrite(db,method,route,body,helpers)??orderLinesWrite(db,method,route,body,helpers);
}
