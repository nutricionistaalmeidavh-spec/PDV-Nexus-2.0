import React,{useCallback,useEffect,useMemo,useRef,useState,lazy,Suspense} from 'react';
import {AppShell,Badge,Burger,Button as MantineButton,NavLink} from '@mantine/core';
import {ShoppingCart,ClipboardList,Package,UtensilsCrossed,Truck,ChefHat,Smartphone,Wallet,LayoutDashboard,Boxes,ChartBar,Store,Shield,Printer,Settings,Download,Monitor,Users as UsersIcon,BookOpen,Cable} from 'lucide-react';
import {PosSale as Sale,PosPaymentModal as PaymentModal,PosProductModal as ProductModal} from './PosExperience.jsx';
import {RestaurantTables as Tables,RestaurantKitchen as Kitchen,RestaurantWaiter as Waiter,RestaurantSplit as Split} from './RestaurantTangerine.jsx';
import {request,authFor,commandId} from './api.mjs';
import {formatMoney,parseMoney,paymentDraft,splitEvenly,appendDemoLine,DEMO_ORDER,sumOrder,formatTime} from './model.mjs';
import {sampleCategories,sampleProducts,sampleModifiers,sampleOrders,sampleTables,sampleTickets} from './demo.mjs';
import {foodAsset} from './media.mjs';
import {StockBusiness,FinanceBusiness} from './BusinessPanels.jsx';
import {Maintenance} from './Maintenance.jsx';
import {DeliveryPanel,UnitsPanel} from './OperationalPanels.jsx';
import {AdvancedStockPanel} from './AdvancedStockPanel.jsx';
import {CatalogToolsPanel,HardwareToolsPanel} from './CatalogToolsPanel.jsx';
import {TableOrderPanel} from './TableOrderPanel.jsx';
import {PairDevice} from './PairDevice.jsx';
import {PairedDevicesPanel} from './PairedDevicesPanel.jsx';

