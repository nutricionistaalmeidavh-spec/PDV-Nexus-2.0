import React,{useMemo,useState} from 'react';
import {
  Badge,Box,Button,Card,Group,NumberInput,Paper,ScrollArea,SegmentedControl,Select,
  SimpleGrid,Stack,Text,TextInput,ThemeIcon
} from '@mantine/core';
import {
  ArrowRight,Check,ChefHat,Clock3,ClipboardList,LayoutGrid,Plus,RefreshCw,
  Search,Smartphone,SplitSquareHorizontal,Users,UtensilsCrossed,Wallet
} from 'lucide-react';
import {formatMoney,splitEvenly,sumOrder} from './model.mjs';

const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const tableStatus=table=>table.orderId?'Ocupada':'Livre';

function Heading({eyebrow,title,description,action}){
 return <div className="pageheading">
  <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description&&<p className="subtext">{description}</p>}</div>
  {action&&<div className="heading-action">{action}</div>}
 </div>;
}
function EmptyState({icon:Icon=LayoutGrid,children}){
 return <Stack className="nexus-restaurant-empty" gap="sm" align="center">
  <Icon size={34} strokeWidth={1.4} aria-hidden="true"/>
  <Text c="dimmed" size="sm" ta="center">{children}</Text>
 </Stack>;
}
function StatePill({occupied}){return <Badge color={occupied?'orange':'green'} variant="light">{occupied?'Ocupada':'Livre'}</Badge>;}

export function RestaurantTables({tables=[],selected,onSelect,onNew,busy}){
 const [filter,setFilter]=useState('all');
 const [query,setQuery]=useState('');
 const [name,setName]=useState('');
 const filtered=useMemo(()=>tables.filter(t=>
  (filter==='all'||(filter==='occupied'?Boolean(t.orderId):!t.orderId))&&
  t.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))
 ),[tables,filter,query]);
 const occupied=tables.filter(t=>t.orderId).length;
 return <div className="page nexus-restaurant">
  <Heading eyebrow="ATENDIMENTO / SALÃO" title="Mapa do salão" description="Visualize disponibilidade, abra comandas e gerencie o atendimento."
   action={<form className="nexus-table-create row compact" onSubmit={event=>{event.preventDefault();if(!name.trim()||busy)return;Promise.resolve(onNew(name.trim())).then(()=>setName('')).catch(()=>{});}}>
    <TextInput placeholder="Ex.: Mesa 13" aria-label="Nome da nova mesa" value={name} onChange={e=>setName(e.currentTarget.value)} maxLength={70} required/>
    <Button color="orange" type="submit" leftSection={<Plus size={17}/>} disabled={!name.trim()||busy}>Nova mesa</Button>
   </form>}/>
  <SimpleGrid cols={{base:2,sm:3}} spacing="sm" className="nexus-room-summary">
   <Paper withBorder radius="lg" p="md"><Text c="dimmed" size="xs">Total de mesas</Text><Text size="xl" fw={800}>{tables.length}</Text></Paper>
   <Paper withBorder radius="lg" p="md"><Text c="dimmed" size="xs">Livres</Text><Text size="xl" fw={800} c="green.8">{tables.length-occupied}</Text></Paper>
   <Paper withBorder radius="lg" p="md"><Text c="dimmed" size="xs">Ocupadas</Text><Text size="xl" fw={800} c="orange.8">{occupied}</Text></Paper>
  </SimpleGrid>
  <Paper withBorder radius="lg" p="lg" className="nexus-room-surface">
   <Group justify="space-between" className="nexus-room-toolbar" gap="md">
    <SegmentedControl aria-label="Filtrar mesas" value={filter} onChange={setFilter} data={[
      {value:'all',label:'Todas ('+tables.length+')'},
      {value:'free',label:'Livres ('+(tables.length-occupied)+')'},
      {value:'occupied',label:'Ocupadas ('+occupied+')'}
     ]}/>
    <TextInput aria-label="Buscar mesa" placeholder="Buscar mesa" leftSection={<Search size={17}/>}
      value={query} onChange={e=>setQuery(e.currentTarget.value)}/>
   </Group>
   <div className="tables-layout">
    <div className="tables-grid nexus-room-grid">
     {filtered.map(table=><Card key={table.id} component="button" type="button" withBorder
       className={'table-card '+(table.orderId?'occupied':'free')+' '+(selected?.id===table.id?'focused':'')}
       disabled={busy} onClick={()=>onSelect(table)} aria-label={'Abrir '+table.label+' · '+tableStatus(table)}>
        <Group justify="space-between" align="start" wrap="nowrap">
         <ThemeIcon color={table.orderId?'orange':'gray'} variant="light" size={44} radius="md">
          <UtensilsCrossed size={22} strokeWidth={1.6} aria-hidden="true"/>
         </ThemeIcon>
         <StatePill occupied={Boolean(table.orderId)}/>
        </Group>
        <Text fw={800} className="nexus-table-label">{table.label}</Text>
        <Text size="xs" c="dimmed">{table.orderId?'Comanda em andamento':'Pronta para atendimento'}</Text>
        <Group gap={4} c="orange.9" fw={700} mt="auto"><Text size="xs">Abrir comanda</Text><ArrowRight size={15}/></Group>
       </Card>)}
     {!filtered.length&&<EmptyState>Nenhuma mesa encontrada para este filtro.</EmptyState>}
    </div>
    {selected&&<Paper p="lg" withBorder radius="lg" className="table-detail nexus-room-detail">
     <Group gap="sm" mb="md">
      <ThemeIcon color="orange" variant="light"><ClipboardList size={18}/></ThemeIcon>
      <Text size="lg" fw={800}>{selected.label}</Text>
     </Group>
     <StatePill occupied={Boolean(selected.orderId)}/>
     <Group justify="space-between" mt="md"><Text size="sm" c="dimmed">Comanda</Text><Text fw={700}>{selected.orderId?.slice(-8)||'Nenhuma'}</Text></Group>
     <Group justify="space-between" mt="sm"><Text size="sm" c="dimmed">Estado</Text><Text fw={700}>{selected.orderStatus||'Disponível'}</Text></Group>
     <Text size="xs" c="dimmed" my="md">O preparo da cozinha é controlado separadamente da situação da mesa.</Text>
     <Button color="orange" fullWidth onClick={()=>onSelect(selected)} disabled={busy}>Abrir comanda</Button>
    </Paper>}
   </div>
  </Paper>
 </div>;
}

