/** Shared HTTP/domain contract failures; same codes and status as the pre-refactor host. */
export class HttpError extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export const bad=(message,code='INVALID_INPUT')=>{throw new HttpError(400,code,message);};
export const conflict=(message,code='CONFLICT')=>{throw new HttpError(409,code,message);};
export const missing=what=>{throw new HttpError(404,'NOT_FOUND',what+' não encontrado');};
export const safeCents=(v,allowZero=true)=>Number.isSafeInteger(v)&&v>=(allowZero?0:1);
export const requireCents=(v,label='Valor',zero=true)=>{if(!safeCents(v,zero))bad(label+' inválido');return v;};
export const requireString=(v,label,max=120)=>{if(typeof v!=='string'||!v.trim()||v.length>max)bad(label+' inválido');return v.trim();};
export function assertRevision(order,revision){
 if(!Number.isSafeInteger(revision)||revision<0)bad('Revisão obrigatória');
 if(order.revision!==revision)conflict('Pedido alterado em outro terminal','REVISION_CONFLICT');
}

/** One canonical approval policy for cancelling an already confirmed order. */
export function requireSupervisorForConfirmed(order,operatorRole,deviceRole){
 if(order.status==='OPEN'&&operatorRole!=='admin'&&deviceRole!=='manager')
  throw new HttpError(403,'SUPERVISOR_REQUIRED','Cancelamento de comanda confirmada exige supervisor');
}
