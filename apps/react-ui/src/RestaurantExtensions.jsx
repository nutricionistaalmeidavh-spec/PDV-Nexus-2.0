import React,{useEffect,useState} from 'react';
import {formatMoney,parseMoney} from './model.mjs';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const C=({title,children})=><section className="panel"><div className="sectiontitle"><h2>{title}</h2></div>{children}</section>;
const empty='Selecione uma opção para continuar.';
export function GuestPayments({order,api,onAction,busy,session,mode}){
 const [summary,setSummary]=useState(null),[guest,setGuest]=useState(''),[method,setMethod]=useState('cash');
 const [amount,setAmount]=useState(''),[tendered,setTendered]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  if(!order?.id||mode==='demo')return;
  let active=true;
  api('/api/orders/'+encodeURIComponent(order.id)+'/payments/partial')
   .then(x=>{if(active){setSummary(x);setGuest(g=>x.guests?.some(v=>v.guest===g)?g:x.guests?.[0]?.guest||'')}})
   .catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[order?.id,order?.revision,api,mode]);
 if(order?.serviceMode!=='table'||!['OPEN','CLOSED'].includes(order.status))return null;
 const current=summary?.guests?.find(x=>x.guest===guest);
 const available=Math.max(0,(current?.totalCents||0)-(current?.paidCents||0));
 const send=async e=>{
  e.preventDefault();setError('');
  try{
   const amountCents=amount.trim()?parseMoney(amount):available;
   const tenderedCents=method==='cash'?(tendered.trim()?parseMoney(tendered):amountCents):undefined;
   if(!amountCents||amountCents>available)throw Error('Informe valor dentro do saldo do convidado');
   if(tenderedCents!==undefined&&tenderedCents<amountCents)throw Error('Valor recebido em dinheiro inferior à cobrança');
   const payment={method,amountCents,...(method==='cash'?{tenderedCents}:{})};
   const result=await onAction('/api/orders/'+encodeURIComponent(order.id)+'/payments/partial',{guest,payments:[payment]});
   if(result){setAmount('');setTendered('');setSummary(s=>s?{...s,remainingCents:result.remainingCents}:s)}
  }catch(e){setError(e.message)}
 };
 return <C title="Recebimentos independentes por convidado">
  <p className="help">A divisão precisa estar completa antes do primeiro pagamento. Saldos são calculados pelo host e não podem ser cobrados em duplicidade.</p>
  <div className="total-row"><span>Saldo da comanda</span><strong>{money(summary?.remainingCents??order.totalCents)}</strong></div>
  {(summary?.guests||[]).map(x=><div className="list-row" key={x.guest}>
   <span>{x.guest}</span><span>{money(x.paidCents)} recebido / {money(x.totalCents)}</span>
  </div>)}
  {order.status==='OPEN'&&<form className="form-grid" onSubmit={send}>
   <label className="field">Convidado<select required value={guest} onChange={e=>{setGuest(e.target.value);setAmount('')}}>
    {(summary?.guests||[]).map(g=><option key={g.guest} value={g.guest}>{g.guest} · saldo {money(g.totalCents-g.paidCents)}</option>)}
   </select></label>
   <label className="field">Valor a receber (R$)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder={String(available/100).replace('.',',')}/></label>
   <label className="field">Forma<select value={method} onChange={e=>setMethod(e.target.value)}>
    <option value="cash">Dinheiro</option><option value="pix">Pix (confirmado manualmente)</option>
    <option value="credit">Crédito (manual)</option><option value="debit">Débito (manual)</option><option value="other">Outro</option>
   </select></label>
   {method==='cash'&&<label className="field">Dinheiro entregue (R$)<input inputMode="decimal" value={tendered} onChange={e=>setTendered(e.target.value)} placeholder="Igual ao valor devido"/></label>}
   <button type="submit" className="btn primary" disabled={busy||!session||!current||!available||mode==='demo'}>Registrar pagamento do convidado</button>
  </form>}
  {order.status==='CLOSED'&&<p className="notice">Conta integralmente recebida e encerrada.</p>}
  {!session&&order.status==='OPEN'&&<p className="help">Abra o caixa antes de receber.</p>}
  {error&&<p className="errorbox" role="alert">{error}</p>}
 </C>;
}
export function PizzaOrderPanel({order,products,api,onAction,busy,mode}){
 const pizzas=products.filter(p=>p.isPizza&&p.active);
 const [productId,setProductId]=useState(''),[config,setConfig]=useState(null);
 const [sizeId,setSizeId]=useState(''),[flavorIds,setFlavorIds]=useState([]),[borderId,setBorderId]=useState('');
 const [quantity,setQuantity]=useState('1'),[note,setNote]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  if(!productId||mode==='demo'){setConfig(null);return}
  let active=true;
  api('/api/pizza/products/'+encodeURIComponent(productId)+'/config').then(x=>{
   if(active){setConfig(x);setSizeId(x.sizes.find(s=>s.active)?.id||'');setFlavorIds([]);setBorderId('')}
  }).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[productId,api,mode]);
 if(!pizzas.length)return null;
 const size=config?.sizes.find(x=>x.id===sizeId);
 const availableFlavors=config?.flavors.filter(x=>x.active)||[];
 const selected=availableFlavors.filter(x=>flavorIds.includes(x.id));
 const border=config?.borders.find(b=>b.id===borderId);
 const surcharge=size?.pricingRule==='MAX'?Math.max(0,...selected.map(x=>x.additionalPriceCents)):
   size?.pricingRule==='AVERAGE'&&selected.length?Math.round(selected.reduce((n,x)=>n+x.additionalPriceCents,0)/selected.length):0;
 const estimate=(size?.basePriceCents||0)+surcharge+(border?.priceCents||0);
 const submit=async e=>{
  e.preventDefault();setError('');
  const qty=Number(quantity);
  if(!Number.isSafeInteger(qty)||qty<1||qty>30)return setError('Quantidade inválida');
  if(!flavorIds.length||!sizeId)return setError('Selecione tamanho e sabores');
  if(flavorIds.length>(size?.maxFlavors||1))return setError('Quantidade de sabores acima do limite');
  const result=await onAction('/api/orders/'+encodeURIComponent(order.id)+'/pizza-lines',{
   productId,sizeId,flavorIds,borderId:borderId||null,quantity:qty,note:note.trim()
  });
  if(result){setQuantity('1');setNote('');setFlavorIds([]);setBorderId('')}
 };
 return <C title="Pedido de pizzaria — sabores e frações">
  <p className="help">Preço da pizza definido pela regra do tamanho; sabores e bordas são registrados em snapshots para a cozinha.</p>
  <form onSubmit={submit} className="stack">
   <label className="field">Pizza<select value={productId} onChange={e=>setProductId(e.target.value)} required>
    <option value="">Selecione a pizza</option>{pizzas.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
   </select></label>
   {config&&<>
    <label className="field">Tamanho<select required value={sizeId} onChange={e=>{setSizeId(e.target.value);setFlavorIds([])}}>
     {config.sizes.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name} · {money(s.basePriceCents)}</option>)}
    </select></label>
    <fieldset className="stack"><legend>Sabores ({selected.length}/{size?.maxFlavors||1})</legend>
     {availableFlavors.map(f=><label className="option-row" key={f.id}><input type="checkbox"
      checked={flavorIds.includes(f.id)} disabled={!flavorIds.includes(f.id)&&selected.length>=(size?.maxFlavors||1)}
      onChange={e=>setFlavorIds(x=>e.target.checked?[...x,f.id]:x.filter(id=>id!==f.id))}/>
      <span>{f.name}</span><strong>+ {money(f.additionalPriceCents)}</strong></label>)}
    </fieldset>
    <label className="field">Borda<select value={borderId} onChange={e=>setBorderId(e.target.value)}>
     <option value="">Sem borda</option>{config.borders.filter(b=>b.active).map(b=><option key={b.id} value={b.id}>{b.name} · {money(b.priceCents)}</option>)}
    </select></label>
    <label className="field">Quantidade<input type="number" min="1" max="30" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label className="field">Observação<input value={note} maxLength={240} onChange={e=>setNote(e.target.value)}/></label>
    <div className="total-row"><span>Preço estimado por pizza</span><strong>{money(estimate)}</strong></div>
    <button className="btn primary" disabled={busy||!sizeId||!flavorIds.length||mode==='demo'}>Adicionar pizza à comanda</button>
   </>}
  </form>
  {error&&<p role="alert" className="errorbox">{error}</p>}
 </C>;
}
export function WeighedOrderPanel({order,products,api,onAction,busy,mode}){
 const weighed=products.filter(p=>p.active&&p.saleUnit==='kg');
 const [productId,setProductId]=useState(''),[grams,setGrams]=useState(''),[devicePath,setDevicePath]=useState(''),
 [baudRate,setBaudRate]=useState('9600'),[brand,setBrand]=useState('generic'),[reading,setReading]=useState(null),
 [manual,setManual]=useState(false),[error,setError]=useState('');
 if(!weighed.length)return null;
 const product=weighed.find(p=>p.id===productId);
 const estimate=product&&Number.isSafeInteger(Number(grams))&&Number(grams)>0?Math.round(product.priceCents*Number(grams)/1000):0;
 const capture=async()=>{
  setError('');setReading(null);
  try{
   const result=await api('/api/hardware/scale/capture',{method:'POST',body:{devicePath,baudRate:Number(baudRate),brand}});
   setReading(result);setGrams(String(result.weightGrams));setManual(false);
  }catch(e){setError(e.message)}
 };
 const submit=async e=>{
  e.preventDefault();setError('');
  const gramsNumber=Number(grams);
  if(!Number.isSafeInteger(gramsNumber)||gramsNumber<1||gramsNumber>100000)return setError('Peso entre 1g e 100kg');
  if(!reading&&!manual)return setError('Capture uma leitura estável ou confirme o peso manual como supervisor');
  if(reading&&reading.weightGrams!==gramsNumber)return setError('Não altere o peso da leitura serial; capture novamente');
  const args=reading?{measurementId:reading.measurementId}:
    {weightGrams:gramsNumber,manualConfirmed:true,stable:true};
  const result=await onAction('/api/orders/'+encodeURIComponent(order.id)+'/weight-lines',{productId,...args});
  if(result){setReading(null);setGrams('');setManual(false)}
 };
 return <C title="Venda por quilo — balança">
  <form className="stack" onSubmit={submit}>
   <label className="field">Produto por kg<select required value={productId} onChange={e=>{setProductId(e.target.value);setReading(null)}}>
    <option value="">Selecionar produto</option>{weighed.map(p=><option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)}/kg</option>)}
   </select></label>
   <div className="form-grid">
    <label className="field">Porta serial<input value={devicePath} onChange={e=>setDevicePath(e.target.value)} placeholder="COM3 ou /dev/ttyUSB0"/></label>
    <label className="field">Baud<select value={baudRate} onChange={e=>setBaudRate(e.target.value)}>{[9600,19200,38400,57600,115200].map(x=><option key={x}>{x}</option>)}</select></label>
    <label className="field">Protocolo<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="generic">Genérico</option><option value="toledo">Toledo</option><option value="filizola">Filizola</option></select></label>
   </div>
   <button type="button" className="btn secondary" onClick={()=>void capture()} disabled={!devicePath||busy||mode==='demo'}>Capturar peso estável da balança</button>
   <label className="field">Peso em gramas<input required inputMode="numeric" type="number" min="1" max="100000" value={grams} readOnly={!!reading} onChange={e=>setGrams(e.target.value)}/></label>
   <label className="option-row"><input type="checkbox" checked={manual} disabled={!!reading} onChange={e=>setManual(e.target.checked)}/>
    <span>Entrada manual confirmada pelo supervisor (sem balança conectada)</span></label>
   {reading&&<p className="notice">Leitura estável: {reading.weightGrams} g. Validade: 60 segundos.</p>}
   <div className="total-row"><span>Preço estimado</span><strong>{money(estimate)}</strong></div>
   <button className="btn primary" disabled={!product||!grams||(!reading&&!manual)||busy||mode==='demo'}>Adicionar item pesado</button>
  </form>
  <p className="help">Sem leitura estável, a venda automática é bloqueada. Driver serial é opcional, instalado somente no host. O equipamento exige homologação física.</p>
  {error&&<p role="alert" className="errorbox">{error}</p>}
 </C>;
}
