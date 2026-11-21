import React,{useCallback,useEffect,useState} from 'react';
import {formatMoney,parseMoney} from './model.mjs';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const uid=()=>crypto.randomUUID();
const Section=({title,children})=><section className="panel"><div className="sectiontitle"><h2>{title}</h2></div><div className="stack">{children}</div></section>;
const Name=({label,...p})=><label className="field">{label}<input {...p}/></label>;
const Select=({label,children,...p})=><label className="field">{label}<select {...p}>{children}</select></label>;
export function RestaurantGrowthPanel({api,mode,products,orders}){
 const [stations,setStations]=useState([]),[profiles,setProfiles]=useState([]),[pizza,setPizza]=useState({sizes:[],flavors:[],borders:[]});
 const [scale,setScale]=useState(null),[stationName,setStationName]=useState(''),[stationId,setStationId]=useState(''),[productId,setProductId]=useState('');
 const [profileLabel,setProfileLabel]=useState(''),[transport,setTransport]=useState('tcp'),[transportHost,setTransportHost]=useState(''),[transportPort,setTransportPort]=useState('9100'),[devicePath,setDevicePath]=useState(''),[baudRate,setBaudRate]=useState('9600');
 const [pizzaKind,setPizzaKind]=useState('sizes'),[pizzaName,setPizzaName]=useState(''),[pizzaPrice,setPizzaPrice]=useState('');
 const [scalePath,setScalePath]=useState(''),[scaleBrand,setScaleBrand]=useState('generic'),[scaleBaud,setScaleBaud]=useState('9600');
 const [refundOrderId,setRefundOrderId]=useState(''),[refundOrder,setRefundOrder]=useState(null),[refundLineId,setRefundLineId]=useState(''),[refundQty,setRefundQty]=useState('1'),[refundCash,setRefundCash]=useState('0,00'),[refundReason,setRefundReason]=useState(''),[refundExternal,setRefundExternal]=useState(false),[restock,setRestock]=useState(false);
 const [printOrderId,setPrintOrderId]=useState(''),[printType,setPrintType]=useState('prebill'),[printStation,setPrintStation]=useState(''),[printProfile,setPrintProfile]=useState('');
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const enabled=mode==='live';
 const load=useCallback(async()=>{
  if(!enabled)return;
  try{
   const [k,p,s,c]=await Promise.all([api('/api/kitchen/stations'),api('/api/print/profiles'),api('/api/pizza/catalog'),api('/api/hardware/scale/config')]);
   setStations(k.stations||[]);setProfiles(p.profiles||[]);setPizza(s);setScale(c.config);
  }catch(e){setError(e.message)}
 },[api,enabled]);
 useEffect(()=>{void load()},[load,revision]);
 useEffect(()=>{
  if(!enabled||!refundOrderId){setRefundOrder(null);return;}
  let alive=true;api('/api/orders/'+encodeURIComponent(refundOrderId)).then(x=>{if(alive){setRefundOrder(x.order);setRefundLineId(x.order?.lines?.[0]?.id||'')}}).catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false};
 },[api,enabled,refundOrderId]);
 const submit=async(path,data)=>{
  if(!enabled||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const result=await api(path,{method:'POST',body:{commandId:uid(),...data}});
   setNotice('Alteração confirmada no SQLite do host.');setRevision(i=>i+1);
   return result;
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <div className="page stack">
  <header className="pageheading"><div><p className="eyebrow">RESTAURANTE / EVOLUÇÃO P1–P2</p><h1>Produção e recursos comerciais</h1><p className="subtext">Configurações locais, auditadas e sem assinatura. Balanças e impressoras são opcionais.</p></div></header>
  {mode!=='live'&&<p className="errorbox">Conecte o servidor local com perfil supervisor para usar este painel.</p>}
  {error&&<p className="errorbox" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <div className="dashboard-grid">
   <Section title="Estações do KDS">
    <form className="row wrap" onSubmit={e=>{e.preventDefault();void submit('/api/kitchen/stations',{name:stationName}).then(x=>{if(x)setStationName('')})}}>
     <Name label="Nova estação" required maxLength="80" value={stationName} onChange={e=>setStationName(e.target.value)} placeholder="Bebidas"/>
     <button className="btn primary" disabled={!enabled||busy||!stationName.trim()}>Criar</button>
    </form>
    {stations.map(s=><div className="list-row" key={s.id}><strong>{s.name}</strong><small>{s.productIds?.length||0} produtos vinculados</small></div>)}
    <form className="form-grid" onSubmit={e=>{e.preventDefault();void submit('/api/kitchen/stations/'+encodeURIComponent(stationId)+'/products',{productId})}}>
     <Select label="Estação" required value={stationId} onChange={e=>setStationId(e.target.value)}><option value="">Selecione</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select>
     <Select label="Produto" required value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Selecione</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select>
     <button className="btn primary" disabled={!enabled||busy||!stationId||!productId}>Associar produto</button>
    </form>
    <p className="help">Produtos sem estação definida usam Cozinha. Os tickets preservam a estação escolhida no envio.</p>
   </Section>
   <Section title="Perfis de impressão">
    <form className="form-grid" onSubmit={e=>{e.preventDefault();const payload=transport==='tcp'?{label:profileLabel,transport,host:transportHost,port:Number(transportPort)}:{label:profileLabel,transport,devicePath,baudRate:Number(baudRate)};void submit('/api/print/profiles',payload).then(x=>{if(x)setProfileLabel('')})}}>
     <Name label="Nome do perfil" required value={profileLabel} maxLength="80" onChange={e=>setProfileLabel(e.target.value)} placeholder="Impressora da cozinha"/>
     <Select label="Transporte" value={transport} onChange={e=>setTransport(e.target.value)}><option value="tcp">ESC/POS TCP</option><option value="windows">Fila Windows RAW</option><option value="serial">Serial/COM</option></Select>
     {transport==='tcp'?<><Name label="IPv4 privado" required value={transportHost} onChange={e=>setTransportHost(e.target.value)} placeholder="192.168.1.20"/><Name label="Porta" type="number" min="1" max="65535" value={transportPort} onChange={e=>setTransportPort(e.target.value)}/></>:
      <><Name label="Porta ou fila" required value={devicePath} onChange={e=>setDevicePath(e.target.value)} placeholder="COM3 ou impressora Windows"/>{transport==='serial'&&<Select label="Baud rate" value={baudRate} onChange={e=>setBaudRate(e.target.value)}>{[9600,19200,38400,57600,115200].map(n=><option key={n}>{n}</option>)}</Select>}</>}
     <button className="btn primary" disabled={!enabled||busy||!profileLabel.trim()}>Salvar perfil</button>
    </form>
    {profiles.map(p=><div className="list-row" key={p.id}><span>{p.label} · {p.transport}</span><small>{p.enabled?'Habilitado':'Desativado'}</small></div>)}
    <div className="form-grid">{stations.map(s=><label className="field" key={s.id}>Impressora de {s.name}<select value={s.printProfileId||''} disabled={!enabled||busy} onChange={e=>void submit('/api/kitchen/stations/'+encodeURIComponent(s.id)+'/printer',{profileId:e.target.value||null})}>
     <option value="">Impressora padrão</option>{profiles.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</select></label>)}</div>
   </Section>
  </div>
  <div className="dashboard-grid">
   <Section title="Pizzaria: tamanhos, sabores e bordas">
    <div className="form-grid">
     <Select label="Cadastro" value={pizzaKind} onChange={e=>setPizzaKind(e.target.value)}><option value="sizes">Tamanho</option><option value="flavors">Sabor</option><option value="borders">Borda</option></Select>
     <Name label="Nome" maxLength="80" value={pizzaName} onChange={e=>setPizzaName(e.target.value)} placeholder="Grande, Calabresa..."/>
     <Name label={pizzaKind==='sizes'?'Base do tamanho (R$)':'Preço adicional (R$)'} value={pizzaPrice} onChange={e=>setPizzaPrice(e.target.value)} inputMode="decimal" placeholder="0,00"/>
     <button className="btn primary" disabled={!enabled||busy||!pizzaName.trim()||!pizzaPrice.trim()} onClick={()=>{try{const data=pizzaKind==='sizes'?{name:pizzaName,basePriceCents:parseMoney(pizzaPrice)}:{name:pizzaName,priceCents:parseMoney(pizzaPrice)};void submit('/api/pizza/'+pizzaKind,data).then(v=>{if(v){setPizzaName('');setPizzaPrice('')}});}catch(e){setError(e.message)}}}>Adicionar</button>
    </div>
    <div className="stack">{[['sizes','Tamanhos'],['flavors','Sabores'],['borders','Bordas']].map(([key,label])=><div key={key}><strong>{label}</strong>{(pizza[key]||[]).map(x=><div className="list-row" key={x.id}><span>{x.name}</span><strong>{money(x.priceCents??x.basePriceCents)}</strong></div>)}</div>)}</div>
    <p className="help">O preço é calculado na comanda; fichas técnicas dos sabores podem ser vinculadas pelo identificador de produto na API.</p>
   </Section>
   <Section title="Balança serial opcional">
    <p className="help">Captura estável pelo servidor local. Nenhum peso informado pelo navegador é aceito como leitura de hardware.</p>
    {scale&&<p className="notice">Configurada: {scale.devicePath} · {scale.brand} · {scale.baudRate} baud</p>}
    <form className="form-grid" onSubmit={e=>{e.preventDefault();void submit('/api/hardware/scale/config',{devicePath:scalePath,baudRate:Number(scaleBaud),brand:scaleBrand})}}>
     <Name label="Porta" required value={scalePath} onChange={e=>setScalePath(e.target.value)} placeholder="COM3, /dev/ttyUSB0"/>
     <Select label="Modelo" value={scaleBrand} onChange={e=>setScaleBrand(e.target.value)}><option value="generic">Protocolo genérico</option><option value="toledo">Toledo</option><option value="filizola">Filizola</option></Select>
     <Select label="Baud rate" value={scaleBaud} onChange={e=>setScaleBaud(e.target.value)}>{[9600,19200,38400,57600,115200].map(n=><option key={n}>{n}</option>)}</Select>
     <button className="btn primary" disabled={!enabled||busy||!scalePath}>Salvar configuração</button>
    </form>
   </Section>
  </div>
  <Section title="Devoluções por item e quantidade">
   <Select label="Venda concluída" value={refundOrderId} onChange={e=>setRefundOrderId(e.target.value)}><option value="">Selecione a venda</option>{orders.filter(o=>o.status==='CLOSED').map(o=><option key={o.id} value={o.id}>{o.id.slice(-8)} · {o.serviceMode}</option>)}</Select>
   {refundOrder&&<div className="form-grid">
    <Select label="Item devolvido" value={refundLineId} onChange={e=>setRefundLineId(e.target.value)}>{refundOrder.lines.map(l=><option key={l.id} value={l.id}>{l.quantity} × {l.productName} · {money(l.unitPriceCents)}</option>)}</Select>
    <Name label="Quantidade" type="number" min="1" value={refundQty} onChange={e=>setRefundQty(e.target.value)}/>
    <Name label="Dinheiro devolvido (R$)" value={refundCash} onChange={e=>setRefundCash(e.target.value)} placeholder="0,00"/>
    <Name label="Motivo" maxLength="240" value={refundReason} onChange={e=>setRefundReason(e.target.value)} required/>
    <label className="option-row"><input type="checkbox" checked={refundExternal} onChange={e=>setRefundExternal(e.target.checked)}/><span>Confirmei manualmente o estorno externo (Pix/cartão)</span></label>
    <label className="option-row"><input type="checkbox" checked={restock} onChange={e=>setRestock(e.target.checked)}/><span>Produto fisicamente retornou ao estoque (sem presumir lote)</span></label>
    <button className="btn primary" disabled={!enabled||busy||!refundReason.trim()} onClick={()=>{try{void submit('/api/orders/'+encodeURIComponent(refundOrder.id)+'/refund-items',{lineId:refundLineId,quantity:Number(refundQty),cashCents:parseMoney(refundCash),reason:refundReason,externalRefundConfirmed:refundExternal,returnToStock:restock}).then(v=>{if(v)setRefundReason('')})}catch(e){setError(e.message)}}}>Registrar devolução parcial</button>
   </div>}
  </Section>
  <Section title="Pré-conta e comprovantes operacionais">
   <div className="form-grid">
    <Select label="Pedido" value={printOrderId} onChange={e=>setPrintOrderId(e.target.value)}><option value="">Selecione</option>{orders.filter(o=>o.status!=='CANCELLED').map(o=><option key={o.id} value={o.id}>{o.id.slice(-8)} · {o.status}</option>)}</Select>
    <Select label="Comprovante" value={printType} onChange={e=>setPrintType(e.target.value)}><option value="prebill">Pré-conta</option><option value="kitchen">Cozinha</option><option value="close">Fechamento</option></Select>
    <Select label="Estação opcional" value={printStation} onChange={e=>setPrintStation(e.target.value)}><option value="">Todas</option>{stations.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select>
    <Select label="Perfil da impressora" value={printProfile} onChange={e=>setPrintProfile(e.target.value)}><option value="">Padrão</option>{profiles.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</Select>
    <button className="btn primary" disabled={!enabled||busy||!printOrderId} onClick={()=>void submit('/api/orders/'+encodeURIComponent(printOrderId)+'/print-requests',{type:printType,...(printStation?{stationId:printStation}:{}),...(printProfile?{profileId:printProfile}:{})})}>Adicionar à fila não fiscal</button>
   </div>
   <p className="help">Gerar a fila não confirma impressão física. O envio é feito na tela Impressão por um operador autorizado.</p>
  </Section>
 </div>;
}
