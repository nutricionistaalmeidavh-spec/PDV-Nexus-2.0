/** Contrato existente do host PDV Nexus; não há serviço de terceiros. */
export async function request(route, {method='GET',body,token,signal}={}) {
  const headers={};
  if(body!==undefined) headers['content-type']='application/json';
  if(token) headers.authorization=`Bearer ${token}`;
  let res;
  try { res=await fetch(route,{method,headers,credentials:'same-origin',body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'}); }
  catch { throw new Error('Host indisponível. Nenhuma alteração foi confirmada.'); }
  const contentType=res.headers.get('content-type')||'';
  const value=contentType.includes('application/json')?await res.json():null;
  if(!res.ok) throw new Error(value?.message||`Operação não confirmada (${res.status})`);
  return value;
}
export const commandId=()=>crypto.randomUUID();
export function authFor(token){return (route,options={})=>request(route,{...options,token});}
