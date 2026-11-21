/** Canonical host refresh, KDS polling and one-active-command guard.
 No shadow ledger or duplicated canonical order state. */
import {useCallback,useEffect,useRef} from 'react';
const toStringError=e=>e instanceof Error?e.message:'Falha não identificada';
export function useHostRefresh({api,mode,pairedRole,setProducts,setCategories,setOrders,setSession,setTables,setTickets,setJobs,setError}){
 return useCallback(async()=>{if(mode!=='live'&&mode!=='paired')return;const requests=mode==='paired'?(pairedRole==='kitchen'?[['tickets','/api/kitchen/tickets']]:[['products','/api/products'],['orders','/api/orders'],['tables','/api/tables']]):[['products','/api/products'],['categories','/api/categories'],['orders','/api/orders'],['cash','/api/cash/current'],['tables','/api/tables'],['tickets','/api/kitchen/tickets'],['print','/api/print/jobs']];const result=await Promise.allSettled(requests.map(async ([key,path])=>({key,data:await api(path)})));let failed=[];for(let i=0;i<result.length;i++){const state=result[i];if(state.status!=='fulfilled'){failed.push(requests[i][0]);continue;}const {key,data}=state.value;if(key==='products')setProducts(data.products||[]);if(key==='categories')setCategories(data.categories||[]);if(key==='orders')setOrders(data.orders||[]);if(key==='cash')setSession(data.session||null);if(key==='tables')setTables(data.tables||[]);if(key==='tickets')setTickets(data.tickets||[]);if(key==='print')setJobs(data.jobs||[]);}if(failed.length)setError(`Alguns módulos não puderam ser atualizados: ${failed.join(', ')}. Verifique permissões e conexão.`);},[api,mode,pairedRole]);
}
export function useKitchenPolling({api,mode,view,setTickets,setError}){
 useEffect(()=>{if((mode!=='live'&&mode!=='paired')||view!=='kds')return;const timer=setInterval(()=>void api('/api/kitchen/tickets').then(d=>setTickets(d.tickets||[])).catch(e=>setError(toStringError(e))),8000);return()=>clearInterval(timer)},[mode,view,api]);
}
export function useBusyCommand({setBusy,setNotice,setError}){
 const working=useRef(false);
 const run=useCallback(async(task)=>{if(working.current)return Promise.reject(new Error('Operação em andamento'));working.current=true;setBusy(true);setNotice('');setError('');try{return await task();}catch(e){setError(toStringError(e));throw e;}finally{working.current=false;setBusy(false);}},[]);
 return run;
}