const KDS_GROUPS=[
 {status:'PENDING',label:'Novos',action:'Iniciar preparo',next:'PREPARING',tone:'orange',icon:Clock3},
 {status:'PREPARING',label:'Em preparo',action:'Marcar como pronto',next:'READY',tone:'blue',icon:ChefHat},
 {status:'READY',label:'Prontos',action:'Entregar',next:'SERVED',tone:'green',icon:Check}
];

export function RestaurantKitchen({tickets=[],api,onUpdate,busy,onRefresh}){
 const [query,setQuery]=useState('');
 const [extra,setExtra]=useState([]),[nextCursor,setNextCursor]=useState(undefined),[loadingMore,setLoadingMore]=useState(false),[pageError,setPageError]=useState('');
 const shown=useMemo(()=>{
   const ids=new Set(tickets.map(x=>x.id));
   return [...tickets,...extra.filter(x=>!ids.has(x.id))];
 },[tickets,extra]);
 const loadMore=async()=>{
   if(loadingMore)return;
   setLoadingMore(true);setPageError('');
   try{
     let cursor=nextCursor;
     if(cursor===undefined){
       const first=await api('/api/kitchen/tickets?limit=200');
       cursor=first.nextCursor;
     }
     if(!cursor){setNextCursor(null);return;}
     const page=await api('/api/kitchen/tickets?limit=200&cursor='+encodeURIComponent(cursor));
     const found=new Set(tickets.map(x=>x.id));
     setExtra(old=>{
       const seen=new Set([...found,...old.map(x=>x.id)]);
       return [...old,...page.tickets.filter(x=>{if(seen.has(x.id))return false;seen.add(x.id);return true;})];
     });
     setNextCursor(page.nextCursor);
   }catch(error){setPageError(error?.message||'Não foi possível carregar tickets adicionais');}
   finally{setLoadingMore(false);}
 };
 const visible=useMemo(()=>shown.filter(t=>
   [ 'PENDING','PREPARING','READY' ].includes(t.status)&&
   [t.tableLabel,t.productName,t.orderId].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
 ),[shown,query]);
 return <div className="page nexus-restaurant nexus-kitchen">
  <Heading eyebrow="PRODUÇÃO / COZINHA" title="Painel KDS" description="Tickets operacionais do host local; etapas não alteram nem quitam a venda."
    action={<Button variant="default" leftSection={<RefreshCw size={17}/>} onClick={onRefresh} loading={busy}>Atualizar</Button>}/>
  <Group gap="md" className="nexus-kds-toolbar">
   <TextInput aria-label="Buscar tickets" value={query} onChange={e=>setQuery(e.currentTarget.value)}
     placeholder="Buscar mesa, produto ou pedido" leftSection={<Search size={18}/>} style={{flex:'1 1 240px'}}/>
   <Badge color="orange" variant="light" size="lg">{visible.length} tickets em andamento</Badge>
  </Group>
  <div className="kds-grid">
   {KDS_GROUPS.map(group=>{
    const groupTickets=visible.filter(t=>t.status===group.status),Icon=group.icon;
    return <Paper withBorder radius="lg" p="md" key={group.status} className={'kds-column '+group.tone}>
     <Group className="nexus-kds-heading" justify="space-between" mb="md">
      <Group gap="sm"><ThemeIcon color={group.tone} variant="light" size={34}><Icon size={19}/></ThemeIcon>
       <Text fw={800}>{group.label}</Text></Group>
      <Badge variant="filled" color={group.tone}>{groupTickets.length}</Badge>
     </Group>
     <Stack gap="sm">
      {groupTickets.map(ticket=><Card key={ticket.id} className="kds-ticket" withBorder radius="lg" p="md">
       <Group align="start" justify="space-between" gap="xs">
        <Text fw={800}>Atendimento #{String(ticket.attendanceId||ticket.orderId||'').slice(-8)}</Text>
        <Group gap="xs"><Badge color="gray" variant="light">{ticket.tableLabel||'Balcão'}</Badge>{ticket.paid&&<Badge color="green">Pago</Badge>}</Group>
       </Group>
       <Text fw={800} size="lg" my="sm">{ticket.quantity} × {ticket.productName}</Text>
       {ticket.waiterName&&<Text size="xs" c="dimmed">Garçom: {ticket.waiterName}</Text>}
       {ticket.note&&<Text size="sm" mb="xs" className="nexus-kds-note">Obs.: {ticket.note}</Text>}
       {ticket.modifiers&&<Text size="sm" c="dimmed">Adicionais: {ticket.modifiers}</Text>}
       <Button color={group.tone} fullWidth mt="md" onClick={()=>void Promise.resolve(onUpdate(ticket,group.next)).then(completed=>{
         if(completed)setExtra(old=>old.map(x=>x.id===ticket.id?{...x,status:group.next,revision:x.revision+1}:x)
           .filter(x=>['PENDING','PREPARING','READY'].includes(x.status)));
        })} disabled={busy}>
        {group.action}
       </Button>
      </Card>)}
      {!groupTickets.length&&<EmptyState icon={group.icon}>Sem tickets nesta etapa.</EmptyState>}
     </Stack>
    </Paper>
   })}
  </div>
  {pageError&&<Text role="alert" c="red.8" size="sm">{pageError}</Text>}
  {tickets.length>=200&&nextCursor!==null&&<Group mt="md" justify="center">
    <Button variant="outline" loading={loadingMore} onClick={()=>void loadMore()}>Carregar mais tickets</Button>
  </Group>}
 </div>;
}

