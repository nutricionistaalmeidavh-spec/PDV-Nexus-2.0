import React,{useState,useEffect} from 'react';
import {formatMoney} from './model.mjs';
import {Button,Pill,Frame,Panel,Empty} from './UIPrimitives.jsx';
const centsLabel=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const isAdmin=user=>!user||user.role==='admin';
function Onboarding({mode,api}){
 const [step,setStep]=useState(0),[restaurant,setRestaurant]=useState(''),[terminal,setTerminal]=useState('');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const steps=['Estabelecimento','Terminal','Impressão','Conferência'];
 useEffect(()=>{
  if(mode!=='live')return;
  let active=true;
  api('/api/system/config').then(config=>{
   if(active){setRestaurant(config.restaurant?.displayName||'');setTerminal(config.terminal?.label||'');}
  }).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[api,mode]);
 const next=()=>{
  if(step===0&&!restaurant.trim())return setError('Informe o nome do estabelecimento');
  if(step===1&&!terminal.trim())return setError('Informe o nome do terminal');
  setError('');setStep(x=>Math.min(3,x+1));
 };
 const save=async()=>{
  if(mode!=='live')return setError('Conecte o host para salvar');
  setBusy(true);setError('');setNotice('');
  try{
   await api('/api/system/config',{method:'POST',body:{commandId:crypto.randomUUID(),displayName:restaurant.trim(),terminalLabel:terminal.trim()}});
   setNotice('Configuração salva no SQLite do host local');
  }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 return <Frame eyebrow="CONFIGURAÇÃO / PRIMEIRO ACESSO" title="Configuração inicial" description="Defina o restaurante e o terminal. Dados são gravados no banco local após confirmação.">
  <div className="onboard-grid"><section className="panel"><div className="stack">{steps.map((s,i)=><button type="button" className={'step-tab '+(step===i?'active':'')} onClick={()=>setStep(i)} key={s}><span>{i+1}</span>{s}</button>)}</div></section>
  <section className="panel"><h2>{steps[step]}</h2>
   {step===0?<label className="field">Nome do estabelecimento<input required maxLength={120} value={restaurant} onChange={e=>setRestaurant(e.target.value)} placeholder="Minha lanchonete"/></label>:null}
   {step===1?<label className="field">Nome do terminal<input required maxLength={80} value={terminal} onChange={e=>setTerminal(e.target.value)} placeholder="Caixa principal"/></label>:null}
   {step===2?<p className="help">Impressoras são opcionais. Configure TCP, COM ou fila Windows em Impressão. O caixa permanece offline e funcional sem equipamento conectado.</p>:null}
   {step===3?<div className="stack"><p><strong>Estabelecimento:</strong> {restaurant}</p><p><strong>Terminal:</strong> {terminal}</p><p className="help">Salvar registra uma mudança auditada; não habilita emissão fiscal nem serviços pagos.</p></div>:null}
   {error&&<p className="errorbox" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
   <div className="row end"><Button disabled={step===0||busy} onClick={()=>setStep(x=>Math.max(0,x-1))}>Voltar</Button>{step===3?<Button kind="primary" busy={busy} onClick={()=>void save()}>Salvar configuração</Button>:<Button kind="primary" onClick={next}>Próximo</Button>}</div>
  </section></div>
 </Frame>;
}
function Dashboard({orders,session,tables,onGo}){return <Frame eyebrow="ADMINISTRAÇÃO / VISÃO GERAL" title="Gestão e relatórios" description="Indicadores disponíveis a partir do host; métricas futuras não são inventadas."><div className="metric-grid"><div className="metric-card"><span>Pedidos carregados</span><strong>{orders.length}</strong><small>Últimos registros consultados</small></div><div className="metric-card"><span>Pedidos abertos</span><strong>{orders.filter(o=>o.status==='OPEN').length}</strong><small>No conjunto consultado</small></div><div className="metric-card"><span>Mesas ocupadas</span><strong>{tables.filter(t=>t.orderId).length}</strong><small>Atualização local</small></div><div className="metric-card"><span>Dinheiro no caixa (esperado)</span><strong>{centsLabel(session?.expectedCents||0)}</strong><small>{session?'Sessão aberta':'Sem sessão ativa'}</small></div></div><div className="shortcut-grid">{[['estoque','Estoque','Controle e movimentações'],['financeiro','Financeiro','Recebimentos e caixa'],['relatorios','Relatórios','Vendas e desempenho'],['usuarios','Usuários','Acessos e permissões'],['integracoes','Integrações','Periféricos e serviços opcionais']].map(([id,label,sub])=><button className="shortcut" key={id} onClick={()=>onGo(id)}><strong>{label}</strong><small>{sub}</small><span>→</span></button>)}</div></Frame>}
function Users({onAdd,busy,user,api,mode}){
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState('cashier');
 const [accounts,setAccounts]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reset,setReset]=useState({}),[working,setWorking]=useState(false);
 const admin=isAdmin(user)&&mode==='live';
 const load=async()=>{
  if(!admin)return;
  const result=await api('/api/auth/operators');
  setAccounts(result.users||[]);
 };
 useEffect(()=>{
  if(!admin)return;
  let active=true;
  api('/api/auth/operators').then(data=>{if(active)setAccounts(data.users||[])}).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[api,admin]);
 const submit=async event=>{
  event.preventDefault();setError('');setNotice('');
  try{
   await onAdd({username,password,role});
   setUsername('');setPassword('');setNotice('Operador criado.');await load();
  }catch(e){setError(e.message);}
 };
 const change=async(id,body)=>{
  setError('');setNotice('');setWorking(true);
  try{
   await api('/api/auth/operators/'+encodeURIComponent(id),{method:'PATCH',body});
   await load();setNotice('Operador atualizado. Sessões anteriores revogadas.');
  }catch(e){setError(e.message);}
  finally{setWorking(false);}
 };
 const changePassword=async(id)=>{
  setError('');setNotice('');setWorking(true);
  try{
   await api('/api/auth/operators/'+encodeURIComponent(id)+'/password',{method:'POST',body:{password:reset[id]}});
   setReset(old=>({...old,[id]:''}));await load();
   setNotice('Senha atualizada e sessões anteriores revogadas.');
  }catch(e){setError(e.message);}
  finally{setWorking(false);}
 };
 return <Frame eyebrow="SEGURANÇA / OPERADORES" title="Usuários e permissões"
  description="Gerenciamento local de funcionários, sem contas em nuvem. Somente supervisores podem alterar acessos.">
  {error&&<p className="errorbox" role="alert">{error}</p>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  <Panel title="Novo operador">
   <form className="form-grid" onSubmit={submit}>
    <label className="field">Usuário<input value={username} onChange={e=>setUsername(e.target.value)}
      pattern="[a-zA-Z0-9._-]{3,40}" required disabled={!admin}/></label>
    <label className="field">Senha inicial<input value={password} onChange={e=>setPassword(e.target.value)}
      type="password" minLength={12} maxLength={128} autoComplete="new-password" required disabled={!admin}/></label>
    <label className="field">Perfil<select value={role} onChange={e=>setRole(e.target.value)} disabled={!admin}>
      <option value="cashier">Caixa</option><option value="admin">Supervisor</option></select></label>
    <button className="btn primary" disabled={!admin||busy||working}>Criar operador</button>
   </form>
  </Panel>
  <Panel title="Operadores cadastrados">
   {!accounts.length?<Empty>Sem operadores carregados.</Empty>:accounts.map(account=><div key={account.id} className="list-row" style={{alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
    <div><strong>{account.username}</strong><p className="help">{account.enabled?'Ativo':'Desativado'}</p></div>
    <label className="field">Perfil<select aria-label={'Perfil de '+account.username} value={account.role}
      disabled={!admin||working||account.id===user?.id}
      onChange={e=>void change(account.id,{role:e.target.value})}>
      <option value="cashier">Caixa</option><option value="admin">Supervisor</option></select></label>
    <button className="btn secondary" disabled={!admin||working||account.id===user?.id}
      onClick={()=>void change(account.id,{enabled:!account.enabled})}>{account.enabled?'Desativar':'Reativar'}</button>
    <form onSubmit={e=>{e.preventDefault();void changePassword(account.id);}} className="row wrap">
      <label className="field">Redefinir senha
       <input type="password" aria-label={'Nova senha de '+account.username} autoComplete="new-password"
        minLength={12} maxLength={128} required disabled={!admin||working} value={reset[account.id]||''}
        onChange={e=>setReset(old=>({...old,[account.id]:e.target.value}))}/></label>
      <button className="btn secondary" disabled={!admin||working||!(reset[account.id]?.length>=12)}>Salvar senha</button>
    </form>
   </div>)}
   <p className="help">Desativar um operador ou trocar sua senha revoga as sessões existentes. A própria conta do supervisor não pode ser desativada.</p>
  </Panel>
 </Frame>;
}
function Printing({mode,onSave,busy,jobs,user,api,onRefresh}){
 const [working,setWorking]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const supervisor=mode==='live'&&isAdmin(user);
 const canSend=mode==='live'&&['cashier','admin'].includes(user?.role);
 const dispatch=async(job,action)=>{
  if(!canSend)return;
  setWorking(job.id);setError('');setNotice('');
  try{
   await api('/api/print/jobs/'+encodeURIComponent(job.id)+'/'+action,{
    method:'POST',body:{commandId:crypto.randomUUID()}});
   await onRefresh();
   setNotice(action==='reprint'?'Nova via adicionada à fila.':'Envio realizado ao transporte da impressora.');
  }catch(e){setError(e.message);}
  finally{setWorking(null);}
 };
 const [transport,setTransport]=useState('tcp'),[host,setHost]=useState(''),[port,setPort]=useState('9100');
 const [devicePath,setDevicePath]=useState(''),[baudRate,setBaudRate]=useState('9600');
 return <Frame eyebrow="CONFIGURAÇÕES / HARDWARE" title="Impressão" description="Fila ESC/POS. TCP ou serial/COM opcional; impressão física exige homologação.">
  {error&&<p className="errorbox" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
  <Panel title="Configurar impressora"><form className="form-grid" onSubmit={e=>{e.preventDefault();onSave(transport==='tcp'?{transport,host,port:Number(port)}:transport==='serial'?{transport,devicePath,baudRate:Number(baudRate)}:{transport,devicePath}).catch(()=>{});}}>
   <label className="field">Transporte<select value={transport} onChange={e=>setTransport(e.target.value)}><option value="tcp">Rede TCP</option><option value="serial">USB serial / COM (driver opcional)</option><option value="windows">Impressora instalada no Windows (RAW)</option></select></label>
   {transport==='tcp'?<><label className="field">IPv4 privado<input value={host} onChange={e=>setHost(e.target.value)} required placeholder="192.168.1.100"/></label><label className="field">Porta TCP<input value={port} onChange={e=>setPort(e.target.value)} type="number" min="1" max="65535" required/></label></>:<><label className="field">Porta serial ou fila Windows<input value={devicePath} onChange={e=>setDevicePath(e.target.value)} required placeholder="COM3, /dev/ttyUSB0 ou Epson TM-T20"/></label>{transport==='serial'&&<label className="field">Baud rate<select value={baudRate} onChange={e=>setBaudRate(e.target.value)}>{[9600,19200,38400,57600,115200].map(n=><option key={n} value={n}>{n}</option>)}</select></label>}</>}
   <button className="btn primary" disabled={!supervisor||busy}>Salvar impressora</button>
  </form><p className="help">USB serial requer driver opcional serialport; filas USB instaladas no Windows usam Winspool RAW. Compatibilidade física depende do modelo.</p></Panel>
  <Panel title="Fila de impressão">
   {jobs.length?jobs.map(j=><div className="list-row" key={j.id}>
    <span>Pedido #{j.orderId?.slice(-8)}</span>
    <Pill tone={j.status==='DONE'?'green':'orange'}>{j.status}</Pill>
    <button type="button" className="btn secondary" disabled={!canSend||working===j.id||busy}
      onClick={()=>void dispatch(j,j.status==='DONE'?'reprint':'send')}>
      {working===j.id?'Processando...':j.status==='DONE'?'Reimprimir':'Enviar impressão'}
    </button>
   </div>):<Empty>Nenhum trabalho de impressão consultado.</Empty>}
   <p className="help">Os comprovantes são não fiscais. O envio ao transporte não confirma a saída física do papel.</p>
  </Panel>
 </Frame>;
}
function Exports({mode}){return <Frame eyebrow="CONTABILIDADE / EXPORTAÇÃO" title="Exportar vendas" description="Dados operacionais CSV/JSON para emissão fiscal externa quando aplicável."><Panel><Pill tone="orange">Não emite NFC-e ou NF-e</Pill><p className="subtext gap-top">Exportação disponível somente no host local autenticado. Arquivos não substituem documento fiscal.</p><div className="row wrap">{mode==='live'?<><a className="btn primary" href="/api/exports/sales.csv">Baixar CSV</a><a className="btn secondary" href="/api/exports/sales.json">Baixar JSON</a></>:<Empty>Conecte o host para exportar dados reais.</Empty>}</div></Panel></Frame>}

export {Onboarding,Dashboard,Users,Printing,Exports};
