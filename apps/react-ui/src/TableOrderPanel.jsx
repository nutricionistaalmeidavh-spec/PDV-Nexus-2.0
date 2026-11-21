import React,{useEffect,useState} from 'react';
import {Badge,Button,Group,Paper,Text,ThemeIcon} from '@mantine/core';
import {ArrowLeft,CheckCircle2,ClipboardList,Plus,Users,ArrowRightLeft,Wallet} from 'lucide-react';
import {formatMoney} from './model.mjs';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const uuid=()=>crypto.randomUUID();
function Panel({title,children,icon:Icon=ClipboardList}){return <Paper component="section" withBorder radius="lg" p="lg" className="panel nexus-table-order-panel"><Group gap="sm" mb="md"><ThemeIcon color="orange" variant="light" radius="md"><Icon size={18}/></ThemeIcon><Text fw={800} size="lg" component="h2">{title}</Text></Group>{children}</Paper>}
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
export function TableOrderPanel({order,tables,products,api,mode,onUpdate,onBack,onCheckout,session}){
 const [productId,setProductId]=useState(''),[qty,setQty]=useState('1'),[note,setNote]=useState('');
 const [mods,setMods]=useState([]),[selectedMods,setSelectedMods]=useState([]);
 const [destination,setDestination]=useState('');
 const [alloc,setAlloc]=useState({}),[splits,setSplits]=useState(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
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
 const lineAllowed=order&&['DRAFT','OPEN'].includes(order.status);
 const canConfirm=order?.status==='DRAFT'&&order?.lines?.length>0;
 const canCheckout=order?.status==='OPEN'&&!!session;
 const safeProducts=products.filter(x=>x.active&&x.categoryActive!==0);
 const total=order?.totalCents??0;
 const isTable=order?.serviceMode==='table';
 return <div className="page nexus-restaurant nexus-table-order">
   <div className="pageheading"><div><p className="eyebrow">RESTAURANTE / COMANDA CANÔNICA</p><h1>{isTable?'Gerenciar mesa':'Gerenciar pedido'}</h1><p className="subtext">{order?.tableId?'Mesa vinculada':'Pedido'} · {order?.status||'Sem comanda'} · nenhuma operação é confirmada sem o host.</p></div><Button variant="default" leftSection={<ArrowLeft size={17}/>} onClick={onBack}>Voltar às mesas</Button></div>
   {error&&<p className="errorbox" role="alert">{error}</p>}
   {notice&&<p className="help" role="status">{notice}</p>}
   {!order?<Panel title="Selecione uma mesa">Abra uma comanda no mapa do salão.</Panel>:<div className="stack">
    <div className="dashboard-grid nexus-table-order-grid">
     <Panel title="Itens da comanda" icon={ClipboardList}>
      {(order.lines||[]).map(l=><div key={l.id} className="list-row"><span className="grow"><strong>{l.quantity} × {l.productName}</strong><small>{l.note||''}{l.modifiers?.length?' · '+l.modifiers.map(m=>m.name).join(', '):''}</small></span><strong>{money(l.quantity*l.unitPriceCents)}</strong></div>)}
      {!order.lines?.length&&<p className="help">Comanda vazia.</p>}
      <div className="total-hero nexus-table-total"><span>Total</span><strong>{money(total)}</strong></div>
      <div className="row wrap compact">
       {canConfirm&&<button className="btn primary" disabled={busy} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/confirm')}>Confirmar e enviar à cozinha</button>}
       {canCheckout&&<button className="btn primary" disabled={busy} onClick={()=>onCheckout(order)}>Finalizar venda</button>}
       {order.status==='OPEN'&&!session&&<p className="help">Abra o caixa para registrar o recebimento.</p>}
      </div>
     </Panel>
     <Panel title="Adicionar produtos" icon={Plus}>
      <form className="form-grid" onSubmit={e=>{e.preventDefault();const quantity=Number(qty);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100){setError('Quantidade inválida');return}void run('/api/orders/'+encodeURIComponent(order.id)+'/lines',{productId,quantity,modifierIds:selectedMods,note:note.trim()}).then(result=>{if(result){setQty('1');setNote('');setSelectedMods([]);}});}}>
       <label className="field">Produto<select value={productId} required onChange={e=>{setProductId(e.target.value);setSelectedMods([])}}><option value="">Selecionar</option>{safeProducts.map(p=><option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)}</option>)}</select></label>
       <label className="field">Quantidade<input type="number" required min="1" max="100" value={qty} onChange={e=>setQty(e.target.value)}/></label>
       {!!mods.length&&<div className="stack"><strong>Adicionais</strong>{mods.map(m=><label className="field" key={m.id}><input type="checkbox" checked={selectedMods.includes(m.id)} onChange={e=>setSelectedMods(prev=>e.target.checked?[...prev,m.id]:prev.filter(x=>x!==m.id))}/>{m.name} · {money(m.priceCents)}</label>)}</div>}
       <label className="field">Observação<input value={note} maxLength="240" onChange={e=>setNote(e.target.value)}/></label>
       <button className="btn primary" disabled={!lineAllowed||!productId||busy}>Adicionar à comanda</button>
      </form>
      <p className="help">Pedidos já confirmados podem receber itens adicionais: o KDS recebe tickets independentes.</p>
     </Panel>
    </div>
    {isTable&&<Panel title="Transferir mesa" icon={ArrowRightLeft}>
      <div className="row wrap compact"><label className="field">Mesa de destino<select value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Selecionar mesa livre</option>{tables.filter(t=>!t.orderId&&t.id!==order.tableId).map(t=><option value={t.id} key={t.id}>{t.label}</option>)}</select></label>
       <button className="btn secondary" disabled={!lineAllowed||!destination||busy} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/transfer-table',{tableId:destination}).then(result=>{if(result)setDestination('')})}>Transferir comanda</button></div>
     </Panel>}
    <Panel title="Divisão da comanda por convidados" icon={Users}>
      <p className="help">Distribua cada linha integralmente. Exemplo: Ana:1,Bruno:2. A divisão não duplica vendas nem gera pagamentos.</p>
      {(order.lines||[]).map(l=><label className="field" key={l.id}>{l.quantity} × {l.productName}<input value={alloc[l.id]??('Pessoa 1:'+l.quantity)} disabled={!lineAllowed||busy} onChange={e=>setAlloc(prev=>({...prev,[l.id]:e.target.value}))}/></label>)}
      <div className="row wrap compact">
       <button className="btn secondary" disabled={!lineAllowed||!order.lines?.length||busy} onClick={()=>{try{const allocations=(order.lines||[]).map(l=>({lineId:l.id,guests:asGuests(alloc[l.id]??('Pessoa 1:'+l.quantity),l.quantity)}));void run('/api/orders/'+encodeURIComponent(order.id)+'/split',{allocations});}catch(e){setError(e.message)}}}>Salvar divisão</button>
       <button className="btn secondary" disabled={!order?.id||mode!=='live'} onClick={()=>void api('/api/orders/'+encodeURIComponent(order.id)+'/split').then(x=>setSplits(x.split)).catch(e=>setError(e.message))}>Consultar divisão</button>
      </div>
      {splits&&<><p className="help">Alocação completa: {splits.fullyAssigned?'Sim':'Não'}</p>{(splits.guests||[]).map(g=><div className="list-row" key={g.guest}><span>{g.guest}</span><strong>{money(g.totalCents)}</strong></div>)}</>}
    </Panel>
   </div>}
 </div>;
}
