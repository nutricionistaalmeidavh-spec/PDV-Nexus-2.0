import React,{useEffect,useState} from 'react';
import {formatMoney} from './model.mjs';
import {GuestPayments,PizzaOrderPanel,WeighedOrderPanel} from './RestaurantExtensions.jsx';
import {AdvancedOrderOperations} from './RestaurantAdvanced.jsx';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const uuid=()=>crypto.randomUUID();
function Panel({title,children}){return <section className="panel"><div className="sectiontitle"><h2>{title}</h2></div>{children}</section>}
const asGuests=(value,quantity)=>{
 const groups=String(value).split(',').map(x=>x.trim()).filter(Boolean).map(part=>{
   const separator=part.lastIndexOf(':');
   if(separator<1)throw Error('Use Nome:quantidade, separados por vírgulas');
   const guest=part.slice(0,separator).trim(),count=Number(part.slice(separator+1).trim());
   if(!guest||guest.length>60||!Number.isSafeInteger(count)||count<=0)throw Error('Informe um nome e quantidade inteira positiva');
   return {guest,quantity:count};
 });
 if(groups.reduce((sum,x)=>sum+x.quantity,0)!==quantity)throw Error('A soma das quantidades deve corresponder aos itens do pedido');
 if(new Set(groups.map(x=>x.guest.toLowerCase())).size!==groups.length)throw Error('Não repita convidados no mesmo item');
 return groups;
};

