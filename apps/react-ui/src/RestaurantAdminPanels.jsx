import React,{useEffect,useState} from 'react';
import {formatMoney,parseMoney} from './model.mjs';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const uid=()=>crypto.randomUUID();
const Panel=({title,children})=><section className="panel"><div className="sectiontitle"><h2>{title}</h2></div>{children}</section>;
export function PizzeriaSettings({api,products,onRefresh,mode}){
 const pizzas=products.filter(x=>x.isPizza);
 const [productId,setProductId]=useState(''),[cfg,setCfg]=useState(null);
 const [name,setName]=useState(''),[optionName,setOptionName]=useState('');
 const [optionKind,setOptionKind]=useState('sizes'),[optionPrice,setOptionPrice]=useState('0,00');
 const [rule,setRule]=useState('MAX'),[maxFlavors,setMaxFlavors]=useState('2');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const enabled=mode==='live';
 const load=async id=>{
  if(!id){setCfg(null);return}
  const data=await api('/api/pizza/products/'+encodeURIComponent(id)+'/config');
  setCfg(data);
 };
 useEffect(()=>{if(!productId)return;let mounted=true;api('/api/pizza/products/'+encodeURIComponent(productId)+'/config').then(data=>{if(mounted)setCfg(data)}).catch(e=>{if(mounted)setError(e.message)});return()=>{mounted=false}},[api,productId]);
 const create=async e=>{
  e.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   const result=await api('/api/pizza/products',{method:'POST',body:{commandId:uid(),name,categoryId:'c-default'}});
   setName('');await onRefresh?.();setProductId(result.product.id);await load(result.product.id);setNotice('Pizza cadastrada');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const createOption=async e=>{
  e.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   const cents=parseMoney(optionPrice);
   const payload=optionKind==='sizes'?{name:optionName,basePriceCents:cents,pricingRule:rule,maxFlavors:Number(maxFlavors)}
    :optionKind==='flavors'?{name:optionName,additionalPriceCents:cents}:{name:optionName,priceCents:cents};
   await api('/api/pizza/products/'+encodeURIComponent(productId)+'/'+optionKind,{method:'POST',body:{commandId:uid(),...payload}});
   await load(productId);setOptionName('');setOptionPrice('0,00');setNotice('Opção de pizza adicionada');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <Panel title="Pizzaria — tamanhos, sabores e bordas">
  <p className="help">Regras de preço por tamanho: maior sabor, média dos sabores ou preço fixo. Todas as vendas guardam snapshots históricos.</p>
  <form className="row wrap" onSubmit={create}><label className="field grow">Nome da pizza<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
   <button className="btn primary" disabled={!enabled||busy||!name.trim()}>Criar pizza</button></form>
  <label className="field">Pizza em edição<select value={productId} onChange={e=>setProductId(e.target.value)}>
   <option value="">Selecione</option>{pizzas.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
  </select></label>
  {cfg&&<>
   <div className="row wrap">
    <span className="pill">Tamanhos: {cfg.sizes.length}</span><span className="pill">Sabores: {cfg.flavors.length}</span><span className="pill">Bordas: {cfg.borders.length}</span>
   </div>
   <form className="stack" onSubmit={createOption}>
    <label className="field">Nova opção<select value={optionKind} onChange={e=>setOptionKind(e.target.value)}>
     <option value="sizes">Tamanho</option><option value="flavors">Sabor</option><option value="borders">Borda</option>
    </select></label>
    <label className="field">Nome<input required maxLength={80} value={optionName} onChange={e=>setOptionName(e.target.value)}/></label>
    <label className="field">{optionKind==='sizes'?'Preço base do tamanho':optionKind==='flavors'?'Acréscimo do sabor':'Preço da borda'} (R$)
     <input required inputMode="decimal" value={optionPrice} onChange={e=>setOptionPrice(e.target.value)}/></label>
    {optionKind==='sizes'&&<div className="row wrap">
     <label className="field grow">Regra de preço<select value={rule} onChange={e=>setRule(e.target.value)}>
      <option value="MAX">Maior acréscimo</option><option value="AVERAGE">Média dos acréscimos</option><option value="FIXED">Preço fixo</option>
     </select></label><label className="field">Máximo de sabores<select value={maxFlavors} onChange={e=>setMaxFlavors(e.target.value)}>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label>
    </div>}
    <button className="btn primary" disabled={!enabled||busy||!optionName.trim()}>Adicionar {optionKind==='sizes'?'tamanho':optionKind==='flavors'?'sabor':'borda'}</button>
   </form>
   <div className="stack">
    {cfg.sizes.map(x=><div className="list-row" key={x.id}><strong>{x.name}</strong><small>{money(x.basePriceCents)} · {x.pricingRule} · até {x.maxFlavors} sabores</small></div>)}
    {cfg.flavors.map(x=><div className="list-row" key={x.id}><strong>{x.name}</strong><small>+ {money(x.additionalPriceCents)}</small></div>)}
    {cfg.borders.map(x=><div className="list-row" key={x.id}><strong>{x.name}</strong><small>+ {money(x.priceCents)}</small></div>)}
   </div>
  </>}
  {error&&<p className="errorbox" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 </Panel>;
}
export function KitchenStationsManager({api,products,onChanged,mode}){
 const [stations,setStations]=useState([]),[profiles,setProfiles]=useState([]),[name,setName]=useState('');
 const [productId,setProductId]=useState(''),[stationId,setStationId]=useState('');
 const [printerId,setPrinterId]=useState(''),[transport,setTransport]=useState('tcp'),[host,setHost]=useState(''),[port,setPort]=useState('9100'),
 [devicePath,setDevicePath]=useState(''),[baudRate,setBaudRate]=useState('9600');
 const [profileStation,setProfileStation]=useState(''),[profileSelected,setProfileSelected]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=async()=>{const [s,p]=await Promise.all([api('/api/kitchen/stations'),api('/api/printer/profiles')]);setStations(s.stations||[]);setProfiles(p.profiles||[])};
 useEffect(()=>{if(mode!=='live')return;let alive=true;Promise.all([api('/api/kitchen/stations'),api('/api/printer/profiles')]).then(([s,p])=>{if(alive){setStations(s.stations||[]);setProfiles(p.profiles||[])}}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[api,mode]);
 const run=async(route,body)=>{
  setBusy(true);setError('');setNotice('');
  try{await api(route,{method:'POST',body:{commandId:uid(),...body}});await refresh();onChanged?.();setNotice('Configuração salva no host')}
  catch(e){setError(e.message)}
  finally{setBusy(false)}
 };
 return <Panel title="Setores de cozinha e impressão">
  <p className="help">Roteamento pelo produto, com estação congelada no ticket. Impressoras TCP, serial ou fila Windows são opcionais.</p>
  <form className="row wrap" onSubmit={e=>{e.preventDefault();void run('/api/kitchen/stations',{name}).then(()=>setName(''))}}>
   <label className="field grow">Nova estação<input required value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="Cozinha, Bebidas…"/></label>
   <button className="btn primary" disabled={busy||mode!=='live'}>Criar estação</button>
  </form>
  {stations.map(s=><div className="list-row" key={s.id}><strong>{s.name}</strong><small>{s.activeTickets} tickets ativos · perfil {s.printerProfileId||'padrão'}</small></div>)}
  <form className="form-grid" onSubmit={e=>{e.preventDefault();void run('/api/products/'+encodeURIComponent(productId)+'/station',{stationId:stationId||null})}}>
   <label className="field">Produto<select required value={productId} onChange={e=>setProductId(e.target.value)}>
    <option value="">Selecione</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
   </select></label>
   <label className="field">Encaminhar para<select value={stationId} onChange={e=>setStationId(e.target.value)}>
    <option value="">Setor geral</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
   </select></label>
   <button className="btn secondary" disabled={!productId||busy||mode!=='live'}>Salvar estação do produto</button>
  </form>
  <details><summary>Perfis de impressoras por setor</summary>
   <form className="stack" onSubmit={e=>{e.preventDefault();void run('/api/printer/profiles',{
    id:printerId,transport,...(transport==='tcp'?{host,port:Number(port)}:{devicePath,...(transport==='serial'?{baudRate:Number(baudRate)}:{})})
   })}}>
    <label className="field">Código do perfil<input required pattern="[a-zA-Z0-9_-]{2,64}" value={printerId} onChange={e=>setPrinterId(e.target.value)} placeholder="cozinha-01"/></label>
    <label className="field">Conexão<select value={transport} onChange={e=>setTransport(e.target.value)}>
     <option value="tcp">TCP</option><option value="serial">USB serial/COM</option><option value="windows">Fila Windows RAW</option>
    </select></label>
    {transport==='tcp'?<div className="row wrap">
     <label className="field grow">IP privado<input value={host} onChange={e=>setHost(e.target.value)} placeholder="192.168.1.100"/></label>
     <label className="field">Porta<input type="number" min="1" max="65535" value={port} onChange={e=>setPort(e.target.value)}/></label>
    </div>:<label className="field">Dispositivo ou fila<input value={devicePath} onChange={e=>setDevicePath(e.target.value)} placeholder="COM3 ou Epson TM"/></label>}
    {transport==='serial'&&<label className="field">Baud rate<select value={baudRate} onChange={e=>setBaudRate(e.target.value)}>
     {[9600,19200,38400,57600,115200].map(x=><option key={x}>{x}</option>)}
    </select></label>}
    <button className="btn secondary" disabled={!printerId||busy||mode!=='live'}>Criar perfil</button>
   </form>
   <form className="form-grid" onSubmit={e=>{e.preventDefault();void run('/api/kitchen/stations/'+encodeURIComponent(profileStation)+'/profile',{profileId:profileSelected||null})}}>
    <label className="field">Estação<select required value={profileStation} onChange={e=>setProfileStation(e.target.value)}>
     <option value="">Selecione</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select></label>
    <label className="field">Perfil<select value={profileSelected} onChange={e=>setProfileSelected(e.target.value)}>
     <option value="">Padrão</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.id}</option>)}
    </select></label>
    <button className="btn secondary" disabled={!profileStation||busy||mode!=='live'}>Vincular impressora</button>
   </form>
  </details>
  {error&&<p className="errorbox" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
 </Panel>;
}
export function PartialRefundDialog({orderId,api,onClose,onDone}){
 const [order,setOrder]=useState(null),[refunded,setRefunded]=useState([]),[lineId,setLineId]=useState('');
 const [quantity,setQuantity]=useState('1'),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const refresh=async()=>{
  const [o,r]=await Promise.all([api('/api/orders/'+encodeURIComponent(orderId)),api('/api/orders/'+encodeURIComponent(orderId)+'/refund-items')]);
  setOrder(o.order);setRefunded(r.refunds||[]);
  setLineId(x=>o.order.lines.some(l=>l.id===x)?x:o.order.lines[0]?.id||'');
 };
 useEffect(()=>{let alive=true;Promise.all([api('/api/orders/'+encodeURIComponent(orderId)),api('/api/orders/'+encodeURIComponent(orderId)+'/refund-items')]).then(([o,r])=>{if(alive){setOrder(o.order);setRefunded(r.refunds||[]);setLineId(o.order.lines[0]?.id||'')}}).catch(e=>{if(alive)setError(e.message)});return()=>{alive=false}},[api,orderId]);
 const line=order?.lines.find(l=>l.id===lineId);
 const used=refunded.filter(r=>r.lineId===lineId).reduce((n,r)=>n+r.quantity,0);
 const max=Math.max(0,(line?.quantity||0)-used);
 const submit=async e=>{
  e.preventDefault();setError('');setSuccess('');setBusy(true);
  try{
   const qty=Number(quantity);
   if(!Number.isSafeInteger(qty)||qty<1||qty>max)throw Error('Quantidade fora do saldo devolvível');
   const result=await api('/api/orders/'+encodeURIComponent(orderId)+'/refund-items',{method:'POST',body:{
    commandId:uid(),lineId,quantity:qty,reason,externalRefundConfirmed:confirmed,restock:false
   }});
   setSuccess('Estorno auditado: '+money(result.refundedCents)+'. Estoque não reintegrado automaticamente.');
   await refresh();onDone?.();
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Devolução de itens">
   <header className="modal-head"><h2>Devolução por item</h2><button className="btn icon" onClick={onClose} aria-label="Fechar">×</button></header>
   <div className="modal-content stack">
    <p className="help">Devolução financeira em centavos, preservando a venda original. Se houver Pix ou cartão, confirme o estorno externo antes de registrar.</p>
    {order&&<form className="stack" onSubmit={submit}>
     <label className="field">Item<select value={lineId} onChange={e=>{setLineId(e.target.value);setQuantity('1')}} required>
      {order.lines.map(l=><option key={l.id} value={l.id}>{l.productName} · {l.quantity} un. · {money(l.unitPriceCents)}/un.</option>)}
     </select></label>
     <p className="help">Disponível para devolução: {max} unidade(s)</p>
     <label className="field">Quantidade<input type="number" min="1" max={max} value={quantity} onChange={e=>setQuantity(e.target.value)} required/></label>
     <label className="field">Motivo<input required maxLength={240} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <label className="option-row"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
      <span>Já confirmei manualmente qualquer estorno Pix/cartão exigido</span></label>
     <div className="total-row"><span>Valor deste estorno</span><strong>{money((line?.unitPriceCents||0)*Number(quantity||0))}</strong></div>
     <button className="btn primary" disabled={busy||!max||!reason.trim()}>Registrar devolução auditada</button>
    </form>}
    {error&&<p className="errorbox" role="alert">{error}</p>}{success&&<p className="notice" role="status">{success}</p>}
   </div>
  </section>
 </div>;
}
