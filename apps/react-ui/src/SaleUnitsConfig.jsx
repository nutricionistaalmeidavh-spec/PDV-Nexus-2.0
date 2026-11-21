import React,{useState} from 'react';
export function SaleUnitsConfig({api,products,mode,onChanged}){
 const [productId,setProductId]=useState('');
 const [unit,setUnit]=useState('kg');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState(''),[error,setError]=useState('');
 const chosen=products.find(p=>p.id===productId);
 const save=async(e)=>{
  e.preventDefault();setBusy(true);setError('');setNotice('');
  try{
   await api('/api/products/'+encodeURIComponent(productId)+'/sale-unit',
     {method:'POST',body:{commandId:crypto.randomUUID(),saleUnit:unit}});
   await onChanged?.();
   setNotice('Unidade de venda atualizada no catálogo canônico.');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <section className="panel"><div className="sectiontitle"><h2>Produtos vendidos por quilo</h2></div>
  <p className="help">Configure cada produto como unidade ou kg. O preço cadastrado para kg é sempre por 1,000 kg. A balança é opcional; entrada manual exige supervisor.</p>
  <form className="form-grid" onSubmit={save}>
   <label className="field">Produto<select required value={productId} onChange={e=>{setProductId(e.target.value);setUnit(products.find(p=>p.id===e.target.value)?.saleUnit||'unit')}}>
    <option value="">Selecione</option>
    {products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.saleUnit==='kg'?'kg':'unidade'}</option>)}
   </select></label>
   <label className="field">Unidade de comercialização<select value={unit} onChange={e=>setUnit(e.target.value)}>
    <option value="unit">Por unidade</option><option value="kg">Por kg</option>
   </select></label>
   <button className="btn primary" disabled={!productId||busy||mode!=='live'||chosen?.isPizza}>Salvar unidade</button>
  </form>{error&&<p className="errorbox" role="alert">{error}</p>}{notice&&<p className="notice">{notice}</p>}
 </section>;
}