function LineEditDialog({line,api,onClose,onSave,onCancel,busy}){
 const [quantity,setQuantity]=useState(String(line.quantity));
 const [note,setNote]=useState(line.note||'');
 const [chosen,setChosen]=useState((line.modifiers||[]).map(m=>m.id).filter(Boolean));
 const [mods,setMods]=useState([]),[reason,setReason]=useState(''),[error,setError]=useState('');
 const special=!!line.pizza||!!line.weight;
 useEffect(()=>{
  let live=true;
  api('/api/products/'+encodeURIComponent(line.productId)+'/modifiers').then(data=>{
    if(live)setMods(data.modifiers||[]);
  }).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[api,line.id,line.productId]);
 const save=async()=>{
  const n=Number(quantity);
  if(!Number.isSafeInteger(n)||n<1||n>100){setError('Informe quantidade entre 1 e 100');return}
  const result=await onSave({quantity:n,note:note.trim(),modifierIds:chosen});
  if(result)onClose();
 };
 const cancel=async()=>{
  if(!reason.trim()){setError('Informe o motivo para cancelar apenas este item');return}
  const result=await onCancel({reason:reason.trim()});
  if(result)onClose();
 };
 return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section className="modal modal-wide" role="dialog" aria-modal="true" aria-label={'Editar '+line.productName}>
   <header className="modal-head"><h2>Editar item da comanda</h2><button type="button" className="btn icon" onClick={onClose} aria-label="Fechar">×</button></header>
   <div className="modal-content stack">
    <strong>{line.productName}</strong>
    <p className="help">{special?'Produto com composição ou pesagem congelada: cancele este item e adicione novamente para alterar.':'A cozinha recebe a correção com histórico. Alterações após início do preparo exigem supervisor.'}</p>
    {!special&&<label className="field">Quantidade<input type="number" min="1" max="100" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>}
    {!special&&<label className="field">Observações<textarea maxLength={240} value={note} onChange={e=>setNote(e.target.value)}/></label>}
    {!special&&<div className="stack"><strong>Adicionais</strong>{mods.map(m=><label className="option-row" key={m.id}>
     <input type="checkbox" disabled={!m.active} checked={chosen.includes(m.id)} onChange={e=>setChosen(s=>e.target.checked?[...s,m.id]:s.filter(id=>id!==m.id))}/>
     <span>{m.name}{!m.active?' (indisponível)':''}</span><strong>+ {money(m.priceCents)}</strong>
    </label>)}</div>}
    {error&&<p className="errorbox" role="alert">{error}</p>}
    <div className="row wrap end"><button className="btn secondary" type="button" onClick={onClose}>Voltar</button>
     {!special&&<button className="btn primary" disabled={busy} onClick={()=>void save()}>Salvar correção</button>}</div>
    <div className="stack" style={{borderTop:'1px solid #eee',paddingTop:12}}>
     <label className="field">Cancelar apenas este item — motivo obrigatório<input maxLength={240} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ex.: cliente desistiu"/></label>
     <button className="btn secondary" disabled={busy||!reason.trim()} onClick={()=>void cancel()}>Cancelar item da comanda</button>
    </div>
   </div>
  </section>
 </div>;
}
function TableQrPanel({order,api,mode,run,busy,onError}){
 const [publicBaseUrl,setPublicBaseUrl]=useState('');
 const [autoAccept,setAutoAccept]=useState(false);
 const [qr,setQr]=useState(null),[requests,setRequests]=useState([]);
 const [rejection,setRejection]=useState({});
 useEffect(()=>{
  if(!order?.tableId||!['live','paired'].includes(mode))return;
  let live=true;
  const load=()=>api('/api/tables/'+encodeURIComponent(order.tableId)+'/requests')
    .then(data=>{if(live)setRequests(data.requests||[])}).catch(e=>{if(live)onError(e.message)});
  void load();const timer=setInterval(load,10000);
  return()=>{live=false;clearInterval(timer)};
 },[api,order?.tableId,mode]);
 const refresh=async()=>{
  try{const data=await api('/api/tables/'+encodeURIComponent(order.tableId)+'/requests');setRequests(data.requests||[]);}
  catch(e){onError(e.message)}
 };
 const issue=async()=>{
  const result=await run('/api/tables/'+encodeURIComponent(order.tableId)+'/qr',{publicBaseUrl:publicBaseUrl.trim(),autoAccept});
  if(result)setQr(result);
 };
 const decide=async(request,accept)=>{
  const route='/api/table-requests/'+encodeURIComponent(request.id)+'/'+(accept?'accept':'reject');
  const result=await run(route,accept?{}:{reason:rejection[request.id]||''});
  if(result)await refresh();
 };
 return <div className="stack">
  <Panel title="QR Code para pedidos na mesa">
   <p className="help">A mesa precisa ter comanda aberta. O link é individual, expira em 12 horas e perde a validade ao fechar ou transferir a mesa. Um novo QR revoga o anterior.</p>
   <label className="field">URL HTTPS do portal público (self-hosted)
    <input type="url" value={publicBaseUrl} onChange={e=>setPublicBaseUrl(e.target.value)} placeholder="https://menu.seu-restaurante.com.br/" maxLength={512}/>
   </label>
   <label className="option-row"><input type="checkbox" checked={autoAccept} onChange={e=>setAutoAccept(e.target.checked)}/>
    <span>Enviar automaticamente à cozinha, sem aprovação de atendente</span></label>
   <button className="btn primary" disabled={busy||!publicBaseUrl||!['live','paired'].includes(mode)} onClick={()=>void issue()}>Gerar / renovar QR da mesa</button>
   {qr&&<div className="stack" style={{marginTop:12}}>
    <img src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr.qrSvg)} alt={'QR Code de '+qr.tableLabel} width="200" height="200"/>
    <a href={qr.url} target="_blank" rel="noreferrer">Abrir cardápio da mesa</a>
    <small>Válido até {new Date(qr.expiresAt).toLocaleString('pt-BR')} · {qr.autoAccept?'Envio automático':'Aprovação manual'}</small>
    <button className="btn secondary" type="button" onClick={()=>window.print()}>Imprimir QR</button>
   </div>}
  </Panel>
  <Panel title={'Solicitações de clientes ('+requests.filter(x=>x.status==='PENDING').length+' pendentes)'}>
   <div className="row wrap"><button className="btn secondary" onClick={()=>void refresh()}>Atualizar solicitações</button></div>
   {!requests.some(x=>x.status==='PENDING')&&<p className="help">Nenhuma solicitação pendente para esta mesa.</p>}
   {requests.filter(x=>x.status==='PENDING').map(request=><div className="stack" style={{borderBottom:'1px solid #eee',paddingBottom:12}} key={request.id}>
    <strong>{request.guestName||'Cliente da mesa'} · {money(request.totalCents)}</strong>
    {(request.items||[]).map((item,i)=><small key={i}>{item.quantity} × {item.productName}{item.note?' · '+item.note:''}{item.modifiers?.length?' · '+item.modifiers.map(m=>m.name).join(', '):''}</small>)}
    <div className="row wrap"><button disabled={busy} className="btn primary" onClick={()=>void decide(request,true)}>Aceitar e enviar à cozinha</button>
     <label className="field">Motivo da rejeição<input maxLength={240} value={rejection[request.id]||''} onChange={e=>setRejection(s=>({...s,[request.id]:e.target.value}))}/></label>
     <button disabled={busy||!(rejection[request.id]||'').trim()} className="btn secondary" onClick={()=>void decide(request,false)}>Rejeitar</button>
    </div>
   </div>)}
  </Panel>
 </div>;
}