export function RestaurantWaiter({tables=[],products=[],onOpenTable,busy}){
 const [tableId,setTableId]=useState('');
 const [filter,setFilter]=useState('');
 const target=tables.find(x=>x.id===tableId);
 const filtered=products.filter(p=>p.active!==0&&p.categoryActive!==0&&
  p.name.toLocaleLowerCase('pt-BR').includes(filter.toLocaleLowerCase('pt-BR'))).slice(0,12);
 return <div className="page nexus-restaurant nexus-waiter">
  <Heading eyebrow="ATENDIMENTO / REDE LOCAL" title="Garçom mobile" description="Selecione a mesa e abra sua comanda no host para registrar itens sem duplicar pedidos."/>
  <Paper className="phone-preview" p="lg" withBorder radius="xl">
   <Group justify="space-between" className="phone-header">
    <Group gap="xs"><Smartphone size={19}/><Text fw={800}>PDV Nexus</Text></Group>
    <Badge color="orange" variant="light">Garçom</Badge>
   </Group>
   <Stack className="phone-body" gap="md">
    <Select label="Selecionar mesa" placeholder="Escolha uma mesa" searchable clearable
      data={tables.map(table=>({value:table.id,label:table.label+' · '+(table.orderId?'ocupada':'livre')}))}
      value={tableId} onChange={setTableId}/>
    {target&&<Paper p="sm" bg="orange.0" radius="md">
      <Group justify="space-between"><Text fw={700} size="sm">{target.label}</Text><StatePill occupied={!!target.orderId}/></Group>
     </Paper>}
    <Button color="orange" size="md" fullWidth disabled={busy||!target}
      leftSection={<ClipboardList size={18}/>} onClick={()=>{if(target)onOpenTable(target);}}>Abrir comanda</Button>
    <TextInput aria-label="Buscar produto" placeholder="Buscar produto" value={filter}
      onChange={e=>setFilter(e.currentTarget.value)} leftSection={<Search size={17}/>}/>
    <Text size="sm" fw={700}>Consulta rápida de produtos</Text>
    <ScrollArea className="phone-products" mah={365} offsetScrollbars type="auto">
     <Stack gap="xs">
      {filtered.map(product=><Paper key={product.id} p="sm" withBorder radius="md" className="nexus-waiter-product">
       <Group justify="space-between" wrap="nowrap"><Box style={{minWidth:0}}>
        <Text size="sm" fw={700}>{product.name}</Text><Text size="xs" c="dimmed">{product.isCombo?'Combo':'Produto'}</Text>
       </Box><Text fw={800} c="orange.9" size="sm">{money(product.priceCents)}</Text></Group>
      </Paper>)}
      {!filtered.length&&<Text c="dimmed" size="sm">Nenhum produto encontrado.</Text>}
     </Stack>
    </ScrollArea>
    <Text c="dimmed" size="xs">Para adicionar produtos e enviar à cozinha, abra a comanda da mesa selecionada. Sem host, nenhuma ação é confirmada.</Text>
   </Stack>
  </Paper>
 </div>;
}

