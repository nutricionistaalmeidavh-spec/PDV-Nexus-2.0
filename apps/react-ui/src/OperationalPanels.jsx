import React,{useEffect,useState} from 'react';
import {formatMoney} from './model.mjs';

const currency=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const uid=()=>crypto.randomUUID();
function Section({title,children}){return <section className="panel"><div className="sectiontitle"><h2>{title}</h2></div>{children}</section>}
function Issue({text}){return text?<p className="errorbox" role="alert">{text}</p>:null;}
function Row({children}){return <div className="list-row">{children}</div>}
function Notice({children}){return <p className="help" role="status">{children}</p>}

export function DeliveryPanel({mode,api,section='delivery'}){
 const [state,setState]=useState({pending:true}),[revision,setRevision]=useState(0);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [days,setDays]=useState(90);
 useEffect(()=>{
   if(mode!=='live'){setState({offline:true});return;}
   let alive=true;
   Promise.all(['/api/delivery/settings','/api/delivery/requests','/api/delivery/orders','/api/delivery/privacy/report'].map(p=>api(p)))
    .then(([settings,requests,orders,privacy])=>{if(alive)setState({settings,requests,orders,privacy})})
    .catch(e=>{if(alive)setState({error:e.message})});
   return ()=>{alive=false;};
 },[mode,api,revision]);
 const run=async(path,payload={})=>{
  if(mode!=='live'||busy)return;
  setBusy(true);setError('');setMessage('');
  try{const result=await api(path,{method:'POST',body:{commandId:uid(),...payload}});
      setRevision(n=>n+1);setMessage('Operação confirmada pelo servidor local.');
      return result;
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const requests=state.requests?.requests||[];
 const orders=state.orders?.orders||[];
 const transition={ACCEPTED:['PREPARING','Iniciar separação'],PREPARING:['OUT_FOR_DELIVERY','Saiu para entrega'],OUT_FOR_DELIVERY:['DELIVERED','Entregue']};
 return <div className="page">
  <div className="pageheading"><div><p className="eyebrow">DELIVERY / SELF-HOSTED</p><h1>{section==='privacidade'?'Privacidade delivery':'Delivery e cardápio digital'}</h1><p className="subtext">Pedidos digitais exigem aceitação pela equipe. Não há cobrança online nem serviços pagos obrigatórios.</p></div></div>
  <Issue text={error||state.error}/>{message&&<Notice>{message}</Notice>}
  {state.offline?<Section title="Host indisponível">Operações e dados locais não disponíveis.</Section>:state.pending?<p>Carregando dados do host...</p>:<>
   <Section title="Cardápio digital e solicitações">
    <Row><span>Publicação na rede local</span><strong>{state.settings?.enabled?'Habilitada':'Desativada'}</strong></Row>
    <div className="row wrap compact">
     <button className="btn primary" disabled={busy} onClick={()=>void run('/api/delivery/settings',{enabled:!state.settings?.enabled})}>{state.settings?.enabled?'Desativar cardápio':'Habilitar cardápio'}</button>
     {state.settings?.enabled&&<a className="btn secondary" href="/menu.html" target="_blank" rel="noopener noreferrer">Visualizar cardápio público</a>}
     <button className="btn secondary" disabled={busy} onClick={()=>setRevision(n=>n+1)}>Atualizar</button>
    </div>
    <p className="help">Acesso externo requer configuração HTTPS local. O cliente envia apenas uma solicitação, que não é uma venda paga.</p>
   </Section>
   <Section title={'Solicitações ('+requests.length+')'}>
    <div className="stack">{requests.map(item=><Row key={item.id}>
      <span className="grow"><strong>{item.customerName}</strong><small>{item.address} · {currency(item.totalCents)} · {item.status}</small><small>{item.phone} {item.note?' · '+item.note:''}</small></span>
      {item.status==='PENDING'&&<span className="row wrap compact"><button className="btn primary" disabled={busy} onClick={()=>void run('/api/delivery/requests/'+encodeURIComponent(item.id)+'/accept')}>Aceitar</button><button className="btn secondary" disabled={busy} onClick={()=>{const reason=window.prompt('Motivo da recusa');if(reason?.trim())void run('/api/delivery/requests/'+encodeURIComponent(item.id)+'/reject',{reason:reason.trim()});}}>Recusar</button></span>}
      {['REJECTED','ACCEPTED'].includes(item.status)&&<button className="btn secondary" disabled={busy} onClick={()=>{if(window.confirm('Anonimizar esta solicitação, se o atendimento já estiver concluído?'))void run('/api/delivery/requests/'+encodeURIComponent(item.id)+'/anonymize');}}>Anonimizar dados</button>}
    </Row>)}{!requests.length&&<p className="help">Nenhuma solicitação recebida.</p>}</div>
   </Section>
   <Section title="Acompanhamento das entregas">
    <div className="stack">{orders.map(item=><Row key={item.orderId}><span className="grow"><strong>{item.customerName} · {item.status}</strong><small>Pedido #{item.orderId.slice(-8)} · {item.orderStatus} · {item.address}</small></span>
      {transition[item.status]&&<button className="btn secondary" disabled={busy} onClick={()=>void run('/api/delivery/orders/'+encodeURIComponent(item.orderId)+'/status',{status:transition[item.status][0]})}>{transition[item.status][1]}</button>}
    </Row>)}{!orders.length&&<p className="help">Nenhuma entrega para acompanhar.</p>}</div>
   </Section>
   <Section title="Proteção de dados pessoais">
    <Row><span>Aguardando</span><strong>{state.privacy?.pending??0}</strong></Row>
    <Row><span>Aceitas</span><strong>{state.privacy?.accepted??0}</strong></Row>
    <Row><span>Recusadas</span><strong>{state.privacy?.rejected??0}</strong></Row>
    <Row><span>Anonimizadas</span><strong>{state.privacy?.anonymized??0}</strong></Row>
    <div className="row wrap compact">
      <label className="field">Solicitações anteriores a (dias)<input type="number" min="30" max="3650" value={days} onChange={e=>setDays(Number(e.target.value))}/></label>
      <button className="btn secondary" disabled={busy||days<30||days>3650} onClick={()=>{if(window.confirm('Anonimizar dados de entregas concluídas e solicitações recusadas dentro desse prazo?'))void run('/api/delivery/privacy/purge',{olderThanDays:days});}}>Aplicar retenção</button>
    </div>
    <p className="help">Pedidos pendentes ou entregas não finalizadas são protegidos pelo servidor e não são anonimizados.</p>
   </Section>
  </>}
 </div>;
}

function downloadPacket(packet,name){
 const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=name;link.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function UnitsPanel({mode,api}){
 const [state,setState]=useState({pending:true}),[revision,setRevision]=useState(0);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(mode!=='live'){setState({offline:true});return;}
  let live=true;
  Promise.all(['/api/sync/units','/api/sync/conflicts','/api/sync/operational/status','/api/sync/operational/peers'].map(p=>api(p)))
   .then(([units,conflicts,status,peers])=>{if(live)setState({units,conflicts,status,peers})})
   .catch(e=>{if(live)setState({error:e.message})});
  return()=>{live=false;};
 },[mode,api,revision]);
 const execute=async(task)=>{if(busy)return;setBusy(true);setError('');setMessage('');
  try{const msg=await task();setMessage(msg||'Operação concluída.');setRevision(n=>n+1);}catch(e){setError(e.message)}finally{setBusy(false)}
 };
 const importFile=async(file)=>{
  if(!file)throw Error('Selecione um arquivo JSON');
  if(file.size>524000)throw Error('Arquivo excede 512 KB');
  let snapshot;try{snapshot=JSON.parse(await file.text());}catch{throw Error('Arquivo JSON inválido')}
  const result=await api('/api/sync/import',{method:'POST',body:{commandId:uid(),snapshot}});
  return result.imported?'Unidade consolidada com sucesso':'Revisão já importada, sem duplicação';
 };
 return <div className="page">
  <div className="pageheading"><div><p className="eyebrow">MULTILOJA / ARQUIVOS E ESPÉLHOS</p><h1>Unidades</h1><p className="subtext">Cada loja mantém seu próprio SQLite. A consolidação agrega indicadores sem duplicar pedidos nem estoque.</p></div></div>
  <Issue text={error||state.error}/>{message&&<Notice>{message}</Notice>}
  {state.offline?<Section title="Host indisponível">As unidades exigem host local autenticado.</Section>:state.pending?<p>Consultando unidades...</p>:<>
   <div className="metric-grid">
     <div className="metric-card"><span>Unidades consolidadas</span><strong>{state.units?.units?.length??0}</strong></div>
     <div className="metric-card"><span>Vendas brutas</span><strong>{currency(state.units?.totals?.grossSalesCents)}</strong></div>
     <div className="metric-card"><span>CMV</span><strong>{currency(state.units?.totals?.cogsCents)}</strong></div>
   </div>
   <Section title="Consolidação manual">
    <div className="row wrap compact">
     <button className="btn primary" disabled={busy} onClick={()=>void execute(async()=>{const packet=await api('/api/sync/export');downloadPacket(packet,'pdv-unidade-'+packet.unitId+'-rev'+packet.revision+'.json');return 'Resumo exportado';})}>Exportar resumo JSON</button>
     <label className="field">Importar resumo de outra unidade <input type="file" accept="application/json,.json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void execute(()=>importFile(file));}}/></label>
     <button className="btn secondary" disabled={busy} onClick={()=>setRevision(n=>n+1)}>Atualizar</button>
    </div>
    <div className="stack">{(state.units?.units||[]).map(u=><Row key={u.unitId}><span><strong>{u.local?'Esta instalação':'Unidade importada'} · {u.unitId}</strong><small>Revisão {u.revision}</small></span><strong>{currency(u.totals?.grossSalesCents)}</strong></Row>)}</div>
   </Section>
   <Section title="Espelhos operacionais de consulta">
     <Row><span>Situação</span><strong>{state.status?.enabled?'Ativado · somente leitura':'Desativado'}</strong></Row>
     <button className="btn secondary" disabled={busy||!state.status?.enabled} onClick={()=>void execute(async()=>{const result=await api('/api/sync/operational/pull',{method:'POST',body:{}});return result.ok+' unidades consultadas, '+result.failed+' falhas';})}>Consultar agora</button>
     <div className="stack">{(state.peers?.peers||[]).map(peer=><Row key={peer.unitId}><span><strong>{peer.unitId}</strong><small>Revisão {peer.revision} · {peer.orders?.length||0} pedidos · {peer.products?.length||0} produtos · {peer.stock?.length||0} ingredientes</small></span></Row>)}</div>
     <p className="help">O espelho não altera vendas nem saldo da unidade local.</p>
   </Section>
   <Section title="Alertas de sincronização">
    {(state.conflicts?.conflicts||[]).filter(x=>!x.resolvedAt).map(conflict=><Row key={conflict.id}><span className="grow"><strong>{conflict.unitId} · revisão {conflict.revision}</strong><small>{conflict.reason}</small></span><button className="btn secondary" disabled={busy} onClick={()=>{if(window.confirm('Descartar apenas o alerta, sem alterar dados?'))void execute(async()=>{await api('/api/sync/conflicts/'+encodeURIComponent(conflict.id)+'/dismiss',{method:'POST',body:{commandId:uid()}});return 'Alerta descartado';});}}>Descartar alerta</button></Row>)}
   </Section>
  </>}
 </div>;
}
