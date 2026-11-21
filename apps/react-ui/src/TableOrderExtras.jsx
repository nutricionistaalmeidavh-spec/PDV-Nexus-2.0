import React,{useEffect,useState} from 'react';
import {formatMoney,parseMoney} from './model.mjs';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const Panel=({title,children})=><section className="panel"><div className="sectiontitle"><h2>{title}</h2></div><div className="stack">{children}</div></section>;
const Label=({title,children})=><label className="field">{title}{children}</label>;
export function SettlementPanel({order,api,run,session,busy,mode}){
 const [settlement,setSettlement]=useState(null);
 const [guest,setGuest]=useState(''),[method,setMethod]=useState('cash'),[amount,setAmount]=useState(''),[tendered,setTendered]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!order||!['live','paired'].includes(mode)){setSettlement(null);return;}
  let alive=true;api('/api/orders/'+encodeURIComponent(order.id)+'/settlement')
   .then(data=>{if(alive)setSettlement(data.settlement)})
   .catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false};
 },[api,order?.id,order?.revision,mode]);
 const pay=async()=>{
  try{
   const cents=parseMoney(amount);
   if(cents<1)throw Error('Informe um pagamento maior que zero');
   const payload={guest:guest||undefined,method,amountCents:cents};
   if(method==='cash')payload.tenderedCents=tendered?parseMoney(tendered):cents;
   const result=await run('/api/orders/'+encodeURIComponent(order.id)+'/payments',payload);
   if(result){setAmount('');setTendered('');setError('')}
  }catch(e){setError(e.message)}
 };
 if(order?.status!=='OPEN')return null;
 return <Panel title="Recebimentos parciais por convidado">
  {error&&<p className="errorbox" role="alert">{error}</p>}
  {settlement?<><div className="total-hero"><span>Saldo a receber</span><strong>{money(settlement.balanceCents)}</strong></div>
  <div className="list-row"><span>Já recebido</span><strong>{money(settlement.paidCents)}</strong></div>
  {settlement.guests.map(g=><div className="list-row" key={g.guest}>
   <span>{g.guest} · recebido {money(g.paidCents)}</span><strong>{money(g.balanceCents)} restante</strong>
  </div>)}
  {settlement.balanceCents>0&&<div className="form-grid">
   {settlement.guests.length>0&&<Label title="Convidado"><select value={guest} onChange={e=>setGuest(e.target.value)}>
    <option value="">Selecione o convidado</option>{settlement.guests.filter(g=>g.balanceCents>0).map(g=><option key={g.guest} value={g.guest}>{g.guest} · {money(g.balanceCents)}</option>)}
   </select></Label>}
   <Label title="Pagamento"><select value={method} onChange={e=>setMethod(e.target.value)}><option value="cash">Dinheiro</option><option value="pix">Pix manual</option><option value="credit">Crédito manual</option><option value="debit">Débito manual</option><option value="other">Outro</option></select></Label>
   <Label title="Valor a receber (R$)"><input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0,00"/></Label>
   {method==='cash'&&<Label title="Dinheiro entregue (R$)"><input inputMode="decimal" value={tendered} onChange={e=>setTendered(e.target.value)} placeholder="Igual ao valor recebido"/></Label>}
   <button className="btn primary" disabled={!session||busy||!amount||settlement.guests.length>0&&!guest} onClick={()=>void pay()}>Registrar pagamento confirmado</button>
  </div>}
  {settlement.balanceCents===0&&<button className="btn primary" disabled={!session||busy} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/close',{payments:[]})}>Fechar comanda totalmente paga</button>}
  </>:<p className="help">Carregando valores confirmados pelo host…</p>}
  <p className="help">Cada recebimento possui identificador próprio e não é duplicado na finalização. Pix/cartão são confirmados manualmente.</p>
 </Panel>;
}
export function PizzaComposer({order,api,products,run,busy,mode}){
 const [catalog,setCatalog]=useState({sizes:[],flavors:[],borders:[]});
 const [template,setTemplate]=useState(''),[size,setSize]=useState(''),[flavors,setFlavors]=useState([]),[border,setBorder]=useState(''),[rule,setRule]=useState('highest'),[fixed,setFixed]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  if(!['live','paired'].includes(mode))return;
  let alive=true;api('/api/pizza/catalog').then(x=>{if(alive)setCatalog(x)}).catch(e=>{if(alive)setError(e.message)});
  return()=>{alive=false};
 },[api,mode]);
 if(!order||!['DRAFT','OPEN'].includes(order.status))return null;
 const add=async()=>{
  try{
   const payload={templateProductId:template,sizeId:size,flavorIds:flavors,borderId:border||undefined,priceRule:rule,quantity:1,note};
   if(rule==='fixed')payload.fixedPriceCents=parseMoney(fixed);
   const result=await run('/api/orders/'+encodeURIComponent(order.id)+'/pizzas',payload);
   if(result){setFlavors([]);setBorder('');setNote('');setError('')}
  }catch(e){setError(e.message)}
 };
 return <Panel title="Montar pizza fracionada">
  <p className="help">Selecione até quatro sabores. Preço por maior sabor ou média proporcional, acrescido da base de tamanho e borda.</p>
  {error&&<p className="errorbox" role="alert">{error}</p>}
  <div className="form-grid">
   <Label title="Produto base da pizza"><select value={template} onChange={e=>setTemplate(e.target.value)}><option value="">Selecione</option>{products.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Label>
   <Label title="Tamanho"><select value={size} onChange={e=>setSize(e.target.value)}><option value="">Selecione</option>{catalog.sizes.filter(x=>x.active).map(x=><option value={x.id} key={x.id}>{x.name} · {money(x.basePriceCents)}</option>)}</select></Label>
   <Label title="Borda"><select value={border} onChange={e=>setBorder(e.target.value)}><option value="">Sem borda</option>{catalog.borders.filter(x=>x.active).map(x=><option value={x.id} key={x.id}>{x.name} · {money(x.priceCents)}</option>)}</select></Label>
   <Label title="Regra de preço"><select value={rule} onChange={e=>setRule(e.target.value)}><option value="highest">Maior sabor</option><option value="proportional">Média proporcional</option><option value="fixed">Preço fixo supervisor</option></select></Label>
   {rule==='fixed'&&<Label title="Preço dos sabores (R$)"><input value={fixed} onChange={e=>setFixed(e.target.value)} inputMode="decimal"/></Label>}
  </div>
  <strong>Sabores ({flavors.length}/4)</strong><div className="form-grid">{catalog.flavors.filter(x=>x.active).map(x=><label className="option-row" key={x.id}>
   <input type="checkbox" checked={flavors.includes(x.id)} disabled={!flavors.includes(x.id)&&flavors.length>=4} onChange={e=>setFlavors(v=>e.target.checked?[...v,x.id]:v.filter(id=>id!==x.id))}/>
   <span>{x.name}</span><strong>{money(x.priceCents)}</strong></label>)}</div>
  <Label title="Observação"><input maxLength="240" value={note} onChange={e=>setNote(e.target.value)}/></Label>
  <button className="btn primary" disabled={busy||!template||!size||!flavors.length} onClick={()=>void add()}>Adicionar pizza à comanda</button>
 </Panel>;
}
export function ScaleSalePanel({order,api,products,run,busy,mode}){
 const [product,setProduct]=useState(''),[reading,setReading]=useState(null),[error,setError]=useState(''),[captureBusy,setCaptureBusy]=useState(false);
 const capture=async()=>{
  setCaptureBusy(true);setError('');
  try{const x=await api('/api/hardware/scale/capture',{method:'POST',body:{commandId:crypto.randomUUID()}});
   setReading(x);
  }catch(e){setReading(null);setError(e.message)}finally{setCaptureBusy(false)}
 };
 if(!order||!['DRAFT','OPEN'].includes(order.status))return null;
 return <Panel title="Venda por peso · balança local">
  <p className="help">O host lê duas medições estáveis iguais pela porta serial. A leitura vale por 30 segundos e só pode ser usada uma vez.</p>
  {error&&<p className="errorbox" role="alert">{error}</p>}
  <Label title="Produto vendido por kg"><select value={product} onChange={e=>setProduct(e.target.value)}><option value="">Selecione</option>{products.filter(p=>p.active&&p.saleUnit==='kg').map(p=><option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)} / kg</option>)}</select></Label>
  <button type="button" className="btn secondary" onClick={()=>void capture()} disabled={captureBusy||busy||!['live','paired'].includes(mode)}>{captureBusy?'Lendo equipamento…':'Capturar peso da balança'}</button>
  {reading&&<><p className="notice">Peso estável: {(reading.weightGrams/1000).toFixed(3)} kg · expira às {new Date(reading.expiresAt).toLocaleTimeString('pt-BR')}</p>
   <button className="btn primary" disabled={busy||!product} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/weighted-lines',{productId:product,readingId:reading.readingId}).then(x=>{if(x)setReading(null)})}>Adicionar item pesado</button></>}
 </Panel>;
}
export function AdvancedCounterPanel({order,api,tables,run,busy}){
 const [source,setSource]=useState(''),[lineId,setLineId]=useState(''),[price,setPrice]=useState(''),[discount,setDiscount]=useState(''),[reason,setReason]=useState('');
 const [printType,setPrintType]=useState('prebill'),[error,setError]=useState('');
 if(!order||!['DRAFT','OPEN'].includes(order.status))return null;
 const adjust=async(kind)=>{
  try{
   if(!reason.trim())throw Error('Informe o motivo da alteração');
   const payload={lineId,reason};
   if(kind==='discounts')payload.discountCents=parseMoney(discount);
   else payload.priceCents=parseMoney(price);
   const x=await run('/api/orders/'+encodeURIComponent(order.id)+'/'+kind,payload);
   if(x){setReason('');setPrice('');setDiscount('');setError('')}
  }catch(e){setError(e.message)}
 };
 const merge=async()=>{
  try{
   const remote=await api('/api/orders/'+encodeURIComponent(source));
   const res=await run('/api/orders/'+encodeURIComponent(order.id)+'/merge',{
    sourceOrderId:source,expectedSourceRevision:remote.order.revision
   });
   if(res)setSource('');
  }catch(e){setError(e.message)}
 };
 return <Panel title="Operação avançada do balcão">
  {error&&<p className="errorbox" role="alert">{error}</p>}
  <div className="row wrap"><button className="btn secondary" disabled={busy} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/'+(order.suspendedAt?'resume':'suspend'))}>{order.suspendedAt?'Retomar venda':'Suspender venda'}</button>
   <span className="help">{order.suspendedAt?'Venda suspensa, sem alterações até ser retomada.':'Dados salvos no host local.'}</span></div>
  <div className="form-grid">
   <Label title="Linha para preço/desconto"><select value={lineId} onChange={e=>setLineId(e.target.value)}><option value="">Selecione</option>{order.lines.map(l=><option key={l.id} value={l.id}>{l.productName} · {money(l.unitPriceCents)}</option>)}</select></Label>
   <Label title="Preço autorizado (R$)"><input inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></Label>
   <Label title="Desconto por unidade (R$)"><input inputMode="decimal" value={discount} onChange={e=>setDiscount(e.target.value)}/></Label>
   <Label title="Motivo obrigatório"><input maxLength="240" value={reason} onChange={e=>setReason(e.target.value)}/></Label>
   <button className="btn secondary" disabled={busy||!lineId||!reason.trim()||!price} onClick={()=>void adjust('price-adjustments')}>Alterar preço</button>
   <button className="btn secondary" disabled={busy||!lineId||!reason.trim()||!discount} onClick={()=>void adjust('discounts')}>Aplicar desconto</button>
  </div>
  {order.tableId&&<div className="row wrap">
   <Label title="Juntar outra comanda nesta mesa"><select value={source} onChange={e=>setSource(e.target.value)}><option value="">Selecione origem</option>{tables.filter(t=>t.orderId&&t.orderId!==order.id).map(t=><option value={t.orderId} key={t.id}>{t.label}</option>)}</select></Label>
   <button className="btn primary" disabled={busy||!source} onClick={()=>void merge()}>Juntar mesas sem duplicar itens</button>
  </div>}
  <div className="row wrap">
   <Label title="Comprovante não fiscal"><select value={printType} onChange={e=>setPrintType(e.target.value)}><option value="prebill">Pré-conta</option><option value="kitchen">Cozinha</option></select></Label>
   <button className="btn secondary" disabled={busy} onClick={()=>void run('/api/orders/'+encodeURIComponent(order.id)+'/print-requests',{type:printType})}>Gerar comprovante</button>
  </div>
 </Panel>;
}
