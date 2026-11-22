import React,{useCallback,useEffect,useMemo,useRef,useState,lazy,Suspense} from 'react';
import {AppShell,Burger,NavLink} from '@mantine/core';
import {ShoppingCart,ClipboardList,Package,UtensilsCrossed,Truck,ChefHat,Smartphone,Wallet,LayoutDashboard,Boxes,ChartBar,Store,Shield,Printer,Settings,Download,Monitor,Users as UsersIcon,BookOpen,Cable} from 'lucide-react';
import {PosSale as Sale,PosPaymentModal as PaymentModal,PosProductModal as ProductModal} from './PosExperience.jsx';
import {request,authFor,commandId} from './api.mjs';
import {canAccessExistingWork,canCreateNewWork} from './licenseUiPolicy.mjs';
import {createCommandIntentStore} from './commandIntent.mjs';
import {formatMoney,parseMoney,appendDemoLine,DEMO_ORDER} from './model.mjs';
import {sampleCategories,sampleProducts,sampleOrders,sampleTables,sampleTickets} from './demo.mjs';
import {Button} from './UIPrimitives.jsx';
import {Login,Success,Orders,Products} from './CommerceScreens.jsx';
import {Cash} from './RestaurantScreens.jsx';
import {RestaurantTables as Tables,RestaurantKitchen as Kitchen,RestaurantWaiter as Waiter} from './RestaurantTangerine.jsx';
import {Onboarding,Users,Printing,Exports} from './AdminScreens.jsx';
const Dashboard=lazy(()=>import('./ManagementTangerine.jsx').then(module=>({default:module.ManagementOverview})));
const Intelligence=lazy(()=>import('./BusinessIntelligence.jsx').then(module=>({default:module.BusinessIntelligence})));

import {availableNavLinks,titleOf} from './navigation.mjs';
import {useHostRefresh,useKitchenPolling,useBusyCommand} from './useOperations.jsx';
import {StockBusiness,FinanceBusiness} from './BusinessPanels.jsx';
import {Maintenance} from './Maintenance.jsx';
import {DeliveryPanel,UnitsPanel} from './OperationalPanels.jsx';
import {AdvancedStockPanel} from './AdvancedStockPanel.jsx';
import {CatalogToolsPanel,HardwareToolsPanel} from './CatalogToolsPanel.jsx';
import {TableOrderPanel} from './TableOrderPanel.jsx';
import {PizzeriaSettings,KitchenStationsManager,PartialRefundDialog} from './RestaurantAdminPanels.jsx';
import {SaleUnitsConfig} from './SaleUnitsConfig.jsx';
import {PairDevice} from './PairDevice.jsx';
import {LicenseOnboarding} from './LicenseOnboarding.jsx';
import {OperationDialog} from './OperationDialog.jsx';
import {PairedDevicesPanel} from './PairedDevicesPanel.jsx';
import {AttendancePanel,WaiterReadyAlerts} from './AttendancePanel.jsx';
import {TabletAdminPanel} from './TabletAdminPanel.jsx';

const demoOrder=()=>({...DEMO_ORDER,lines:[]});
const toStringError=e=>e instanceof Error?e.message:'Falha não identificada';
const isAdmin=user=>!user||user.role==='admin';
const embedded=new URLSearchParams(window.location.search).has('embedded');
const centsLabel=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const initials=s=>(s||'Nexus').split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase();

