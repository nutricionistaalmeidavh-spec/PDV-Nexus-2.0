import React,{useEffect,useState} from 'react';
import {formatMoney,parseMoney} from './model.mjs';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
export function AdvancedOrderOperations({order,tables,api,onAction,busy,mode,canManage}){
 const [stations,setStations]=useState([]),[printStation,setPrintStation]=useState(''),[mergeId,setMergeId]=useState('');
 const [priceLine,setPriceLine]=useState(''),[newPrice,setNewPrice]=useState(''),[reason,setReason]=useState('');
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  if(mode==='demo')return;let live=true;
  api('/api/kitchen/stations').then(x=>{if(live)setStations(x.stations||[])}).catch(()=>{});
  return()=>{live=false};
 },[api,mode]);
 const print=async type=>{
  setError('');setNotice('');
  try{
   const result=await onAction('/api/orders/'+encodeURIComponent(order.id)+'/print',{
    type,...(type==='KITCHEN'?{stationId:printStation||null}:{})
   });
   if(result?.printJob)setNotice('Comprovante enfileirado: '+result.printJob.id.slice(0,8)+'. Envie em Impressão.');
  }catch(e){setError(e.message)}
 };
 const merge=async()=>{
  setError('');setNotice('');
  try{
   if(!mergeId)throw Error('Selecione a comanda de origem');
   const data=await api('/api/orders/'+encodeURIComponent(mergeId));
   const result=await onAction('/api/orders/'+encodeURIComponent(order.id)+'/merge',{
    sourceOrderId:mergeId,expectedSourceRevision:data.order.revision
   });
   if(result)setNotice('Comandas unidas preservando as identidades de cada item.');
  }catch(e){setError(e.message)}
 };
 const override=async e=>{
  e.preventDefault();setError('');setNotice('');
  try{
   const unitPriceCents=parseMoney(newPrice);
   const result=await onAction('/api/orders/'+encodeURIComponent(order.id)+'/lines/'+encodeURIComponent(priceLine)+'/override-price',{
    unitPriceCents,reason
   });
   if(result){setNotice('Preço atualizado com trilha de auditoria');setPriceLine('');setNewPrice('');setReason('')}
  }catch(e){setError(e.message)}
 };
 return <section className="panel">
  <div className="sectiontitle"><h2>Impressão e operações avançadas</h2></div>
  <p className="help">Comprovantes não fiscais enviados à fila local. Nenhum serviço externo é necessário.</p>
  <div className="row wrap">
   <button type="button" className="btn secondary" disabled={busy||mode==='demo'} onClick={()=>void print('PREBILL')}>Gerar pré-conta</button>
   <label className="field">Setor da cozinha<select value={printStation} onChange={e=>setPrintStation(e.target.value)}>
    <option value="">Setor geral</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
   </select></label>
   <button type="button" className="btn secondary" disabled={busy||mode==='demo'||order.status==='DRAFT'} onClick={()=>void print('KITCHEN')}>Gerar ticket da cozinha</button>
  </div>
  {canManage&&order.serviceMode==='table'&&<details>
   <summary>Juntar comandas de duas mesas</summary><p className="help">Somente comandas ativas, ainda sem pagamentos. A comanda de origem será encerrada e as linhas permanecerão identificadas.</p>
   <div className="row wrap">
    <label className="field grow">Mesa de origem<select value={mergeId} onChange={e=>setMergeId(e.target.value)}>
     <option value="">Selecionar</option>{tables.filter(t=>t.orderId&&t.orderId!==order.id).map(t=><option key={t.orderId} value={t.orderId}>{t.label}</option>)}
    </select></label>
    <button type="button" className="btn secondary" disabled={!mergeId||busy} onClick={()=>void merge()}>Juntar à comanda atual</button>
   </div>
  </details>}
  {canManage&&<details><summary>Alterar preço individual com justificativa (supervisor)</summary>
   <form className="stack" onSubmit={override}>
    <label className="field">Item<select required value={priceLine} onChange={e=>setPriceLine(e.target.value)}>
     <option value="">Selecione</option>{order.lines.map(x=><option value={x.id} key={x.id}>{x.productName} · {money(x.unitPriceCents)}/un.</option>)}
    </select></label>
    <label className="field">Novo preço unitário em R$<input required inputMode="decimal" value={newPrice} onChange={e=>setNewPrice(e.target.value)} placeholder="0,00"/></label>
    <label className="field">Justificativa<input required value={reason} maxLength={240} onChange={e=>setReason(e.target.value)}/></label>
    <button className="btn primary" disabled={!priceLine||busy||!['DRAFT','OPEN'].includes(order.status)}>Atualizar preço auditado</button>
   </form>
  </details>}
  {error&&<p role="alert" className="errorbox">{error}</p>}{notice&&<p className="notice">{notice}</p>}
 </section>;
}
