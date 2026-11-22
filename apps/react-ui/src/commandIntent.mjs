/** Local, bounded request-intent cache. IDs are not business state: SQLite is canonical.
 * Preserve commandId across network uncertainty; rotate it only after a confirmed ACK
 * or a changed payload. Never persist payment credentials or order data here.
 */
const canonical=value=>Array.isArray(value)?value.map(canonical):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export function createCommandIntentStore(createId=()=>crypto.randomUUID(),{maxPending=128}={}){
  if(typeof createId!=='function'||!Number.isSafeInteger(maxPending)||maxPending<1||maxPending>4096)
    throw new Error('Parâmetros de intenção inválidos');
  const pending=new Map();
  function reserve(scope,payload){
    if(typeof scope!=='string'||!scope||scope.length>256)throw Error('Escopo de comando inválido');
    const serialized=JSON.stringify(canonical(payload));
    if(!serialized||serialized.length>8192)throw Error('Payload de comando inválido');
    const current=pending.get(scope);
    if(current?.payload===serialized)return {...current};
    const entry={scope,payload:serialized,commandId:createId()};
    pending.delete(scope);
    pending.set(scope,entry);
    while(pending.size>maxPending)pending.delete(pending.keys().next().value);
    return {...entry};
  }
  function ack(entry){
    if(!entry?.scope)return;
    if(pending.get(entry.scope)?.commandId===entry.commandId)pending.delete(entry.scope);
  }
  return {reserve,ack,pendingCount:()=>pending.size};
}