export function RestaurantSplit({order}){
 const [people,setPeople]=useState(2);
 const total=sumOrder(order);
 const shares=splitEvenly(total,people);
 return <div className="page nexus-restaurant">
  <Heading eyebrow="SALÃO / FECHAMENTO" title="Fechamento de mesa"
   description="Rateio de conferência; apenas o caixa registra um recebimento canônico."/>
  <SimpleGrid cols={{base:1,sm:2}} spacing="lg">
   <Paper withBorder radius="lg" p="lg">
    <Group gap="sm" mb="md"><ClipboardList size={20}/><Text fw={800}>Itens da comanda</Text></Group>
    {(order?.lines||[]).length?(order.lines||[]).map(l=><Group key={l.id} justify="space-between" className="nexus-split-line">
     <Text size="sm">{l.quantity} × {l.productName}</Text><Text fw={700}>{money(l.quantity*l.unitPriceCents)}</Text>
    </Group>):<EmptyState icon={ClipboardList}>Abra uma comanda no mapa do salão para consultar seus itens.</EmptyState>}
    <Group justify="space-between" className="total-hero" mt="md"><Text fw={800}>Total</Text><Text fw={900} size="xl">{money(total)}</Text></Group>
   </Paper>
   <Paper withBorder radius="lg" p="lg">
    <Group gap="sm" mb="md"><Users size={20}/><Text fw={800}>Dividir por pessoas</Text></Group>
    <NumberInput label="Número de pessoas" min={1} max={10} allowDecimal={false} allowNegative={false}
     value={people} onChange={value=>setPeople(typeof value==='number'&&value>=1&&value<=10?value:1)}/>
    <Stack gap="xs" my="lg">
     {shares.map((amount,index)=><Group key={index} justify="space-between" className="nexus-split-line">
      <Text size="sm">Pessoa {index+1}</Text><Text fw={700}>{money(amount)}</Text></Group>)}
    </Stack>
    <Text size="xs" c="dimmed">Prévia matemática, sem duplicar vendas nem gerar pagamentos. O rateio nominal efetivo está na comanda.</Text>
   </Paper>
  </SimpleGrid>
 </div>;
}
