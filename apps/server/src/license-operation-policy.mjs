/** Keep settlement and fulfillment of existing work possible after commercial trial expiry.
 * Creating orders, changing catalog or editing stock remains license-gated.
 * The actual orders/tickets are verified by the canonical handlers.
 */
export function mayFinishExistingOperation(method,route){
  if(method!=='POST')return false;
  return route==='/api/cash/close'||route==='/api/cash/print' ||
    /^\/api\/orders\/[^/]+\/(?:confirm|cancel|close|refund|refund-items|payments\/partial)$/.test(route) ||
    /^\/api\/kitchen\/tickets\/[^/]+\/status$/.test(route) ||
    /^\/api\/attendance\/tickets\/[^/]+\/(?:claim|deliver)$/.test(route) ||
    /^\/api\/delivery\/orders\/[^/]+\/status$/.test(route) ||
    /^\/api\/print\/jobs\/[^/]+\/(?:send|reprint)$/.test(route);
}

/** Narrow exception: an existing unsettled order may require opening a cash shift
 * to record its payment after entitlement expiry. Never creates a new order.
 */
export function mayOpenCashForUnfinishedOrders(db,method,route){
 if(method!=='POST'||route!=='/api/cash/open')return false;
 return !!db.prepare("SELECT 1 FROM sales_order WHERE status IN ('DRAFT','OPEN') LIMIT 1").get();
}