const links=[
 ['venda','▣','Nova venda','Operação'],['pedidos','≡','Pedidos','Operação'],['produtos','◇','Produtos e cardápio','Operação'],
 ['mesas','▦','Mesas e comandas','Restaurante'],['delivery','▤','Delivery','Restaurante'],['kds','♨','Cozinha (KDS)','Restaurante'],['garcom','♙','Garçom mobile','Restaurante'],['divisao','⊞','Fechamento de mesa','Restaurante'],
 ['caixa','▤','Controle de caixa','Gestão'],['geral','▥','Gestão geral','Gestão'],['estoque','⬡','Estoque','Gestão'],
 ['financeiro','▥','Financeiro','Gestão'],['relatorios','▤','Relatórios','Gestão'],['unidades','⇄','Unidades','Gestão'],['privacidade','◇','Privacidade delivery','Gestão'],['usuarios','♙','Usuários','Configuração'],
 ['integracoes','⇄','Integrações','Configuração'],['dispositivos','▦','Dispositivos LAN','Configuração'],
 ['impressao','▣','Impressão','Configuração'],['sistema','⚙','Backup e atualizações','Configuração'],['exportacao','⇩','Exportar vendas','Configuração'],['primeiro-acesso','⚙','Primeiro acesso','Configuração']
];
const titleOf=id=>links.find(x=>x[0]===id)?.[2]||'Nova venda';
const demoOrder=()=>({...DEMO_ORDER,lines:[]});
const toStringError=e=>e instanceof Error?e.message:'Falha não identificada';
const isAdmin=user=>!user||user.role==='admin';
const embedded=new URLSearchParams(window.location.search).has('embedded');
const centsLabel=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const initials=s=>(s||'Nexus').split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase();
const orderState={DRAFT:'Rascunho',OPEN:'Em aberto',CLOSED:'Concluído',CANCELLED:'Cancelado'};
const orderMode={counter:'Balcão',table:'Mesa',takeaway:'Retirada',delivery:'Entrega'};
function Button({children,kind='secondary',busy=false,className='',...props}){return <MantineButton type="button" {...props} loading={busy} disabled={busy||props.disabled} variant={kind==='primary'?'filled':kind==='soft'?'light':kind==='ghost'?'subtle':'default'} color={kind==='primary'||kind==='soft'?'orange':undefined} className={'btn '+kind+' '+className}>{children}</MantineButton>}
function Pill({children,tone='purple'}){return <Badge color={tone==='green'?'green':tone==='red'?'red':'orange'} variant="light" className={'pill '+tone}>{children}</Badge>}
function Frame({title,eyebrow,description,action,children}){return <div className="page"><div className="pageheading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description&&<p className="subtext">{description}</p>}</div>{action&&<div className="heading-action">{action}</div>}</div>{children}</div>}
function Panel({children,className='',title,aside}){return <section className={'panel '+className}>{title&&<div className="sectiontitle"><h2>{title}</h2>{aside}</div>}{children}</section>}
function Empty({children}){return <div className="empty">{children}</div>}
function MoneyInput({label,value,onChange,placeholder='0,00',min,...rest}){return <label className="field">{label}<input inputMode="decimal" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} {...rest}/></label>}
function Login({setup,onSubmit,busy,error}){
 const [username,setUsername]=useState('');const [password,setPassword]=useState('');
 return <main className="authpage"><div className="authcard"><span className="authbrand">▣ PDV Nexus <b>2.0</b></span><h1>{setup?'Configurar supervisor':'Entrar no caixa'}</h1><p className="subtext">Acesso local do estabelecimento, sem conta de nuvem.</p><form onSubmit={e=>{e.preventDefault();onSubmit(username,password)}} className="stack"><label className="field">Usuário<input required minLength={3} maxLength={40} autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="field">Senha (mínimo 12 caracteres)<input type="password" required minLength={12} autoComplete={setup?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p role="alert" className="errorbox">{error}</p>}<button className="btn primary block" type="submit" disabled={busy}>{busy?'Validando…':setup?'Criar conta local':'Entrar'}</button></form></div></main>
}
function Success({order,onNew}){return <Frame title="Venda concluída" eyebrow="RECEBIMENTO CONFIRMADO"><Panel className="success"><div className="big-check">✓</div><h2>Venda concluída!</h2><p>Pedido #{order?.id?.slice(-8)||'—'}</p><p className="overline">VALOR RECEBIDO</p><p className="hero-number green-text">{centsLabel(sumOrder(order))}</p><div className="row wrap center"><Pill tone="orange">Comprovante não fiscal</Pill><Pill tone="green">Pedido registrado</Pill></div><div className="row center"><Button kind="primary" onClick={onNew}>Nova venda</Button><Button onClick={()=>window.print()}>Imprimir esta tela</Button></div><p className="help">A impressão desta tela não substitui documento fiscal. A saída ESC/POS depende da fila e de impressora configurada.</p></Panel></Frame>}
function Orders({orders,onOpen,onRefresh,onRefund,canRefund,busy}){
 const [filter,setFilter]=useState('all');
 const filtered=orders.filter(o=>filter==='all'||o.status===filter);
 return <Frame eyebrow="OPERAÇÃO / PEDIDOS" title="Pedidos" description="Consulte pedidos, retome comandas e registre devoluções auditadas." action={<Button onClick={onRefresh} busy={busy}>Atualizar</Button>}>
 <Panel><div className="tabs">{[['all','Todos'],['DRAFT','Rascunhos'],['OPEN','Em aberto'],['CLOSED','Concluídos'],['CANCELLED','Cancelados']].map(([v,t])=><Button kind={filter===v?'primary':'ghost'} onClick={()=>setFilter(v)} key={v}>{t}</Button>)}</div>
 <div className="tablewrap"><table><thead><tr><th>Pedido</th><th>Atendimento</th><th>Hora</th><th>Situação</th><th>Ação</th></tr></thead><tbody>
 {filtered.map(o=><tr key={o.id}><td><strong>#{o.id.slice(-8)}</strong></td><td>{orderMode[o.serviceMode]||o.serviceMode}</td><td>{formatTime(o.createdAt)}</td><td><Pill tone={o.status==='CLOSED'?'green':o.status==='CANCELLED'?'red':'purple'}>{orderState[o.status]}</Pill></td><td>
 {['DRAFT','OPEN'].includes(o.status)?<Button onClick={()=>onOpen(o)} disabled={busy}>Retomar</Button>:o.status==='CLOSED'&&canRefund?<Button onClick={()=>onRefund(o)} disabled={busy}>Registrar devolução</Button>:<span className="help">Encerrado</span>}
 </td></tr>)}</tbody></table>{!filtered.length&&<Empty>Nenhum pedido neste filtro.</Empty>}</div></Panel></Frame>;
}
function Products({products,categories,onAddProduct,onAddCategory,onToggle,busy,canEdit}){
 const [catName,setCatName]=useState('');const [name,setName]=useState('');const [price,setPrice]=useState('');const [barcode,setBarcode]=useState('');const [cat,setCat]=useState('');const [query,setQuery]=useState('');
 const activeCategories=categories.filter(c=>c.active!==0);
 useEffect(()=>{if(!cat&&activeCategories.length)setCat(activeCategories[0].id)},[cat,activeCategories.length]);
 return <Frame eyebrow="GESTÃO / CARDÁPIO" title="Produtos e cardápio" description="Categorias, preços e disponibilidade em um único lugar."><div className="two-col-products"><Panel title="Categorias"><div className="category-list">{categories.map(c=><div className="list-row" key={c.id}><strong>{c.name}</strong><Pill tone={c.active===0?'red':'green'}>{c.active===0?'Arquivada':'Ativa'}</Pill></div>)}</div><form className="row compact" onSubmit={e=>{e.preventDefault();onAddCategory(catName).then(()=>setCatName('')).catch(()=>{});}}><input placeholder="Nova categoria" required maxLength={80} value={catName} onChange={e=>setCatName(e.target.value)} disabled={!canEdit}/><button className="btn primary" disabled={!canEdit||busy}>Criar</button></form></Panel><Panel title="Produtos"><div className="row"><label className="searchfield grow"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar produto"/></label></div><div className="product-list">{products.filter(p=>(p.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))||p.barcode?.includes(query))).map(p=><div className="list-row" key={p.id}><span className="mini-food">{foodAsset(p)?<img src={foodAsset(p)} alt=""/>:p.emoji||'🍽️'}</span><span className="grow"><strong>{p.name}</strong><small>{centsLabel(p.priceCents)}</small></span><Pill tone={p.active?'green':'red'}>{p.active?'Ativo':'Inativo'}</Pill><Button disabled={!canEdit||busy} onClick={()=>onToggle(p)}>{p.active?'Desativar':'Ativar'}</Button></div>)}</div><form className="product-form" onSubmit={e=>{e.preventDefault();onAddProduct({name,price,barcode,categoryId:cat}).then(()=>{setName('');setPrice('');setBarcode('')}).catch(()=>{});}}><h3>Cadastrar novo produto</h3><label className="field">Nome<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} disabled={!canEdit}/></label><MoneyInput label="Preço (R$)" value={price} onChange={setPrice} required disabled={!canEdit}/><label className="field">EAN-13 (opcional)<input value={barcode} onChange={e=>setBarcode(e.target.value)} inputMode="numeric" pattern="[0-9]{13}" maxLength={13} disabled={!canEdit} placeholder="7891234567895"/></label><label className="field">Categoria<select value={cat} onChange={e=>setCat(e.target.value)} required disabled={!canEdit}>{activeCategories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><button className="btn primary" disabled={!canEdit||busy||!cat}>Cadastrar produto</button></form></Panel></div></Frame>
}
function Cash({session,onAction,busy}){
 const [amount,setAmount]=useState('0,00');const [kind,setKind]=useState('SUPPLY');
 return <Frame eyebrow="FINANCEIRO / SESSÃO" title="Controle de caixa" description="Abertura, suprimento, sangria e conciliação do caixa."><div className="dashboard-grid"><Panel className="cash-main"><div className="cash-icon">▣</div><h2>{session?'Caixa aberto':'Caixa fechado'}</h2><p className="subtext">{session?'Registre a movimentação ou confira o dinheiro para fechar.':'Informe o fundo de troco para iniciar o turno.'}</p><MoneyInput label={session?'Valor de movimento ou fechamento (R$)':'Valor inicial em dinheiro (R$)'} value={amount} onChange={setAmount}/>{session&&<label className="field">Tipo<select value={kind} onChange={e=>setKind(e.target.value)}><option value="SUPPLY">Suprimento</option><option value="WITHDRAWAL">Sangria</option></select></label>}{session?<div className="row wrap"><Button kind="soft" busy={busy} onClick={()=>onAction('movement',{kind,amount}).then(()=>setAmount('0,00'))}>Registrar movimento</Button><Button kind="primary" busy={busy} onClick={()=>onAction('close',{amount}).then(()=>setAmount('0,00'))}>Fechar caixa</Button></div>:<Button kind="primary block" busy={busy} onClick={()=>onAction('open',{amount}).then(()=>setAmount('0,00'))}>Abrir caixa</Button>}</Panel><Panel title="Resumo da sessão"><p className="eyebrow">DINHEIRO ESPERADO</p><p className="hero-number">{centsLabel(session?.expectedCents||0)}</p><div className="list-row"><span>Fundo de troco</span><strong>{centsLabel(session?.openingCents||0)}</strong></div><div className="list-row"><span>Status</span><Pill tone={session?'green':'red'}>{session?'Aberto':'Fechado'}</Pill></div><p className="help">Diferenças de caixa são apuradas no host após informar o valor contado.</p></Panel></div></Frame>
}
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
const Dashboard=lazy(()=>import('./ManagementTangerine.jsx').then(module=>({default:module.ManagementOverview})));
function Users({onAdd,busy,user}){const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[role,setRole]=useState('cashier');return <Frame eyebrow="SEGURANÇA / OPERADORES" title="Usuários e permissões" description="Contas locais. Senhas nunca são enviadas a serviços externos."><Panel title="Novo operador"><form className="form-grid" onSubmit={e=>{e.preventDefault();onAdd({username,password,role}).then(()=>{setUsername('');setPassword('')}).catch(()=>{});}}><label className="field">Usuário<input value={username} onChange={e=>setUsername(e.target.value)} pattern="[a-zA-Z0-9._-]{3,40}" required disabled={!isAdmin(user)}/></label><label className="field">Senha temporária<input value={password} onChange={e=>setPassword(e.target.value)} type="password" minLength={12} required disabled={!isAdmin(user)}/></label><label className="field">Perfil<select value={role} onChange={e=>setRole(e.target.value)} disabled={!isAdmin(user)}><option value="cashier">Caixa</option><option value="admin">Supervisor</option></select></label><button className="btn primary" disabled={!isAdmin(user)||busy}>Criar operador</button></form><p className="help">Somente supervisor pode criar contas. O servidor realiza a autorização efetiva.</p></Panel></Frame>}
function Printing({mode,onSave,busy,jobs}){
 const [transport,setTransport]=useState('tcp'),[host,setHost]=useState(''),[port,setPort]=useState('9100');
 const [devicePath,setDevicePath]=useState(''),[baudRate,setBaudRate]=useState('9600');
 return <Frame eyebrow="CONFIGURAÇÕES / HARDWARE" title="Impressão" description="Fila ESC/POS. TCP ou serial/COM opcional; impressão física exige homologação.">
  <Panel title="Configurar impressora"><form className="form-grid" onSubmit={e=>{e.preventDefault();onSave(transport==='tcp'?{transport,host,port:Number(port)}:transport==='serial'?{transport,devicePath,baudRate:Number(baudRate)}:{transport,devicePath}).catch(()=>{});}}>
   <label className="field">Transporte<select value={transport} onChange={e=>setTransport(e.target.value)}><option value="tcp">Rede TCP</option><option value="serial">USB serial / COM (driver opcional)</option><option value="windows">Impressora instalada no Windows (RAW)</option></select></label>
   {transport==='tcp'?<><label className="field">IPv4 privado<input value={host} onChange={e=>setHost(e.target.value)} required placeholder="192.168.1.100"/></label><label className="field">Porta TCP<input value={port} onChange={e=>setPort(e.target.value)} type="number" min="1" max="65535" required/></label></>:<><label className="field">Porta serial ou fila Windows<input value={devicePath} onChange={e=>setDevicePath(e.target.value)} required placeholder="COM3, /dev/ttyUSB0 ou Epson TM-T20"/></label>{transport==='serial'&&<label className="field">Baud rate<select value={baudRate} onChange={e=>setBaudRate(e.target.value)}>{[9600,19200,38400,57600,115200].map(n=><option key={n} value={n}>{n}</option>)}</select></label>}</>}
   <button className="btn primary" disabled={mode!=='live'||busy}>Salvar impressora</button>
  </form><p className="help">USB serial requer driver opcional serialport; filas USB instaladas no Windows usam Winspool RAW. Compatibilidade física depende do modelo.</p></Panel>
  <Panel title="Fila de impressão">{jobs.length?jobs.map(j=><div className="list-row" key={j.id}><span>#{j.orderId?.slice(-8)}</span><Pill tone={j.status==='DONE'?'green':'orange'}>{j.status}</Pill></div>):<Empty>Nenhum trabalho de impressão consultado.</Empty>}<p className="help">Envio de bytes não confirma que o papel saiu.</p></Panel>
 </Frame>;
}
function Exports({mode}){return <Frame eyebrow="CONTABILIDADE / EXPORTAÇÃO" title="Exportar vendas" description="Dados operacionais CSV/JSON para emissão fiscal externa quando aplicável."><Panel><Pill tone="orange">Não emite NFC-e ou NF-e</Pill><p className="subtext gap-top">Exportação disponível somente no host local autenticado. Arquivos não substituem documento fiscal.</p><div className="row wrap">{mode==='live'?<><a className="btn primary" href="/api/exports/sales.csv">Baixar CSV</a><a className="btn secondary" href="/api/exports/sales.json">Baixar JSON</a></>:<Empty>Conecte o host para exportar dados reais.</Empty>}</div></Panel></Frame>}
const navIcons={venda:ShoppingCart,pedidos:ClipboardList,produtos:Package,mesas:UtensilsCrossed,delivery:Truck,kds:ChefHat,garcom:Smartphone,divisao:UsersIcon,caixa:Wallet,geral:LayoutDashboard,estoque:Boxes,financeiro:ChartBar,relatorios:ChartBar,unidades:Store,privacidade:Shield,usuarios:UsersIcon,integracoes:Cable,dispositivos:Monitor,impressao:Printer,sistema:Settings,exportacao:Download,'primeiro-acesso':BookOpen};
function App(){
 const [mode,setMode]=useState('boot'),[user,setUser]=useState(null),[needsSetup,setNeedsSetup]=useState(false),[loginError,setLoginError]=useState('');
 const [view,setView]=useState('venda'),[products,setProducts]=useState(sampleProducts),[categories,setCategories]=useState(sampleCategories.slice(1)),[orders,setOrders]=useState(sampleOrders),[tables,setTables]=useState(sampleTables),[tickets,setTickets]=useState(sampleTickets);
 const [session,setSession]=useState(null),[order,setOrder]=useState(null),[selected,setSelected]=useState(null),[modal,setModal]=useState(null),[doneOrder,setDoneOrder]=useState(null),[jobs,setJobs]=useState([]);
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stockRevision,setStockRevision]=useState(0);
 const [sidebarOpen,setSidebarOpen]=useState(false);const working=useRef(false);
 const [token,setToken]=useState(()=>sessionStorage.getItem('pdv-nexus-token')||'');
 const [pairedRole,setPairedRole]=useState(()=>sessionStorage.getItem('pdv-nexus-role')||'');
 const api=useMemo(()=>authFor(token),[token]);
 const deviceParam=new URLSearchParams(window.location.search).get('device');
 const deviceRole=deviceParam==='kitchen'?'kitchen':'waiter';
 const remote=!['localhost','127.0.0.1'].includes(window.location.hostname);
 const boot=useCallback(async()=>{
   setMode('boot');setError('');
   if(remote||['waiter','kitchen'].includes(deviceParam)){
     const existing=sessionStorage.getItem('pdv-nexus-token')||'';
     const role=sessionStorage.getItem('pdv-nexus-role')||deviceRole;
     if(existing&&['waiter','kitchen'].includes(role)){
       try{await request('/api/health',{token:existing});
         setToken(existing);setPairedRole(role);setUser({role});setMode('paired');
         setView(role==='kitchen'?'kds':'garcom');return;
       }catch{sessionStorage.removeItem('pdv-nexus-token');sessionStorage.removeItem('pdv-nexus-role');}
     }
     setMode('pairing');return;
   }
   try{const data=await request('/api/auth/status');
      if(data.authenticated){setUser(data.user);setMode('live');}
      else{setNeedsSetup(!!data.needsSetup);setMode('auth');}
   }catch{setMode(embedded?'offline':'demo');setError(embedded?'Host local indisponível. As vendas estão bloqueadas; reconecte o PDV.':'Host local indisponível. Interface em modo demonstrativo, sem persistência.');}
 },[deviceParam,deviceRole,remote]);
 useEffect(()=>{void boot()},[boot]);
 const refresh=useCallback(async()=>{if(mode!=='live'&&mode!=='paired')return;const requests=mode==='paired'?(pairedRole==='kitchen'?[['tickets','/api/kitchen/tickets']]:[['products','/api/products'],['orders','/api/orders'],['tables','/api/tables']]):[['products','/api/products'],['categories','/api/categories'],['orders','/api/orders'],['cash','/api/cash/current'],['tables','/api/tables'],['tickets','/api/kitchen/tickets'],['print','/api/print/jobs']];const result=await Promise.allSettled(requests.map(async ([key,path])=>({key,data:await api(path)})));let failed=[];for(let i=0;i<result.length;i++){const state=result[i];if(state.status!=='fulfilled'){failed.push(requests[i][0]);continue;}const {key,data}=state.value;if(key==='products')setProducts(data.products||[]);if(key==='categories')setCategories(data.categories||[]);if(key==='orders')setOrders(data.orders||[]);if(key==='cash')setSession(data.session||null);if(key==='tables')setTables(data.tables||[]);if(key==='tickets')setTickets(data.tickets||[]);if(key==='print')setJobs(data.jobs||[]);}if(failed.length)setError(`Alguns módulos não puderam ser atualizados: ${failed.join(', ')}. Verifique permissões e conexão.`);},[api,mode,pairedRole]);
 useEffect(()=>{if(mode==='live'||mode==='paired')void refresh().catch(e=>setError(toStringError(e)))},[mode,refresh]);
 useEffect(()=>{if((mode!=='live'&&mode!=='paired')||view!=='kds')return;const timer=setInterval(()=>void api('/api/kitchen/tickets').then(d=>setTickets(d.tickets||[])).catch(e=>setError(toStringError(e))),8000);return()=>clearInterval(timer)},[mode,view,api]);
 const run=useCallback(async(task)=>{if(working.current)return Promise.reject(new Error('Operação em andamento'));working.current=true;setBusy(true);setNotice('');setError('');try{return await task();}catch(e){setError(toStringError(e));throw e;}finally{working.current=false;setBusy(false);}},[]);
 const isDemo=mode==='demo';
 const navigate=id=>{setView(id);setNotice('');setError('');};
 const login=async(username,password)=>{await run(async()=>{const data=await request(needsSetup?'/api/auth/setup':'/api/auth/login',{method:'POST',body:{username,password}});setUser(data.user);setMode('live');setLoginError('');}).catch(e=>setLoginError(toStringError(e)));};
 const logout=()=>{if(mode==='paired'){sessionStorage.removeItem('pdv-nexus-token');sessionStorage.removeItem('pdv-nexus-role');setToken('');setPairedRole('');setUser(null);setOrder(null);setMode('pairing');return;}void run(async()=>{await request('/api/auth/logout',{method:'POST',body:{}});setUser(null);setMode('auth');setOrder(null);}).catch(()=>{});};
 const chooseProduct=p=>{if(order?.status==='OPEN'){setError('Pedido confirmado. Use a comanda para adicionar itens ou inicie uma nova venda.');return;}setModal({type:'product',product:p});};
 const addProduct=async(options)=>run(async()=>{
  if(isDemo){const before=!order||['CLOSED','CANCELLED'].includes(order.status)?demoOrder():order;setOrder(appendDemoLine(before,options.product,options.quantity,options));setModal(null);setNotice('Item adicionado à prévia, não salvo no banco.');return;}
  let current=order;if(!current||['CLOSED','CANCELLED'].includes(current.status))current=(await api('/api/orders',{method:'POST',body:{commandId:commandId(),serviceMode:'counter'}})).order;
  const result=await api(`/api/orders/${current.id}/lines`,{method:'POST',body:{commandId:commandId(),expectedRevision:current.revision,productId:options.product.id,quantity:options.quantity,modifierIds:options.modifierIds,note:options.note}});
  setOrder(result.order);setModal(null);setNotice('Item registrado no pedido.');
 }).catch(()=>{});
 const confirm=()=>run(async()=>{if(!order?.lines?.length)throw Error('Pedido sem itens');if(isDemo){setOrder({...order,status:'OPEN',revision:order.revision+1});setNotice('Pedido confirmado somente na prévia.');return;}const result=await api(`/api/orders/${order.id}/confirm`,{method:'POST',body:{commandId:commandId(),expectedRevision:order.revision}});setOrder(result.order);setNotice('Pedido confirmado no host.');}).catch(()=>{});
 const cancel=()=>{const reason=window.prompt('Motivo do cancelamento (obrigatório):');if(reason===null)return;void run(async()=>{if(!reason.trim())throw Error('Informe o motivo do cancelamento');if(isDemo){setOrder({...order,status:'CANCELLED'});return;}const result=await api(`/api/orders/${order.id}/cancel`,{method:'POST',body:{commandId:commandId(),expectedRevision:order.revision,reason:reason.trim()}});setOrder(result.order);setNotice('Pedido cancelado no host.');}).catch(()=>{});};
 const pay=async(payments)=>run(async()=>{if(!order||order.status!=='OPEN')throw Error('Confirme o pedido antes do pagamento');if(!session&&!isDemo)throw Error('Abra o caixa para receber pagamento');if(isDemo){const closed={...order,status:'CLOSED'};setOrder(closed);setDoneOrder(closed);setModal(null);setView('concluida');setNotice('Prévia de venda: não houve pagamento real.');return;}const result=await api(`/api/orders/${order.id}/close`,{method:'POST',body:{commandId:commandId(),expectedRevision:order.revision,payments}});setOrder(result.order);setDoneOrder(result.order);setModal(null);setView('concluida');setNotice(`Venda gravada · troco ${centsLabel(result.changeCents)}`);await refresh();}).catch(()=>{});
 const openOrder=o=>run(async()=>{if(isDemo){setOrder({...demoOrder(),id:o.id,status:o.status,serviceMode:o.serviceMode,revision:o.revision});setView('venda');return;}const data=await api(`/api/orders/${o.id}`);setOrder(data.order);setView('venda');}).catch(()=>{});
 const refundOrder=o=>{
   const reason=window.prompt('Motivo da devolução integral (obrigatório):');
   if(reason===null)return;
   if(!reason.trim()){setError('Informe o motivo da devolução');return;}
   const externalRefundConfirmed=window.confirm('Se a venda contém Pix ou cartão, a devolução foi feita e confirmada manualmente? Clique em Cancelar para não afirmar essa confirmação.');
   if(!window.confirm('Confirmar devolução integral da venda #'+o.id.slice(-8)+'? O registro é auditado e não pode ser repetido.'))return;
   void run(async()=>{
     await api('/api/orders/'+encodeURIComponent(o.id)+'/refund',{method:'POST',body:{commandId:commandId(),reason:reason.trim(),externalRefundConfirmed}});
     setNotice('Devolução integral registrada. A saída financeira foi conciliada pelo host.');
     await refresh();
   }).catch(()=>{});
 };
 const addCategory=async(name)=>run(async()=>{if(isDemo){setCategories(s=>[...s,{id:`demo-cat-${Date.now()}`,name,active:1}]);setNotice('Categoria criada apenas na prévia.');return;}await api('/api/categories',{method:'POST',body:{commandId:commandId(),name}});await refresh();setNotice('Categoria salva.');});
 const addCatalogProduct=async({name,price,categoryId,barcode})=>run(async()=>{const priceCents=parseMoney(price);if(isDemo){setProducts(s=>[...s,{id:`demo-p-${Date.now()}`,name,priceCents,categoryId,active:1}]);setNotice('Produto criado apenas na prévia.');return;}await api('/api/products',{method:'POST',body:{commandId:commandId(),name,priceCents,categoryId,barcode:barcode||null}});await refresh();setNotice('Produto cadastrado.');});
 const toggleProduct=p=>run(async()=>{if(isDemo){setProducts(s=>s.map(x=>x.id===p.id?{...x,active:x.active?0:1}:x));return;}await api(`/api/products/${p.id}`,{method:'PATCH',body:{commandId:commandId(),active:!p.active}});await refresh();setNotice('Disponibilidade atualizada.');}).catch(()=>{});
 const cashAction=(kind,{amount,kind:movementKind})=>run(async()=>{const value=parseMoney(amount);if(isDemo){if(kind==='open')setSession({id:'demo-cash',status:'OPEN',openingCents:value,expectedCents:value});if(kind==='close')setSession(null);if(kind==='movement')setSession(s=>({...s,expectedCents:s.expectedCents+(movementKind==='SUPPLY'?value:-value)}));setNotice('Movimentação simulada; não foi salva no banco.');return;}const path={open:'/api/cash/open',close:'/api/cash/close',movement:'/api/cash/movements'}[kind];const body=kind==='open'?{commandId:commandId(),openingCents:value}:kind==='close'?{commandId:commandId(),countedCents:value}:{commandId:commandId(),kind:movementKind,amountCents:value};const res=await api(path,{method:'POST',body});await refresh();setNotice(kind==='close'?`Caixa fechado · diferença ${centsLabel(res.differenceCents)}`:'Caixa atualizado.');});
 const openTable=t=>run(async()=>{setSelected(t);if(isDemo){setNotice('Mesa selecionada somente na prévia.');return;}const data=await api(`/api/tables/${t.id}/open`,{method:'POST',body:{commandId:commandId()}});setOrder(data.order);setView('divisao');await refresh();setNotice('Comanda vinculada à mesa.');}).catch(()=>{});
 const createTable=label=>run(async()=>{if(isDemo){setTables(s=>[...s,{id:`demo-t-${Date.now()}`,label,orderId:null}]);return;}await api('/api/tables',{method:'POST',body:{commandId:commandId(),label}});await refresh();setNotice('Mesa criada.');});
 const updateTicket=(ticket,status)=>run(async()=>{if(isDemo){setTickets(s=>s.map(t=>t.id===ticket.id?{...t,status,revision:t.revision+1}:t));setNotice('Estado demonstrativo atualizado.');return;}await api(`/api/kitchen/tickets/${ticket.id}/status`,{method:'POST',body:{commandId:commandId(),expectedRevision:ticket.revision,status}});const data=await api('/api/kitchen/tickets');setTickets(data.tickets||[]);setNotice('Estado da cozinha confirmado.');}).catch(()=>{});
 const addOperator=payload=>run(async()=>{if(isDemo){setNotice('Prévia: nenhum operador criado.');return;}await api('/api/auth/operators',{method:'POST',body:{...payload,commandId:commandId()}});setNotice('Operador criado no host.');});
 const startPair=payload=>run(async()=>{if(isDemo)throw Error('Pareamento exige host');const r=await api('/api/pairing/start',{method:'POST',body:{commandId:commandId(),role:payload.role,label:payload.label}});setNotice('PIN gerado no host.');return r.code||r.pin||'Consulte o servidor';});
 const savePrinter=payload=>run(async()=>{if(isDemo)throw Error('Configure uma impressora no host, não na prévia');await api('/api/printer',{method:'POST',body:{commandId:commandId(),...payload}});setNotice('Impressora configurada no host.');});
 useEffect(()=>{const onKey=e=>{if(e.key==='F3'){e.preventDefault();document.querySelector('.searchfield input')?.focus();}if(e.key==='F10'&&view==='venda'&&order?.status==='OPEN'){e.preventDefault();setModal({type:'payment'});}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[view,order]);
 if(mode==='boot')return <div className="loading">Conectando ao PDV Nexus local…</div>;
 if(mode==='offline')return <main className="authpage"><section className="authcard" role="alert"><h1>Caixa indisponível</h1><p>O host SQLite local não respondeu. Nenhuma venda foi registrada. O aplicativo não entra em modo demonstrativo no Electron.</p><Button kind="primary" onClick={boot}>Tentar novamente</Button></section></main>;
 if(mode==='auth')return <Login setup={needsSetup} onSubmit={login} busy={busy} error={loginError}/>;
 if(mode==='pairing')return <PairDevice role={deviceRole} onPaired={(nextToken,role)=>{setToken(nextToken);setPairedRole(role);setUser({role});setView(role==='kitchen'?'kds':'garcom');setMode('paired');}}/>;
 const restricted=new Set(['produtos','caixa','geral','estoque','financeiro','relatorios','unidades','privacidade','delivery','usuarios','integracoes','dispositivos','impressao','sistema','exportacao','primeiro-acesso']);
 const canEdit=mode!=='paired'&&isAdmin(user);const allowedLinks=mode==='paired'?links.filter(([id])=>pairedRole==='kitchen'?id==='kds':['garcom','divisao'].includes(id)):links.filter(([id])=>!restricted.has(id)||canEdit);
 const page=()=>{switch(view){
 case 'venda':return <Sale products={products} categories={categories} order={order} onChoose={chooseProduct} onConfirm={confirm} onCancel={cancel} onPay={()=>{if(!session&&!isDemo){setError('Abra o caixa antes de receber pagamento');setView('caixa');}else setModal({type:'payment'})}} onNew={()=>{setOrder(null);setView('venda')}} busy={busy} mode={mode}/>;
 case 'concluida':return <Success order={doneOrder} onNew={()=>{setOrder(null);setView('venda')}}/>;
 case 'pedidos':return <Orders orders={orders} onOpen={openOrder} onRefresh={()=>void refresh()} onRefund={refundOrder} canRefund={canEdit} busy={busy}/>;
 case 'produtos':return <div className="stack"><Products products={products} categories={categories} onAddProduct={addCatalogProduct} onAddCategory={addCategory} onToggle={toggleProduct} busy={busy} canEdit={canEdit}/><CatalogToolsPanel mode={mode} api={api} categories={categories} products={products} onRefresh={refresh}/></div>;
 case 'caixa':return <Cash session={session} onAction={cashAction} busy={busy}/>;
 case 'mesas':return <Tables tables={tables} selected={selected} onSelect={openTable} onNew={createTable} busy={busy}/>;
 case 'kds':return <Kitchen tickets={tickets} onUpdate={updateTicket} onRefresh={()=>void refresh()} busy={busy}/>;
 case 'garcom':return <Waiter tables={tables} products={products} onOpenTable={openTable} busy={busy}/>;
 case 'divisao':return <TableOrderPanel order={order} tables={tables} products={products} api={api} mode={mode} onUpdate={next=>{setOrder(next);void refresh();}} onBack={()=>{setView(mode==='paired'?'garcom':'mesas');void refresh();}} onCheckout={selectedOrder=>{setOrder(selectedOrder);setModal({type:'payment'});}} session={session}/>;
 case 'primeiro-acesso':return <Onboarding mode={mode} api={api}/>;
 case 'geral':return <Suspense fallback={<p className="subtext">Carregando gestão local...</p>}><Dashboard orders={orders} session={session} tables={tables} onGo={navigate} api={api} mode={mode}/></Suspense>;
 case 'estoque':return <div className="stack"><StockBusiness mode={mode} api={api} onChanged={()=>setStockRevision(v=>v+1)} reloadKey={stockRevision}/><AdvancedStockPanel mode={mode} api={api} onChanged={()=>setStockRevision(v=>v+1)} reloadKey={stockRevision}/></div>;
 case 'financeiro':return <FinanceBusiness mode={mode} api={api}/>;
 case 'relatorios':return <FinanceBusiness mode={mode} api={api} section="relatorios"/>;
 case 'delivery':return <DeliveryPanel mode={mode} api={api}/>;
 case 'unidades':return <UnitsPanel mode={mode} api={api}/>;
 case 'privacidade':return <DeliveryPanel mode={mode} api={api} section="privacidade"/>;
 case 'usuarios':return <Users onAdd={addOperator} busy={busy} user={user}/>;
 case 'integracoes':return <HardwareToolsPanel mode={mode} api={api}/>;
 case 'dispositivos':return <PairedDevicesPanel api={api} mode={mode}/>;
 case 'impressao':return <Printing mode={mode} onSave={savePrinter} busy={busy} jobs={jobs}/>;
 case 'sistema':return <Maintenance mode={mode} api={api}/>;
 case 'exportacao':return <Exports mode={mode}/>;
 default:return <Sale products={products} categories={categories} order={order} onChoose={chooseProduct} onConfirm={confirm} onCancel={cancel} onPay={()=>setModal({type:'payment'})} onNew={()=>setOrder(null)} busy={busy} mode={mode}/>;
 }};
 return <AppShell header={{height:72}} navbar={{width:232,breakpoint:'sm',collapsed:{mobile:!sidebarOpen}}} padding={0} className="app nexus-app-shell">
 <AppShell.Header className="topbar">
   <div className="brand"><span className="brand-icon"><ShoppingCart size={22}/></span><strong>PDV Nexus <em>2.0</em></strong></div>
   <div className="top-title">PDV — {titleOf(view)}</div>
   <div className="top-right"><span className="top-status"><span className="dot"/>{mode==='paired'?'Dispositivo pareado':mode==='live'?'Caixa 01 · Host conectado':'Demonstração'}</span>
     {mode==='demo'?<Button kind="top" onClick={boot}>Conectar host</Button>:<Button kind="top" onClick={logout}>{initials(user?.username)} · Sair</Button>}
     <Burger className="nexus-mobile-burger" opened={sidebarOpen} onClick={()=>setSidebarOpen(v=>!v)} size="sm" aria-label="Abrir ou fechar o menu"/>
   </div>
 </AppShell.Header>
 <AppShell.Navbar className="sidebar"><nav aria-label="Navegação principal">
  {allowedLinks.map(([id,_icon,label,group],i)=>{const Icon=navIcons[id]||Package;return <React.Fragment key={id}>
    {(i===0||allowedLinks[i-1]?.[3]!==group)&&<div className="nav-group">{group}</div>}
    <NavLink component="button" type="button" active={view===id} variant="light"
      className={'nav-item '+(view===id?'active':'')} leftSection={<Icon size={18} strokeWidth={1.8}/>}
      label={label} onClick={()=>{navigate(id);setSidebarOpen(false);}}
      aria-current={view===id?'page':undefined}/>
  </React.Fragment>})}
 </nav><p className="sidebar-foot">PDV Nexus 2.0 · Interface unificada<br/><span>R$ 0 · self-hosted</span></p></AppShell.Navbar>
 <AppShell.Main className="main-area">
  {mode==='demo'&&<div className="demo-banner" role="status">Prévia visual: sem conexão com host. Nenhum dado ou pagamento desta tela é persistido.</div>}
  {error&&<div className="errorbox" role="alert"><span>{error}</span><Button kind="icon" onClick={()=>setError('')} aria-label="Dispensar erro">×</Button></div>}
  {notice&&<div className="notice" role="status"><span>{notice}</span><Button kind="icon" onClick={()=>setNotice('')} aria-label="Dispensar aviso">×</Button></div>}
  {page()}
 </AppShell.Main>
 {modal?.type==='product'&&<ProductModal product={modal.product} requester={api} demo={isDemo} busy={busy} onClose={()=>setModal(null)} onSubmit={addProduct}/>}
 {modal?.type==='payment'&&<PaymentModal order={order} onClose={()=>setModal(null)} onPay={pay} busy={busy}/>}
 </AppShell>
}
export default App;
