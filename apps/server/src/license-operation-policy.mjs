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
