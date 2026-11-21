import React,{useEffect,useState} from 'react';
import {formatMoney} from './model.mjs';
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const milli=quantity=>(Number(quantity)/1000).toLocaleString('pt-BR',{maximumFractionDigits:3});
const numeric=(raw,factor,allowNegative=false)=>{const value=Number(raw);const scaled=Math.round(value*factor);if(!Number.isFinite(value)||!Number.isSafeInteger(scaled)||Math.abs(scaled-value*factor)>0.000001||(!allowNegative&&scaled<=0)||scaled===0)throw Error('Quantidade inválida');return scaled;};
const cents=raw=>{const v=Number(raw),scaled=Math.round(v*100);if(!Number.isSafeInteger(scaled)||scaled<0||Math.abs(scaled-v*100)>0.000001)throw Error('Custo inválido');return scaled;};
const uuid=()=>crypto.randomUUID();
const Item=({children})=><div className="list-row">{children}</div>;
const Section=({title,children})=><section className="panel"><div className="sectiontitle"><h2>{title}</h2></div>{children}</section>;
export function AdvancedStockPanel({mode,api,onChanged,reloadKey}){
 const [state,setState]=useState({pending:true}),[revision,setRevision]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [productId,setProductId]=useState(''),[ingredientId,setIngredientId]=useState(''),[recipe,setRecipe]=useState([]),[qty,setQty]=useState('0.200');
 const [batchIngredient,setBatchIngredient]=useState(''),[batches,setBatches]=useState({batches:[],untrackedMilli:0});
 const [histIngredient,setHistIngredient]=useState(''),[history,setHistory]=useState([]);
 useEffect(()=>{
  if(mode!=='live'){setState({offline:true});return;}
  let live=true;
  Promise.all(['/api/stock/ingredients','/api/products','/api/suppliers','/api/purchases','/api/reports/margin'].map(p=>api(p)))
   .then(([stock,products,suppliers,purchases,margin])=>{if(live)setState({stock,products,suppliers,purchases,margin})})
   .catch(e=>{if(live)setState({error:e.message})});
  return()=>{live=false;};
 },[api,mode,revision,reloadKey]);
 useEffect(()=>{
  if(!productId||mode!=='live'){setRecipe([]);return;}
  let live=true;
  api('/api/stock/recipes/'+encodeURIComponent(productId)).then(d=>{if(live)setRecipe(d.items||[])}).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false;};
 },[api,mode,productId,revision]);
 useEffect(()=>{
  if(!batchIngredient||mode!=='live'){setBatches({batches:[],untrackedMilli:0});return;}
  let live=true;api('/api/stock/batches?ingredientId='+encodeURIComponent(batchIngredient)).then(d=>{if(live)setBatches(d)}).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false;};
 },[api,mode,batchIngredient,revision]);
 useEffect(()=>{
  if(!histIngredient||mode!=='live'){setHistory([]);return;}
  let live=true;api('/api/stock/ingredients/'+encodeURIComponent(histIngredient)+'/movements').then(d=>{if(live)setHistory(d.movements||[])}).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false;};
 },[api,mode,histIngredient,revision]);
 const call=async(url,body={},method='POST')=>{if(busy||mode!=='live')return;setError('');setNotice('');setBusy(true);
  try{const response=await api(url,{method,body:{commandId:uuid(),...body}});setRevision(x=>x+1);onChanged?.();setNotice('Operação confirmada no banco local.');return response;}
  catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const ingredients=state.stock?.ingredients||[],products=(state.products?.products||[]).filter(p=>!p.isCombo),suppliers=state.suppliers?.suppliers||[];
 const submit=(event,fn)=>{event.preventDefault();try{fn(new FormData(event.currentTarget),event.currentTarget)}catch(e){setError(e.message)}};
 return <section className="stack">
  <div className="pageheading"><div><p className="eyebrow">ESTOQUE / OPERAÇÃO COMPLETA</p><h2>Lotes, fichas técnicas e movimentações</h2><p className="subtext">As entradas, receitas e ajustes são lançados diretamente no estoque canônico do host.</p></div></div>
  {error||state.error?<p className="errorbox" role="alert">{error||state.error}</p>:null}
  {notice&&<p className="help" role="status">{notice}</p>}
  {state.offline?<Section title="Host local necessário">Movimentações indisponíveis sem o host.</Section>:state.pending?<p>Carregando estoque...</p>:<>
  <Section title="Entrada de estoque e lotes FEFO">
   <form className="form-grid" onSubmit={e=>submit(e,(f,form)=>{
      const lotCode=String(f.get('lotCode')||'').trim(),expiryDate=String(f.get('expiryDate')||'');
      if(Boolean(lotCode)!==Boolean(expiryDate))throw Error('Informe lote e validade juntos');
      void call('/api/stock/ingredients/'+encodeURIComponent(f.get('ingredientId'))+'/receive',{
        quantityMilli:numeric(f.get('quantity'),1000),costCents:cents(f.get('cost')),
        ...(lotCode?{lotCode,expiryDate,...(f.get('supplierId')?{supplierId:f.get('supplierId')}:{})}:{})
      }).then(result=>{if(result)form.reset();});
   })}>
    <label className="field">Ingrediente<select name="ingredientId" required>{ingredients.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></label>
    <label className="field">Quantidade<input name="quantity" type="number" step="0.001" min="0.001" defaultValue="1" required/></label>
    <label className="field">Custo total (R$)<input name="cost" type="number" step="0.01" min="0" defaultValue="0" required/></label>
    <label className="field">Fornecedor<select name="supplierId"><option value="">Não informado</option>{suppliers.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="field">Lote<input name="lotCode" maxLength="64"/></label>
    <label className="field">Validade<input name="expiryDate" type="date"/></label>
    <button className="btn primary" disabled={busy||!ingredients.length}>Confirmar entrada</button>
   </form>
   <label className="field">Consultar lotes de um ingrediente<select value={batchIngredient} onChange={e=>setBatchIngredient(e.target.value)}><option value="">Selecionar</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
   {batches.batches?.map(b=><Item key={b.id||b.lotCode}><span>{b.lotCode} · {b.expiryDate}</span><strong>{milli(b.remainingMilli)} {ingredients.find(x=>x.id===batchIngredient)?.unit} {b.expiryDate<new Date().toISOString().slice(0,10)?'· VENCIDO':''}</strong></Item>)}
   {!!batchIngredient&&<p className="help">Saldo sem lote: {milli(batches.untrackedMilli??0)}.</p>}
  </Section>
  <Section title="Ajustes com justificativa obrigatória">
    <form className="form-grid" onSubmit={e=>submit(e,(f,form)=>{
      const quantityMilli=numeric(f.get('quantity'),1000,true);
      void call('/api/stock/ingredients/'+encodeURIComponent(f.get('ingredientId'))+'/adjust',{
        quantityMilli,...(quantityMilli>0?{costCents:cents(f.get('cost'))}:{}),reason:String(f.get('reason')||'').trim()
      }).then(result=>{if(result)form.reset();});
    })}>
     <label className="field">Ingrediente<select name="ingredientId" required>{ingredients.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
     <label className="field">Quantidade (+ entrada / - baixa)<input name="quantity" type="number" required step="0.001" defaultValue="-1"/></label>
     <label className="field">Custo total de entrada (R$)<input name="cost" type="number" step="0.01" min="0" defaultValue="0"/></label>
     <label className="field">Motivo<input name="reason" maxLength="240" required minLength="3" placeholder="Quebra, perda, inventário..."/></label>
     <button className="btn secondary" disabled={busy||!ingredients.length}>Registrar ajuste</button>
    </form>
  </Section>
  <Section title="Ficha técnica por produto">
   <label className="field">Produto<select aria-label="Produto" value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Selecionar produto</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   {recipe.map(item=><Item key={item.ingredientId}><span>{ingredients.find(i=>i.id===item.ingredientId)?.name||item.ingredientId} · {milli(item.quantityMilli)}</span><button className="btn secondary" onClick={()=>setRecipe(prev=>prev.filter(x=>x.ingredientId!==item.ingredientId))}>Remover</button></Item>)}
   <div className="row wrap compact">
     <label className="field">Ingrediente<select aria-label="Ingrediente" value={ingredientId} onChange={e=>setIngredientId(e.target.value)}><option value="">Selecionar</option>{ingredients.filter(i=>i.active).map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
     <label className="field">Quantidade por produto<input type="number" step="0.001" min="0.001" value={qty} onChange={e=>setQty(e.target.value)}/></label>
     {productId&&ingredientId&&<button className="btn secondary" type="button" onClick={()=>{try{const quantityMilli=numeric(qty,1000);setRecipe(prev=>[...prev.filter(i=>i.ingredientId!==ingredientId),{ingredientId,quantityMilli}]);}catch(e){setError(e.message)}}}>Adicionar ingrediente</button>}
     <button className="btn primary" disabled={busy||!productId} onClick={()=>void call('/api/stock/recipes/'+encodeURIComponent(productId),{items:recipe})}>Salvar ficha técnica</button>
   </div>
   <p className="help">A ficha do combo é a soma das fichas dos seus componentes; vendas existentes preservam seus snapshots.</p>
  </Section>
  <Section title="Movimentações auditadas">
   <label className="field">Ingrediente<select value={histIngredient} onChange={e=>setHistIngredient(e.target.value)}><option value="">Selecione</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
   <div className="tablewrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Quantidade</th><th>Saldo após</th><th>Justificativa</th></tr></thead><tbody>
    {history.slice(0,60).map(h=><tr key={h.id}><td>{h.createdAt?.slice(0,16)}</td><td>{h.kind}</td><td>{milli(h.quantityDeltaMilli)}</td><td>{milli(h.balanceAfterMilli)}</td><td>{h.reason||'—'}</td></tr>)}
   </tbody></table></div>
  </Section>
  <Section title="Fornecedores e compras pendentes">
    {suppliers.map(s=><Item key={s.id}><span className="grow"><strong>{s.name}</strong><small>{s.document||'Sem documento'}</small></span><button className="btn secondary" disabled={busy} onClick={()=>{const name=window.prompt('Nome do fornecedor',s.name);if(name?.trim()&&name.trim()!==s.name)void call('/api/suppliers/'+encodeURIComponent(s.id),{name:name.trim()},'PATCH');}}>Renomear</button><button className="btn secondary" disabled={busy} onClick={()=>void call('/api/suppliers/'+encodeURIComponent(s.id),{active:!s.active},'PATCH')}>{s.active?'Desativar':'Ativar'}</button></Item>)}
    {(state.purchases?.purchases||[]).filter(p=>p.status==='DRAFT').map(p=><Item key={p.id}><span className="grow"><strong>{p.supplierName}</strong><small>Compra pendente · {p.createdAt?.slice(0,10)}</small></span><button className="btn primary" disabled={busy} onClick={()=>{if(window.confirm('Confirmar recebimento físico desta compra?'))void call('/api/purchases/'+encodeURIComponent(p.id)+'/receive')}}>Receber</button><button className="btn secondary" disabled={busy} onClick={()=>{const reason=window.prompt('Motivo do cancelamento');if(reason?.trim())void call('/api/purchases/'+encodeURIComponent(p.id)+'/cancel',{reason:reason.trim()});}}>Cancelar</button></Item>)}
  </Section>
  <p className="help">Margem apurada: receita {money(state.margin?.netSalesCents)} · CMV {money(state.margin?.cogsCents)} · margem bruta {money(state.margin?.grossMarginCents)}.</p>
  </>}
 </section>;
}