export function TableOrderPanel({order,tables,products,api,mode,onUpdate,onBack,onCheckout,session,canManage=false}){
 const [productId,setProductId]=useState(''),[qty,setQty]=useState('1'),[note,setNote]=useState('');
 const [mods,setMods]=useState([]),[selectedMods,setSelectedMods]=useState([]);
 const [destination,setDestination]=useState('');
 const [alloc,setAlloc]=useState({}),[splits,setSplits]=useState(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState(null),[history,setHistory]=useState(null);
 useEffect(()=>{setAlloc(Object.fromEntries((order?.lines||[]).map(l=>[l.id,'Pessoa 1:'+l.quantity])));setSplits(null);},[order?.id,order?.lines?.length]);
 useEffect(()=>{
  if(!productId||mode!=='live'&&mode!=='paired'){setMods([]);return;}
  let live=true;
  api('/api/products/'+encodeURIComponent(productId)+'/modifiers').then(x=>{if(live)setMods((x.modifiers||[]).filter(m=>m.active))}).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false;};
 },[api,mode,productId]);
 const run=async(route,body={})=>{
  if(!order||(mode!=='live'&&mode!=='paired')||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await api(route,{method:'POST',body:{commandId:uuid(),expectedRevision:order.revision,...body}});
   if(result.order)onUpdate(result.order);
   if(result.split)setSplits(result.split);
   setNotice('Operação registrada no host local.');
   return result;
  }catch(e){setError(e.message);}finally{setBusy(false)}
 };
 const lineAllowed=order&&['DRAFT','OPEN'].includes(order.status)&&!order.suspended&&!(order.payments||[]).length;
 const canConfirm=order?.status==='DRAFT'&&order?.lines?.length>0;
 const canCheckout=order?.status==='OPEN'&&!!session&&!(order.payments||[]).length;
 const safeProducts=products.filter(x=>x.active&&x.categoryActive!==0&&!x.isPizza&&x.saleUnit!=='kg');
 const total=order?.totalCents??0;
 const isTable=order?.serviceMode==='table';
 return <div className="page">
   <div className="pageheading"><div><p className="eyebrow">RESTAURANTE / COMANDA CANÔNICA</p><h1>{isTable?'Gerenciar mesa':'Gerenciar pedido'}</h1><p className="subtext">{order?.tableId?'Mesa vinculada':'Pedido'} · {order?.status||'Sem comanda'} · nenhuma operação é confirmada sem o host.</p></div><button className="btn secondary" onClick={onBack}>Voltar às mesas</button></div>
   {error&&<p className="errorbox" role="alert">{error}</p>}
   {notice&&<p className="help" role="status">{notice}</p>}
   {!order?<Panel title="Selecione uma mesa">Abra uma comanda no mapa do salão.</Panel>:<div className="stack">
    <div className="dashboard-grid">
     <Panel title="Itens da comanda">
      {(order.lines||[]).map(l=><div key={l.id} className="list-row"><span className="grow"><strong>{l.quantity} × {l.productName}</strong><small>{l.note||''}{l.modifiers?.length?' · '+l.modifiers.map(m=>m.name).join(', '):''}</small></span><strong>{money(l.quantity*l.unitPriceCents)}</strong><button className="btn secondary" type="button" disabled={!lineAllowed||busy} onClick={()=>setEditing(l)}>Editar</button></div>)}
      {!order.lines?.length&&<p className="help">Comanda vazia.</p>}
      <button className="btn secondary" type="button" disabled={mode==='demo'} onClick={()=>void api('/api/orders/'+encodeURIComponent(order.id)+'/line-history').then(x=>setHistory(x.events||[])).catch(e=>setError(e.message))}>Ver histórico dos itens</button>
      {history&&<div className="stack">{history.length===0?<p className="help">Sem correções anteriores.</p>:history.map(evt=><div className="list-row" key={evt.id}><span>{evt.action==='CANCELLED'?'Item cancelado':'Item alterado'} · {evt.before?.productName} · {new Date(evt.createdAt).toLocaleString('pt-BR')}</span><small>{evt.reason||'Correção registrada'}</small></div>)}</div>}
      <div className="total-hero"><span>Total</span><strong>{money(total)}</strong></div>
      <div className="row wrap compact">
       {canConfirm&&<button className="btn primary" disabled={busy} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/confirm')}>Confirmar e enviar à cozinha</button>}
       {canCheckout&&<button className="btn primary" disabled={busy} onClick={()=>onCheckout(order)}>Finalizar venda</button>}
       {order.status==='OPEN'&&!session&&<p className="help">Abra o caixa para registrar o recebimento.</p>}
      </div>
     </Panel>
     <Panel title="Adicionar produtos">
      <form className="form-grid" onSubmit={e=>{e.preventDefault();const quantity=Number(qty);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100){setError('Quantidade inválida');return}void run('/api/orders/'+encodeURIComponent(order.id)+'/lines',{productId,quantity,modifierIds:selectedMods,note:note.trim()}).then(result=>{if(result){setQty('1');setNote('');setSelectedMods([]);}});}}>
       <label className="field">Produto<select value={productId} required onChange={e=>{setProductId(e.target.value);setSelectedMods([])}}><option value="">Selecionar</option>{safeProducts.map(p=><option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)}</option>)}</select></label>
       <label className="field">Quantidade<input type="number" required min="1" max="100" value={qty} onChange={e=>setQty(e.target.value)}/></label>
       {!!mods.length&&<div className="stack"><strong>Adicionais</strong>{mods.map(m=><label className="field" key={m.id}><input type="checkbox" checked={selectedMods.includes(m.id)} onChange={e=>setSelectedMods(prev=>e.target.checked?[...prev,m.id]:prev.filter(x=>x!==m.id))}/>{m.name} · {money(m.priceCents)}</label>)}</div>}
       <label className="field">Observação<input value={note} maxLength="240" onChange={e=>setNote(e.target.value)}/></label>
       <button className="btn primary" disabled={!lineAllowed||!productId||busy}>Adicionar à comanda</button>
      </form>
      <p className="help">Pedidos já confirmados recebem novos tickets, desde que não tenham pagamentos parciais.</p>
     </Panel>
    </div>
    {lineAllowed&&<PizzaOrderPanel order={order} products={products} api={api} mode={mode} onAction={run} busy={busy}/>}
    {lineAllowed&&<WeighedOrderPanel order={order} products={products} api={api} mode={mode} onAction={run} busy={busy}/>}
    {isTable&&<TableQrPanel order={order} api={api} mode={mode} run={run} busy={busy} onError={setError}/>}
    <AdvancedOrderOperations order={order} tables={tables} api={api} mode={mode} onAction={run} busy={busy} canManage={canManage&&!order.payments?.length} canDiscount={mode==='live'&&!order.payments?.length}/>
    {isTable&&<Panel title="Transferir mesa">
      <div className="row wrap compact"><label className="field">Mesa de destino<select value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Selecionar mesa livre</option>{tables.filter(t=>!t.orderId&&t.id!==order.tableId).map(t=><option value={t.id} key={t.id}>{t.label}</option>)}</select></label>
       <button className="btn secondary" disabled={!lineAllowed||!destination||busy} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/transfer-table',{tableId:destination}).then(result=>{if(result)setDestination('')})}>Transferir comanda</button></div>
     </Panel>}
    {isTable&&<Panel title="Divisão da comanda por convidados">
      <p className="help">Distribua cada linha integralmente. Exemplo: Ana:1,Bruno:2. A divisão não duplica vendas nem gera pagamentos.</p>
      {(order.lines||[]).map(l=><label className="field" key={l.id}>{l.quantity} × {l.productName}<input value={alloc[l.id]??('Pessoa 1:'+l.quantity)} disabled={!lineAllowed||busy} onChange={e=>setAlloc(prev=>({...prev,[l.id]:e.target.value}))}/></label>)}
      <div className="row wrap compact">
       <button className="btn secondary" disabled={!lineAllowed||!order.lines?.length||busy} onClick={()=>{try{const allocations=(order.lines||[]).map(l=>({lineId:l.id,guests:asGuests(alloc[l.id]??('Pessoa 1:'+l.quantity),l.quantity)}));void run('/api/orders/'+encodeURIComponent(order.id)+'/split',{allocations});}catch(e){setError(e.message)}}}>Salvar divisão</button>
       <button className="btn secondary" disabled={!order?.id||mode!=='live'} onClick={()=>void api('/api/orders/'+encodeURIComponent(order.id)+'/split').then(x=>setSplits(x.split)).catch(e=>setError(e.message))}>Consultar divisão</button>
      </div>
      {splits&&<><p className="help">Alocação completa: {splits.fullyAssigned?'Sim':'Não'}</p>{(splits.guests||[]).map(g=><div className="list-row" key={g.guest}><span>{g.guest}</span><strong>{money(g.totalCents)}</strong></div>)}</>}
    </Panel>}
    {isTable&&<GuestPayments order={order} api={api} onAction={run} busy={busy} session={session} mode={mode}/>}
   </div>}
   {editing&&<LineEditDialog key={editing.id} line={editing} api={api} busy={busy} onClose={()=>setEditing(null)}
    onSave={changes=>run('/api/orders/'+encodeURIComponent(order.id)+'/lines/'+encodeURIComponent(editing.id)+'/edit',changes)}
    onCancel={details=>run('/api/orders/'+encodeURIComponent(order.id)+'/lines/'+encodeURIComponent(editing.id)+'/cancel',details)}/>}
 </div>;
}
