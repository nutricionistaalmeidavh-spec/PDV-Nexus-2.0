/** Canonical host refresh, KDS polling and one-active-command guard.
 No shadow ledger or duplicated canonical order state. */
import {useCallback,useEffect,useRef} from 'react';
import {createSseEventParser} from './kitchenEvents.mjs';
const toStringError=e=>e instanceof Error?e.message:'Falha não identificada';
export function useHostRefresh({api,mode,pairedRole,setProducts,setCategories,setOrders,setSession,setTables,setTickets,setJobs,setError}){
 return useCallback(async()=>{if(mode!=='live'&&mode!=='paired')return;const requests=mode==='paired'?(pairedRole==='kitchen'?[['tickets','/api/kitchen/tickets']]:[['products','/api/products'],['orders','/api/orders'],['tables','/api/tables']]):[['products','/api/products'],['categories','/api/categories'],['orders','/api/orders'],['cash','/api/cash/current'],['tables','/api/tables'],['tickets','/api/kitchen/tickets'],['print','/api/print/jobs']];const result=await Promise.allSettled(requests.map(async ([key,path])=>({key,data:await api(path)})));let failed=[];for(let i=0;i<result.length;i++){const state=result[i];if(state.status!=='fulfilled'){failed.push(requests[i][0]);continue;}const {key,data}=state.value;if(key==='products')setProducts(data.products||[]);if(key==='categories')setCategories(data.categories||[]);if(key==='orders')setOrders(data.orders||[]);if(key==='cash')setSession(data.session||null);if(key==='tables')setTables(data.tables||[]);if(key==='tickets')setTickets(data.tickets||[]);if(key==='print')setJobs(data.jobs||[]);}if(failed.length)setError(`Alguns módulos não puderam ser atualizados: ${failed.join(', ')}. Verifique permissões e conexão.`);},[api,mode,pairedRole]);
}
/** SSE is the primary host signal; a 30s poll is a safe recovery path.
 * Paired devices send their scoped Bearer token; the local POS uses its cookie.
 * Only SQLite/API are canonical, no shadow state or optimistic KDS transitions.
 */
export function useKitchenPolling({api,mode,view,setTickets,setError,token}){
 useEffect(()=>{
  if((mode!=='live'&&mode!=='paired')||view!=='kds')return;
  let active=true,inFlight=false,reconnectTimer=null;
  const controller=new AbortController();
  const refresh=async()=>{
   if(!active||inFlight)return;
   inFlight=true;
   try{
    const result=await api('/api/kitchen/tickets');
    if(active)setTickets(result.tickets||[]);
   }catch(e){if(active)setError(toStringError(e));}
   finally{inFlight=false;}
  };
  const connection=async()=>{
   while(active&&!controller.signal.aborted){
    try{
     const response=await fetch('/api/kitchen/events',{
      method:'GET',credentials:'same-origin',cache:'no-store',
      ...(token?{headers:{authorization:'Bearer '+token}}:{}),
      signal:controller.signal
     });
     if(!response.ok||!response.body)throw Error('Eventos da cozinha indisponíveis');
     const reader=response.body.getReader(),decoder=new TextDecoder();
     const parse=createSseEventParser(({event})=>{
      if(event==='ready'||event==='changed')void refresh();
     });
     try{
      for(;;){
       const {done,value}=await reader.read();
       if(done||!active)break;
       parse(decoder.decode(value,{stream:true}));
      }
     }finally{reader.releaseLock();}
    }catch{
     // Use polling as fallback; do not overwrite the UI with transient SSE errors.
    }
    if(!active)break;
    await new Promise(resolve=>{
      reconnectTimer=setTimeout(()=>{reconnectTimer=null;resolve();},3000);
      if(controller.signal.aborted){clearTimeout(reconnectTimer);reconnectTimer=null;resolve();}
      else controller.signal.addEventListener('abort',()=>{
       if(reconnectTimer!==null){clearTimeout(reconnectTimer);reconnectTimer=null;resolve();}
      },{once:true});
    });
   }
  };
  void refresh();
  void connection();
  const timer=setInterval(()=>void refresh(),30000);
  return()=>{active=false;controller.abort();clearInterval(timer);if(reconnectTimer)clearTimeout(reconnectTimer);};
 },[api,mode,view,setTickets,setError,token]);
}
export function useBusyCommand({setBusy,setNotice,setError}){
 const working=useRef(false);
 const run=useCallback(async(task)=>{if(working.current)return Promise.reject(new Error('Operação em andamento'));working.current=true;setBusy(true);setNotice('');setError('');try{return await task();}catch(e){setError(toStringError(e));throw e;}finally{working.current=false;setBusy(false);}},[]);
 return run;
}
