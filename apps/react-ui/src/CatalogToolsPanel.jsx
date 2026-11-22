import React,{useEffect,useState} from 'react';
import {Modal,Stack,Group,Button} from '@mantine/core';
import {formatMoney,parseMoney} from './model.mjs';
const uid=()=>crypto.randomUUID();
function Section({title,children}){return <section className="panel"><div className="sectiontitle"><h2>{title}</h2></div>{children}</section>}
function Row({children}){return <div className="list-row">{children}</div>}
function Failure({error}){return error?<p className="errorbox" role="alert">{error}</p>:null;}
export function CatalogToolsPanel({mode,api,categories,products,onRefresh}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [editing,setEditing]=useState(null);
 const [selectedProduct,setSelectedProduct]=useState(''),[modifierName,setModifierName]=useState(''),[modifierPrice,setModifierPrice]=useState('0,00');
 const [comboName,setComboName]=useState(''),[comboPrice,setComboPrice]=useState('0,00'),[comboCategory,setComboCategory]=useState(''),[parts,setParts]=useState([]);
 const [mods,setMods]=useState([]);
 useEffect(()=>{if(!selectedProduct||mode!=='live'){setMods([]);return;}let live=true;api('/api/products/'+encodeURIComponent(selectedProduct)+'/modifiers').then(x=>{if(live)setMods(x.modifiers||[])}).catch(e=>{if(live)setError(e.message)});return()=>{live=false;};},[selectedProduct,mode,api,notice]);
 async function action(route,method,body){
   if(mode!=='live'||busy)return;
   setBusy(true);setError('');setNotice('');
   try{await api(route,{method,body:{commandId:uid(),...body}});setNotice('Alteração salva no servidor.');await onRefresh?.();return true;}
   catch(e){setError(e.message);return false;}finally{setBusy(false)}
 }
 const submitEdit=async event=>{
  event.preventDefault();
  if(!editing||busy||mode!=='live')return;
  try{
   const name=editing.name.trim();
   if(!name)throw Error('Nome obrigatório');
   let ok;
   if(editing.type==='category')ok=await action('/api/categories/'+encodeURIComponent(editing.id),'PATCH',{name});
   else {
    const priceCents=parseMoney(editing.price),barcode=(editing.barcode||'').trim()||null;
    if(barcode&&!/^\d{13}$/.test(barcode))throw Error('Código EAN-13 inválido');
    ok=await action('/api/products/'+encodeURIComponent(editing.id),'PATCH',{name,priceCents,barcode});
   }
   if(ok)setEditing(null);
  }catch(e){setError(e.message);}
 };
 const simple=products.filter(p=>!p.isCombo&&p.active);
 const addPart=(id,quantity)=>{
   if(!id)return;
   if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100){setError('Quantidade do combo inválida');return;}
   setParts(current=>[...current.filter(x=>x.productId!==id),{productId:id,quantity}]);
 };
 return <section className="stack">
  <div className="pageheading"><div><p className="eyebrow">CARDÁPIO / CONFIGURAÇÕES</p><h2>Edição de catálogo, adicionais e combos</h2><p className="subtext">Todos os preços e componentes são gravados no catálogo canônico.</p></div></div>
  <Failure error={error}/>{notice&&<p className="help" role="status">{notice}</p>}
  <Modal opened={Boolean(editing)} onClose={()=>{if(!busy)setEditing(null)}} centered
   title={editing?.type==='category'?'Renomear categoria':'Editar produto'} closeOnClickOutside={!busy}>
   {editing&&<form onSubmit={event=>void submitEdit(event)}>
    <Stack gap="md">
     <label className="field">Nome
      <input autoFocus required maxLength={editing.type==='category'?80:120} value={editing.name}
       onChange={e=>setEditing(s=>({...s,name:e.target.value}))}/>
     </label>
     {editing.type==='product'&&<>
      <label className="field">Preço (R$)
       <input required inputMode="decimal" value={editing.price}
        onChange={e=>setEditing(s=>({...s,price:e.target.value}))}/>
      </label>
      <label className="field">EAN-13 opcional
       <input inputMode="numeric" pattern="[0-9]{13}" maxLength={13} value={editing.barcode}
        onChange={e=>setEditing(s=>({...s,barcode:e.target.value}))}/>
      </label>
     </>}
     <Group justify="flex-end">
      <Button variant="default" disabled={busy} onClick={()=>setEditing(null)}>Cancelar</Button>
      <Button color="orange" type="submit" loading={busy} disabled={!editing.name.trim()}>Salvar alterações</Button>
     </Group>
    </Stack>
   </form>}
  </Modal>
  <Section title="Editar e arquivar categorias">
   {categories.map(c=><Row key={c.id}><span className="grow"><strong>{c.name}</strong><small>{c.active?'Ativa':'Arquivada'}</small></span>{!!c.active&&<>
     <button className="btn secondary" disabled={busy||mode!=='live'} onClick={()=>setEditing({type:'category',id:c.id,name:c.name})}>Renomear</button>
     <button className="btn secondary" disabled={busy||mode!=='live'||c.id==='c-default'} onClick={()=>{if(window.confirm('Arquivar categoria? Seus produtos deixarão de estar disponíveis para novas vendas.'))void action('/api/categories/'+encodeURIComponent(c.id)+'/archive','POST',{});}}>Arquivar</button>
    </>}</Row>)}
  </Section>
  <Section title="Editar produtos">
   {products.map(p=><Row key={p.id}><span className="grow"><strong>{p.name}</strong><small>{formatMoney(p.priceCents)} {p.barcode?'· '+p.barcode:''}</small></span>
    <button className="btn secondary" disabled={busy||mode!=='live'} onClick={()=>setEditing({type:'product',id:p.id,name:p.name,price:(p.priceCents/100).toFixed(2).replace('.',','),barcode:p.barcode||''})}}>Editar</button>
   </Row>)}
  </Section>
  <Section title="Adicionais e personalizações">
   <label className="field">Produto<select value={selectedProduct} onChange={e=>setSelectedProduct(e.target.value)}><option value="">Selecione um produto</option>{simple.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   {mods.map(m=><Row key={m.id}><span>{m.name}</span><strong>{formatMoney(m.priceCents)}</strong></Row>)}
   <form className="form-grid" onSubmit={e=>{e.preventDefault();if(!selectedProduct)return;try{void action('/api/products/'+encodeURIComponent(selectedProduct)+'/modifiers','POST',{name:modifierName.trim(),priceCents:parseMoney(modifierPrice)}).then(ok=>{if(ok){setModifierName('');setModifierPrice('0,00');}})}catch(e){setError(e.message)}}}>
    <label className="field">Nome<input required maxLength="80" value={modifierName} onChange={e=>setModifierName(e.target.value)}/></label>
    <label className="field">Preço adicional (R$)<input required value={modifierPrice} onChange={e=>setModifierPrice(e.target.value)}/></label>
    <button className="btn primary" disabled={!selectedProduct||busy||mode!=='live'}>Cadastrar adicional</button>
   </form>
  </Section>
  <Section title="Combos de preço fixo">
    <div className="form-grid">
      <label className="field">Nome do combo<input required maxLength="120" value={comboName} onChange={e=>setComboName(e.target.value)}/></label>
      <label className="field">Preço fixo (R$)<input value={comboPrice} onChange={e=>setComboPrice(e.target.value)}/></label>
      <label className="field">Categoria<select value={comboCategory} onChange={e=>setComboCategory(e.target.value)}><option value="">Padrão</option>{categories.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    </div>
    <form className="row wrap compact" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);addPart(String(f.get('productId')),Number(f.get('quantity')));}}>
     <label className="field">Componente<select name="productId" required>{simple.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
     <label className="field">Quantidade<input type="number" name="quantity" min="1" max="100" defaultValue="1" required/></label>
     <button className="btn secondary" disabled={!simple.length}>Adicionar componente</button>
    </form>
    {parts.map(p=><Row key={p.productId}><span>{p.quantity} × {products.find(x=>x.id===p.productId)?.name}</span><button className="btn secondary" onClick={()=>setParts(list=>list.filter(x=>x.productId!==p.productId))}>Remover</button></Row>)}
    <button className="btn primary" disabled={!comboName.trim()||!parts.length||busy||mode!=='live'} onClick={()=>{try{void action('/api/combos','POST',{name:comboName.trim(),priceCents:parseMoney(comboPrice),categoryId:comboCategory||'c-default',components:parts}).then(ok=>{if(ok){setComboName('');setComboPrice('0,00');setParts([]);}})}catch(e){setError(e.message)}}}>Salvar combo</button>
  </Section>
 </section>;
}
export function HardwareToolsPanel({mode,api}){
 const [status,setStatus]=useState({}),[devices,setDevices]=useState([]),[jobs,setJobs]=useState([]);
 const [revision,setRevision]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [label,setLabel]=useState(''),[labelMode,setLabelMode]=useState('weight'),[labelResult,setLabelResult]=useState(null);
 const [barcode,setBarcode]=useState(''),[barcodeResult,setBarcodeResult]=useState(null);
 const [scaleRaw,setScaleRaw]=useState(''),[scaleBrand,setScaleBrand]=useState('generic'),[reading,setReading]=useState(null);
 useEffect(()=>{if(mode!=='live')return;let live=true;
  Promise.all(['/api/printer','/api/pairing/devices','/api/print/jobs'].map(p=>api(p)))
    .then(([printer,paired,print])=>{if(live){setStatus(printer);setDevices(paired.devices||[]);setJobs(print.jobs||[])}})
    .catch(e=>{if(live)setError(e.message)});
  return()=>{live=false;};
 },[mode,api,revision]);
 const doAction=async(route,method='GET',body)=>{
  setBusy(true);setError('');setNotice('');
  try{const result=await api(route,{method,...(body?{body:{commandId:uid(),...body}}:{})});setRevision(v=>v+1);return result;}
  catch(e){setError(e.message);return null;}finally{setBusy(false)}
 };
 return <div className="page"><div className="pageheading"><div><p className="eyebrow">INTEGRAÇÕES / HARDWARE LOCAL</p><h1>Diagnósticos de periféricos</h1><p className="subtext">Impressão, etiquetas, balança e dispositivos da rede. Homologação física depende do equipamento.</p></div></div>
  <Failure error={error}/>{notice&&<p className="help" role="status">{notice}</p>}
  <Section title="Impressora configurada">
    <Row><span>Transporte</span><strong>{status.profile?.transport||'Não configurado'}</strong></Row>
    <Row><span>Endereço / porta</span><strong>{status.profile?.host||status.profile?.devicePath||'—'} {status.profile?.port||''}</strong></Row>
    <button className="btn secondary" disabled={busy} onClick={()=>setRevision(x=>x+1)}>Atualizar fila</button>
    {jobs.map(j=><Row key={j.id}><span>Pedido #{j.orderId?.slice(-8)} · {j.status}</span>
     {j.status!=='DONE'&&<button className="btn primary" disabled={busy} onClick={()=>void doAction('/api/print/jobs/'+encodeURIComponent(j.id)+'/send','POST',{}).then(r=>{if(r)setNotice('Envio solicitado. Confirme fisicamente o papel na impressora.');})}>Enviar impressão</button>}</Row>)}
  </Section>
  <Section title="Dispositivos pareados">
    {devices.map(d=><Row key={d.id}><span className="grow"><strong>{d.label}</strong><small>{d.role} · {d.revokedAt?'Revogado':d.expiresAt}</small></span>{!d.revokedAt&&<button className="btn secondary" disabled={busy} onClick={()=>{if(window.confirm('Revogar acesso deste dispositivo?'))void doAction('/api/pairing/revoke','POST',{deviceId:d.id});}}>Revogar</button>}</Row>)}
  </Section>
  <Section title="Verificador EAN-13">
    <div className="row wrap compact"><input inputMode="numeric" maxLength="13" value={barcode} onChange={e=>setBarcode(e.target.value)} placeholder="EAN-13"/><button className="btn secondary" disabled={busy||barcode.length!==13} onClick={()=>void doAction('/api/catalog/barcode?code='+encodeURIComponent(barcode)).then(setBarcodeResult)}>Consultar produto</button></div>
    {barcodeResult&&<p>{barcodeResult.product?barcodeResult.product.name+' · '+formatMoney(barcodeResult.product.priceCents):'Código válido, sem produto cadastrado'}</p>}
  </Section>
  <Section title="Etiqueta de balança">
    <div className="row wrap compact"><input value={label} inputMode="numeric" maxLength="13" placeholder="13 dígitos da etiqueta" onChange={e=>setLabel(e.target.value)}/><select value={labelMode} onChange={e=>setLabelMode(e.target.value)}><option value="weight">Peso</option><option value="price">Preço</option></select><button className="btn secondary" disabled={busy||label.length!==13} onClick={()=>void doAction('/api/hardware/scale/label?code='+encodeURIComponent(label)+'&mode='+labelMode).then(r=>setLabelResult(r?.label))}>Validar etiqueta</button></div>
    {labelResult&&<pre className="help">{JSON.stringify(labelResult,null,2)}</pre>}
  </Section>
  <Section title="Leitura serial de balança">
    <div className="form-grid"><label className="field">Marca/protocolo<select value={scaleBrand} onChange={e=>setScaleBrand(e.target.value)}><option value="generic">Genérico</option><option value="toledo">Toledo</option><option value="filizola">Filizola</option></select></label><label className="field">Trama recebida<input value={scaleRaw} maxLength="256" onChange={e=>setScaleRaw(e.target.value)} placeholder="Dados da porta serial"/></label></div>
    <button className="btn secondary" disabled={busy||!scaleRaw} onClick={()=>void doAction('/api/hardware/scale/parse?raw='+encodeURIComponent(scaleRaw)+'&brand='+encodeURIComponent(scaleBrand)).then(r=>setReading(r?.reading))}>Analisar leitura</button>
    {reading&&<pre className="help">{JSON.stringify(reading,null,2)}</pre>}
    <p className="help">A validação textual não substitui homologação de balança física nem conferência de estabilidade.</p>
  </Section>
 </div>;
}