const navIcons={venda:ShoppingCart,pedidos:ClipboardList,produtos:Package,mesas:UtensilsCrossed,delivery:Truck,kds:ChefHat,garcom:Smartphone,atendimento:ClipboardList,divisao:UsersIcon,caixa:Wallet,geral:LayoutDashboard,estoque:Boxes,financeiro:ChartBar,relatorios:ChartBar,inteligencia:ChartBar,unidades:Store,privacidade:Shield,usuarios:UsersIcon,integracoes:Cable,dispositivos:Monitor,impressao:Printer,sistema:Settings,exportacao:Download,'primeiro-acesso':BookOpen};
function App(){
 const [mode,setMode]=useState('boot'),[user,setUser]=useState(null),[needsSetup,setNeedsSetup]=useState(false),[loginError,setLoginError]=useState('');
 const [licenseInfo,setLicenseInfo]=useState(null);
 const [view,setView]=useState('venda'),[products,setProducts]=useState(sampleProducts),[categories,setCategories]=useState(sampleCategories.slice(1)),[orders,setOrders]=useState(sampleOrders),[tables,setTables]=useState(sampleTables),[tickets,setTickets]=useState(sampleTickets);
 const [session,setSession]=useState(null),[order,setOrder]=useState(null),[selected,setSelected]=useState(null),[modal,setModal]=useState(null),[doneOrder,setDoneOrder]=useState(null),[jobs,setJobs]=useState([]);
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stockRevision,setStockRevision]=useState(0);
 const [sidebarOpen,setSidebarOpen]=useState(false);
 const [token,setToken]=useState(()=>sessionStorage.getItem('pdv-nexus-token')||'');
 const [pairedRole,setPairedRole]=useState(()=>sessionStorage.getItem('pdv-nexus-role')||'');
 const api=useMemo(()=>authFor(token),[token]);
 const pendingCommands=useRef(null);
 if(!pendingCommands.current)pendingCommands.current=createCommandIntentStore(commandId);
 const issue=async(route,body,scope=route,method='POST')=>{
   const intent=pendingCommands.current.reserve(scope,{route,method,body});
   const result=await api(route,{method,body:{...body,commandId:intent.commandId}});
   pendingCommands.current.ack(intent);
   return result;
 };
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
   try{const license=await request('/api/license/status');setLicenseInfo(license);
      if(!canAccessExistingWork(license)){setMode('license');return;}
      const data=await request('/api/auth/status');
      if(data.authenticated){setUser(data.user);setMode('live');}
      else{setNeedsSetup(!!data.needsSetup);setMode('auth');}
   }catch{setMode(embedded?'offline':'demo');setError(embedded?'Host local indisponível. As vendas estão bloqueadas; reconecte o PDV.':'Host local indisponível. Interface em modo demonstrativo, sem persistência.');}
 },[deviceParam,deviceRole,remote]);
 useEffect(()=>{void boot()},[boot]);
 const refresh=useHostRefresh({api,mode,pairedRole,setProducts,setCategories,setOrders,setSession,setTables,setTickets,setJobs,setError});
 useEffect(()=>{if(mode==='live'||mode==='paired')void refresh().catch(e=>setError(toStringError(e)))},[mode,refresh]);
 useEffect(()=>{if(mode!=='live'||!licenseInfo?.required)return;const timer=setInterval(()=>{void request('/api/license/status').then(setLicenseInfo).catch(()=>{})},60000);return()=>clearInterval(timer)},[mode,licenseInfo?.required]);
 useKitchenPolling({api,mode,view,setTickets,setError,token:mode==='paired'?token:null});
 const run=useBusyCommand({setBusy,setNotice,setError});
 const isDemo=mode==='demo';
 const closingOnly=licenseInfo?.required&&!canCreateNewWork(licenseInfo);
 const navigate=id=>{setView(id);setNotice('');setError('');};
 const login=async(username,password)=>{await run(async()=>{const data=await request(needsSetup?'/api/auth/setup':'/api/auth/login',{method:'POST',body:{username,password}});setUser(data.user);setMode('live');setLoginError('');}).catch(e=>setLoginError(toStringError(e)));};
 const logout=()=>{if(mode==='paired'){sessionStorage.removeItem('pdv-nexus-token');sessionStorage.removeItem('pdv-nexus-role');setToken('');setPairedRole('');setUser(null);setOrder(null);setMode('pairing');return;}void run(async()=>{await request('/api/auth/logout',{method:'POST',body:{}});setUser(null);setMode('auth');setOrder(null);}).catch(()=>{});};
 const chooseProduct=p=>{if(closingOnly&&(!order||['CLOSED','CANCELLED'].includes(order.status))){setError('Licença vencida: novos pedidos bloqueados. É possível encerrar vendas existentes.');return;}if(order?.status==='OPEN'){setError('Pedido confirmado. Use a comanda para adicionar itens ou inicie uma nova venda.');return;}setModal({type:'product',product:p});};
 const addProduct=async(options)=>run(async()=>{
  if(isDemo){const before=!order||['CLOSED','CANCELLED'].includes(order.status)?demoOrder():order;setOrder(appendDemoLine(before,options.product,options.quantity,options));setModal(null);setNotice('Item adicionado à prévia, não salvo no banco.');return;}
  let current=order;if(!current||['CLOSED','CANCELLED'].includes(current.status)){if(closingOnly)throw Error('Novos pedidos indisponíveis até reativar a licença');current=(await issue('/api/orders',{serviceMode:'counter'},'sale:create')).order;setOrder(current);}
  const result=await issue(`/api/orders/${current.id}/lines`,{expectedRevision:current.revision,productId:options.product.id,quantity:options.quantity,modifierIds:options.modifierIds,note:options.note});
  setOrder(result.order);setModal(null);setNotice('Item registrado no pedido.');
 }).catch(()=>{});
 const confirm=()=>run(async()=>{if(!order?.lines?.length)throw Error('Pedido sem itens');if(isDemo){setOrder({...order,status:'OPEN',revision:order.revision+1});setNotice('Pedido confirmado somente na prévia.');return;}const result=await issue(`/api/orders/${order.id}/confirm`,{expectedRevision:order.revision});setOrder(result.order);setNotice('Pedido confirmado no host.');}).catch(()=>{});
 const cancel=()=>{if(!order)return;setModal({type:'cancel',order});};
 const pay=async(payments,inventoryOverrideReason=null)=>run(async()=>{if(!order||order.status!=='OPEN')throw Error('Confirme o pedido antes do pagamento');if(!session&&!isDemo)throw Error('Abra o caixa para receber pagamento');if(isDemo){const closed={...order,status:'CLOSED'};setOrder(closed);setDoneOrder(closed);setModal(null);setView('concluida');setNotice('Prévia de venda: não houve pagamento real.');return;}const result=await issue(`/api/orders/${order.id}/close`,{expectedRevision:order.revision,payments,...(inventoryOverrideReason?{inventoryOverrideReason}:{})});setOrder(result.order);setDoneOrder(result.order);setModal(null);setView('concluida');setNotice(`Venda gravada · troco ${centsLabel(result.changeCents)}`);await refresh();}).catch(()=>{});
 const openOrder=o=>run(async()=>{if(isDemo){setOrder({...demoOrder(),id:o.id,status:o.status,serviceMode:o.serviceMode,revision:o.revision});setView('venda');return;}const data=await api(`/api/orders/${o.id}`);setOrder(data.order);setView('venda');}).catch(()=>{});
 const refundOrder=o=>setModal({type:'refund',order:o});
 const submitOperation=async({reason,externalRefundConfirmed})=>{
   const target=modal?.order;
   if(!target)throw Error('Pedido não selecionado');
   if(modal.type==='cancel'){
     await run(async()=>{
       if(isDemo){setOrder({...target,status:'CANCELLED'});return;}
       const result=await issue(`/api/orders/${target.id}/cancel`,{expectedRevision:target.revision,reason});
       setOrder(result.order);setNotice('Pedido cancelado no host.');
       await refresh();
     });
   }else if(modal.type==='refund'){
     await run(async()=>{
       if(isDemo)throw Error('Devolução exige host local');
       await issue('/api/orders/'+encodeURIComponent(target.id)+'/refund',{reason,externalRefundConfirmed});
       setNotice('Devolução integral registrada no host.');
       await refresh();
     });
   }else throw Error('Operação inválida');
   setModal(null);
 };
 const addCategory=async(name)=>run(async()=>{if(isDemo){setCategories(s=>[...s,{id:`demo-cat-${Date.now()}`,name,active:1}]);setNotice('Categoria criada apenas na prévia.');return;}await issue('/api/categories',{name});await refresh();setNotice('Categoria salva.');});
 const addCatalogProduct=async({name,price,categoryId,barcode})=>run(async()=>{const priceCents=parseMoney(price);if(isDemo){setProducts(s=>[...s,{id:`demo-p-${Date.now()}`,name,priceCents,categoryId,active:1}]);setNotice('Produto criado apenas na prévia.');return;}await issue('/api/products',{name,priceCents,categoryId,barcode:barcode||null});await refresh();setNotice('Produto cadastrado.');});
 const toggleProduct=p=>run(async()=>{if(isDemo){setProducts(s=>s.map(x=>x.id===p.id?{...x,active:x.active?0:1}:x));return;}await issue(`/api/products/${p.id}`,{active:!p.active},`/api/products/${p.id}`,'PATCH');await refresh();setNotice('Disponibilidade atualizada.');}).catch(()=>{});
 const cashAction=(kind,{amount,kind:movementKind})=>run(async()=>{const value=parseMoney(amount);if(isDemo){if(kind==='open')setSession({id:'demo-cash',status:'OPEN',openingCents:value,expectedCents:value});if(kind==='close')setSession(null);if(kind==='movement')setSession(s=>({...s,expectedCents:s.expectedCents+(movementKind==='SUPPLY'?value:-value)}));setNotice('Movimentação simulada; não foi salva no banco.');return;}const path={open:'/api/cash/open',close:'/api/cash/close',movement:'/api/cash/movements'}[kind];const body=kind==='open'?{commandId:commandId(),openingCents:value}:kind==='close'?{commandId:commandId(),countedCents:value}:{commandId:commandId(),kind:movementKind,amountCents:value};const {commandId:_discarded,...payload}=body;const res=await issue(path,payload,'cash:'+kind+':'+(session?.id??'none'));await refresh();setNotice(kind==='close'?`Caixa fechado · diferença ${centsLabel(res.differenceCents)}`:'Caixa atualizado.');});
 const openTable=t=>run(async()=>{setSelected(t);if(isDemo){setNotice('Mesa selecionada somente na prévia.');return;}if(t.orderId){const data=await api('/api/orders/'+encodeURIComponent(t.orderId));setOrder(data.order);setView('divisao');await refresh();return;}
 if(closingOnly)throw Error('Não é possível abrir nova mesa com a licença vencida');
 const data=await issue(`/api/tables/${t.id}/open`,{});setOrder(data.order);setView('divisao');await refresh();setNotice('Comanda vinculada à mesa.');}).catch(()=>{});
 const createTable=label=>run(async()=>{if(isDemo){setTables(s=>[...s,{id:`demo-t-${Date.now()}`,label,orderId:null}]);return;}await issue('/api/tables',{label});await refresh();setNotice('Mesa criada.');});
 const updateTicket=(ticket,status)=>run(async()=>{if(isDemo){setTickets(s=>s.map(t=>t.id===ticket.id?{...t,status,revision:t.revision+1}:t));setNotice('Estado demonstrativo atualizado.');return;}await issue(`/api/kitchen/tickets/${ticket.id}/status`,{expectedRevision:ticket.revision,status});const data=await api('/api/kitchen/tickets');setTickets(data.tickets||[]);setNotice('Estado da cozinha confirmado.');return true;}).catch(()=>false);
 const addOperator=payload=>run(async()=>{if(isDemo){setNotice('Prévia: nenhum operador criado.');return;}await api('/api/auth/operators',{method:'POST',body:{...payload,commandId:commandId()}});setNotice('Operador criado no host.');});
 const startPair=payload=>run(async()=>{if(isDemo)throw Error('Pareamento exige host');const r=await api('/api/pairing/start',{method:'POST',body:{commandId:commandId(),role:payload.role,label:payload.label}});setNotice('PIN gerado no host.');return r.code||r.pin||'Consulte o servidor';});
 const savePrinter=payload=>run(async()=>{if(isDemo)throw Error('Configure uma impressora no host, não na prévia');await issue('/api/printer',payload);setNotice('Impressora configurada no host.');});
 useEffect(()=>{const onKey=e=>{if(e.key==='F3'){e.preventDefault();document.querySelector('.searchfield input')?.focus();}if(e.key==='F10'&&view==='venda'&&order?.status==='OPEN'){e.preventDefault();setModal({type:'payment'});}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[view,order]);
 if(mode==='boot')return <div className="loading">Conectando ao PDV Nexus local…</div>;
 if(mode==='offline')return <main className="authpage"><section className="authcard" role="alert"><h1>Caixa indisponível</h1><p>O host SQLite local não respondeu. Nenhuma venda foi registrada. O aplicativo não entra em modo demonstrativo no Electron.</p><Button kind="primary" onClick={boot}>Tentar novamente</Button></section></main>;
 if(mode==='license')return <LicenseOnboarding license={licenseInfo} onActivated={()=>void boot()} onReadOnly={()=>void request('/api/auth/status').then(data=>{setNeedsSetup(!!data.needsSetup);setMode('auth')}).catch(e=>setLoginError(toStringError(e)))}/>;
 if(mode==='auth')return <Login setup={needsSetup} onSubmit={login} busy={busy} error={loginError}/>;
 if(mode==='pairing')return <PairDevice role={deviceRole} onPaired={(nextToken,role)=>{setToken(nextToken);setPairedRole(role);setUser({role});setView(role==='kitchen'?'kds':'garcom');setMode('paired');}}/>;
 /* Navigation visibility lives in navigation.mjs; server independently enforces RBAC. */
 const canEdit=mode!=='paired'&&isAdmin(user)&&!closingOnly;const canRefund=mode==='live'&&user?.role==='admin';const allowedLinks=availableNavLinks(mode,pairedRole,user);
 const page=()=>{switch(view){
 case 'venda':return <Sale products={products} categories={categories} order={order} onManage={()=>setView('divisao')} onChoose={chooseProduct} onConfirm={confirm} onCancel={cancel} onPay={()=>{if(!session&&!isDemo){setError('Abra o caixa antes de receber pagamento');setView('caixa');}else if(order?.payments?.some(p=>p.state==='CONFIRMED'))setView('divisao');else setModal({type:'payment'})}} onNew={()=>{setOrder(null);setView('venda')}} busy={busy} mode={mode}/>;
 case 'concluida':return <Success order={doneOrder} onNew={()=>{setOrder(null);setView('venda')}}/>;
 case 'pedidos':return <Orders orders={orders} onOpen={openOrder} onRefresh={()=>void refresh()} onRefund={refundOrder} onRefundItems={o=>setModal({type:'refund-items',orderId:o.id})} canRefund={canRefund} busy={busy}/>;
 case 'produtos':return <div className="stack"><Products products={products} categories={categories} onAddProduct={addCatalogProduct} onAddCategory={addCategory} onToggle={toggleProduct} busy={busy} canEdit={canEdit}/><CatalogToolsPanel mode={mode} api={api} categories={categories} products={products} onRefresh={refresh}/><SaleUnitsConfig api={api} products={products} mode={mode} onChanged={refresh}/></div>;
 case 'caixa':return <Cash session={session} onAction={cashAction} busy={busy}/>;
 case 'mesas':return <Tables tables={tables} selected={selected} onSelect={openTable} onNew={createTable} busy={busy}/>;
 case 'kds':return <Kitchen api={api} tickets={tickets} onUpdate={updateTicket} onRefresh={()=>void refresh()} busy={busy}/>;
 case 'atendimento':return <AttendancePanel api={api} mode={mode} pairedRole={pairedRole}/>;
 case 'garcom':return <div className="stack">{mode==='paired'&&<WaiterReadyAlerts api={api} onOpen={()=>setView('atendimento')}/>}<Waiter tables={tables} products={products} onOpenTable={openTable} busy={busy}/></div>;
 case 'restaurante-config':return <div className="stack"><PizzeriaSettings api={api} products={products} onRefresh={refresh} mode={mode}/><KitchenStationsManager api={api} products={products} onChanged={refresh} mode={mode}/><TabletAdminPanel api={api} tables={tables} mode={mode}/></div>;
 case 'divisao':return <TableOrderPanel order={order} tables={tables} products={products} api={api} mode={mode} onUpdate={next=>{setOrder(next);void refresh();}} onBack={()=>{setView(mode==='paired'?'garcom':order?.serviceMode==='table'?'mesas':'venda');void refresh();}} onCheckout={selectedOrder=>{setOrder(selectedOrder);setModal({type:'payment'});}} session={session} canManage={canEdit}/>;
 case 'primeiro-acesso':return <Onboarding mode={mode} api={api}/>;
 case 'geral':return <Suspense fallback={<p className="subtext">Carregando gestão local...</p>}><Dashboard orders={orders} session={session} tables={tables} onGo={navigate} api={api} mode={mode}/></Suspense>;
 case 'estoque':return <div className="stack"><StockBusiness mode={mode} api={api} onChanged={()=>setStockRevision(v=>v+1)} reloadKey={stockRevision}/><AdvancedStockPanel mode={mode} api={api} onChanged={()=>setStockRevision(v=>v+1)} reloadKey={stockRevision}/></div>;
 case 'financeiro':return <FinanceBusiness mode={mode} api={api}/>;
 case 'relatorios':return <FinanceBusiness mode={mode} api={api} section="relatorios"/>;
 case 'inteligencia':return <Suspense fallback={<p className="subtext">Carregando BI local...</p>}><Intelligence api={api} mode={mode} onOpenUnits={()=>setView('unidades')}/></Suspense>;
 case 'delivery':return <DeliveryPanel mode={mode} api={api}/>;
 case 'unidades':return <UnitsPanel mode={mode} api={api}/>;
 case 'privacidade':return <DeliveryPanel mode={mode} api={api} section="privacidade"/>;
 case 'usuarios':return <Users onAdd={addOperator} busy={busy} user={user} api={api} mode={mode}/>;
 case 'integracoes':return <HardwareToolsPanel mode={mode} api={api}/>;
 case 'dispositivos':return <PairedDevicesPanel api={api} mode={mode}/>;
 case 'impressao':return <Printing mode={mode} onSave={savePrinter} busy={busy} jobs={jobs} user={user} api={api} onRefresh={refresh}/>;
 case 'sistema':return <Maintenance mode={mode} api={api}/>;
 case 'exportacao':return <Exports mode={mode}/>;
 default:return <Sale products={products} categories={categories} order={order} onManage={()=>setView('divisao')} onChoose={chooseProduct} onConfirm={confirm} onCancel={cancel} onPay={()=>setModal({type:'payment'})} onNew={()=>setOrder(null)} busy={busy} mode={mode}/>;
 }};
 return <AppShell header={{height:72}} navbar={{width:232,breakpoint:'sm',collapsed:{mobile:!sidebarOpen}}} padding={0} className="app nexus-app-shell">
 <AppShell.Header className="topbar">
  <div className="brand"><span className="brand-icon"><ShoppingCart size={22}/></span><strong>PDV Nexus <em>2.0</em></strong></div>
  <div className="top-title">PDV — {titleOf(view)}</div>
  <div className="top-right">
    <span className="top-status"><span className="dot"/>{mode==='paired'?'Dispositivo pareado':mode==='live'?'Caixa 01 · Host conectado':'Demonstração'}</span>
    {mode==='demo'?<Button kind="top" onClick={boot}>Conectar host</Button>:<Button kind="top" onClick={logout}>{initials(user?.username)} · Sair</Button>}
    <Burger className="nexus-mobile-burger" opened={sidebarOpen} onClick={()=>setSidebarOpen(v=>!v)} size="sm" aria-label="Abrir ou fechar o menu"/>
  </div>
 </AppShell.Header>
 <AppShell.Navbar className={"sidebar "+(sidebarOpen?"nexus-sidebar-open":"nexus-sidebar-closed")}><nav aria-label="Navegação principal">
  {allowedLinks.map(([id,_icon,label,group],i)=>{const Icon=navIcons[id]||Package;return <React.Fragment key={id}>
    {(i===0||allowedLinks[i-1]?.[3]!==group)&&<div className="nav-group">{group}</div>}
    <NavLink component="button" type="button" active={view===id} variant="light"
      className={'nav-item '+(view===id?'active':'')} leftSection={<Icon size={18} strokeWidth={1.8}/>}
      label={label} onClick={()=>{navigate(id);setSidebarOpen(false);}}
      aria-current={view===id?'page':undefined}/>
  </React.Fragment>})}
 </nav><p className="sidebar-foot">PDV Nexus 2.0 · Interface unificada<br/><span>R$ 0 · self-hosted</span></p></AppShell.Navbar>
 <AppShell.Main className="main-area">
  {licenseInfo?.required&&<div className="notice" role="status">{licenseInfo.active?(licenseInfo.kind==='TRIAL'?'Avaliação de 3 dias':'Licença comercial')+' · '+(licenseInfo.expiresAt?'Válida até '+new Date(licenseInfo.expiresAt).toLocaleString('pt-BR'):'Sem vencimento'):'Licença vencida: novas vendas e alterações de catálogo bloqueadas. Conclusão, cancelamento, devolução e impressão de operações existentes continuam disponíveis.'}{licenseInfo.active&&licenseInfo.kind==='TRIAL'&&licenseInfo.expiresAt&&Date.parse(licenseInfo.expiresAt)-Date.now()<=86400000?' · Seu teste termina em menos de 24 horas.':null}</div>}
  {mode==='demo'&&<div className="demo-banner" role="status">Prévia visual: sem conexão com host. Nenhum dado ou pagamento desta tela é persistido.</div>}
  {error&&<div className="errorbox" role="alert"><span>{error}</span><Button kind="icon" onClick={()=>setError('')} aria-label="Dispensar erro">×</Button></div>}
  {notice&&<div className="notice" role="status"><span>{notice}</span><Button kind="icon" onClick={()=>setNotice('')} aria-label="Dispensar aviso">×</Button></div>}
  {page()}
 </AppShell.Main>
 {['cancel','refund'].includes(modal?.type)&&<OperationDialog key={modal.order.id+modal.type} type={modal.type} order={modal.order} onClose={()=>setModal(null)} onSubmit={submitOperation} busy={busy}/>}
 {modal?.type==='product'&&<ProductModal product={modal.product} requester={api} demo={isDemo} busy={busy} onClose={()=>setModal(null)} onSubmit={addProduct}/>}
 {modal?.type==='payment'&&<PaymentModal order={order} onClose={()=>setModal(null)} onPay={pay} busy={busy} canOverrideStock={mode==='live'&&user?.role==='admin'}/>}
 {modal?.type==='refund-items'&&<PartialRefundDialog orderId={modal.orderId} api={api} onClose={()=>setModal(null)} onDone={()=>{setModal(null);void refresh();}}/>}
 </AppShell>
}
export default App;
