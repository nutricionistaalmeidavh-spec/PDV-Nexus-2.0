import React,{useEffect,useMemo,useState} from 'react';
import {AreaChart} from '@mantine/charts';
import {Badge,Button,Group,Paper,Select,SimpleGrid,Stack,Table,Text} from '@mantine/core';
import {RefreshCw,ChartNoAxesCombined,CalendarClock,PackageSearch,Store} from 'lucide-react';
import {formatMoney} from './model.mjs';

/** P2: leitura sob demanda, sem cópia de pedido/catálogo no navegador e sem serviços pagos. */
const money=c=>formatMoney(Number.isSafeInteger(c)?c:0);
const quantity=(n,unit)=>((Number.isSafeInteger(n)?n:0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:3})+' '+unit;
const dateShift=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+86400000*offset).toISOString().slice(0,10);
const today=()=>new Date().toISOString().slice(0,10);
const titles={dashboard:'Desempenho',forecast:'Demanda prevista',replenishment:'Reposição',consolidated:'Unidades'};
const paths={dashboard:'/api/bi/dashboard',forecast:'/api/bi/forecast',replenishment:'/api/bi/replenishment',consolidated:'/api/bi/consolidated'};
const empty='Nenhuma movimentação encontrada no período.';
const style={overflowX:'auto'};
function Totals({totals={}}){
 const cards=[
  ['Vendas concluídas',totals.orders||0],
  ['Receita bruta',money(totals.grossSalesCents||0)],
  ['Devoluções',money(totals.refundedCents||0)],
  ['Receita líquida',money(totals.netSalesCents||0)],
  ['CMV',money(totals.cogsCents||0)],
  ['Margem bruta',money(totals.grossMarginCents||0)]
 ];
 return <SimpleGrid cols={{base:2,md:3}} spacing="sm">
  {cards.map(([label,value])=><Paper withBorder p="md" radius="lg" key={label}>
    <Text c="dimmed" size="xs">{label}</Text><Text size="xl" fw={800}>{value}</Text>
   </Paper>)}
 </SimpleGrid>;
}
function Trend({rows=[]}){
 const chart=rows.map(d=>({day:d.day,Receita:d.netSalesCents/100,CMV:d.cogsCents/100}));
 if(!chart.length)return <Text c="dimmed">{empty}</Text>;
 return <AreaChart h={270} data={chart} dataKey="day" withLegend accessibilityLayer
  series={[{name:'Receita',color:'teal.7'},{name:'CMV',color:'orange.7'}]}
  curveType="linear" yAxisProps={{tickFormatter:v=>Number(v).toLocaleString('pt-BR')}}/>;
}
function Section({title,children}){
 return <Paper withBorder p="lg" radius="lg"><Text component="h2" fw={800} size="lg" mb="md">{title}</Text>{children}</Paper>;
}
function Dashboard({data}){
 return <Stack gap="lg"><Totals totals={data.totals}/>
  <Section title="Evolução diária"><Trend rows={data.byDay}/></Section>
  <SimpleGrid cols={{base:1,lg:2}} spacing="lg">
   <Section title="Produtos mais vendidos">
    <div style={style}><Table striped highlightOnHover>
     <Table.Thead><Table.Tr><Table.Th>Produto</Table.Th><Table.Th ta="right">Itens</Table.Th><Table.Th ta="right">Bruto</Table.Th></Table.Tr></Table.Thead>
     <Table.Tbody>{data.topProducts.map(p=><Table.Tr key={p.productId}><Table.Td>{p.name}</Table.Td><Table.Td ta="right">{p.quantity}</Table.Td><Table.Td ta="right">{money(p.grossCents)}</Table.Td></Table.Tr>)}</Table.Tbody>
    </Table></div>{!data.topProducts.length&&<Text c="dimmed">{empty}</Text>}
   </Section>
   <Section title="Canais e pagamentos">
    {(data.byMode||[]).map(x=><Group key={x.serviceMode} justify="space-between" mb="xs"><Text>{({table:'Mesas',counter:'Balcão',takeaway:'Retirada',delivery:'Delivery'})[x.serviceMode]||x.serviceMode}</Text><Text fw={700}>{money(x.netSalesCents)}</Text></Group>)}
    <Text size="sm" fw={800} mt="md">Meios confirmados (valor bruto)</Text>
    {(data.methods||[]).map(x=><Group key={x.method} justify="space-between" mb="xs"><Text size="sm">{({cash:'Dinheiro',pix:'Pix',credit:'Crédito',debit:'Débito',other:'Outros'})[x.method]||x.method}</Text><Text fw={700} size="sm">{money(x.confirmedCents)}</Text></Group>)}
   </Section>
  </SimpleGrid>
  <Text size="xs" c="dimmed">Devoluções atribuídas à data de fechamento da venda. Categorias usam o cadastro atual. Horários da API em UTC.</Text>
 </Stack>;
}
function Forecast({data}){
 const [selected,setSelected]=useState('');
 const choices=data.products||[];
 const current=choices.find(p=>p.id===selected)||choices[0];
 return <Stack gap="lg">
  <Text size="sm">Previsão estatística transparente baseada nos dias equivalentes das semanas anteriores. Não é uma garantia de venda nem utiliza serviço de IA pago.</Text>
  <Section title={'Demanda para os próximos '+data.horizonDays+' dias'}>
   <div style={style}><Table striped highlightOnHover>
    <Table.Thead><Table.Tr><Table.Th>Produto</Table.Th><Table.Th ta="right">Quantidade prevista</Table.Th><Table.Th>Qualidade da amostra</Table.Th></Table.Tr></Table.Thead>
    <Table.Tbody>{choices.map(p=><Table.Tr key={p.id}>
     <Table.Td>{p.name}</Table.Td><Table.Td ta="right">{p.expectedUnits===null?'Sem previsão':p.expectedUnits+' un.'}</Table.Td>
     <Table.Td><Badge color={p.confidence==='HIGH'?'green':p.confidence==='MEDIUM'?'blue':'gray'}>{({HIGH:'Alta',MEDIUM:'Moderada',LOW:'Baixa',INSUFFICIENT_HISTORY:'Histórico insuficiente'})[p.confidence]}</Badge></Table.Td>
    </Table.Tr>)}</Table.Tbody>
   </Table></div>{!choices.length&&<Text c="dimmed">{empty}</Text>}
  </Section>
  {!!choices.length&&<Section title="Projeção diária por produto">
   <Select label="Produto" value={current?.id||null} onChange={setSelected} searchable data={choices.map(p=>({value:p.id,label:p.name}))} mb="md"/>
   {current?.status==='READY'
    ?<AreaChart h={240} data={current.days} dataKey="day" series={[{name:'expectedUnits',label:'Unidades previstas',color:'teal.7'}]}
     curveType="linear" yAxisProps={{allowDecimals:false}}/>
    :<Text c="dimmed">Este produto precisa de pelo menos sete dias observados de vendas para gerar previsão.</Text>}
   <Text size="xs" c="dimmed" mt="sm">Janela observada: {current?.observedDays||0} dias; dias com venda: {current?.saleDays||0}.</Text>
  </Section>}
 </Stack>;
}
function Replenishment({data}){
 const needed=(data.ingredients||[]).filter(x=>x.recommendedMilli>0);
 return <Stack gap="md">
  <Paper withBorder p="md">
   <Group justify="space-between"><Text fw={800}>Ingredientes com sugestão: {needed.length}</Text><Badge color="gray">Apenas planejamento</Badge></Group>
   <Text size="sm" c="dimmed">O cálculo considera o saldo canônico, lotes vencidos ou próximos do vencimento, histórico de consumo, estoque mínimo, prazo de compra e segurança. Não gera pedidos nem altera estoque.</Text>
  </Paper>
  <Section title="Sugestões de reposição">
   <div style={style}><Table striped highlightOnHover>
    <Table.Thead><Table.Tr><Table.Th>Ingrediente</Table.Th><Table.Th ta="right">Utilizável</Table.Th><Table.Th ta="right">Vencendo/vencido</Table.Th><Table.Th ta="right">Repor</Table.Th><Table.Th>Base</Table.Th></Table.Tr></Table.Thead>
    <Table.Tbody>{(data.ingredients||[]).map(x=><Table.Tr key={x.id}>
     <Table.Td><Text fw={650}>{x.name}</Text><Text size="xs" c="dimmed">Mínimo: {quantity(x.lowStockMilli,x.unit)}</Text></Table.Td>
     <Table.Td ta="right">{quantity(x.usableMilli,x.unit)}</Table.Td>
     <Table.Td ta="right">{quantity(x.expiredMilli+x.expiringMilli,x.unit)}</Table.Td>
     <Table.Td ta="right"><Text fw={800} c={x.recommendedMilli>0?'orange':'dimmed'}>{quantity(x.recommendedMilli,x.unit)}</Text></Table.Td>
     <Table.Td><Badge color={x.demandConfidence==='INSUFFICIENT_HISTORY'?'gray':'blue'}>{x.demandConfidence==='INSUFFICIENT_HISTORY'?'Mínimo cadastrado':'Histórico de consumo'}</Badge></Table.Td>
    </Table.Tr>)}</Table.Tbody>
   </Table></div>{!data.ingredients.length&&<Text c="dimmed">Cadastre ingredientes e fichas técnicas para gerar recomendações.</Text>}
  </Section>
 </Stack>;
}
function Consolidated({data}){
 return <Stack gap="lg">
  <Paper withBorder p="md"><Text fw={750}>Consolidação entre unidades — somente leitura</Text>
   <Text size="sm" c="dimmed">A unidade atual é consultada ao vivo. Outras unidades dependem da última importação de snapshot validado; os indicadores remotos não são tempo real.</Text>
  </Paper>
  <Totals totals={data.totals}/>
  <Section title="Receita consolidada por dia"><Trend rows={data.byDay}/></Section>
  <Section title="Origem e atualização das unidades">
   <div style={style}><Table striped highlightOnHover>
    <Table.Thead><Table.Tr><Table.Th>Unidade</Table.Th><Table.Th>Situação dos dados</Table.Th><Table.Th ta="right">Pedidos</Table.Th><Table.Th ta="right">Líquido</Table.Th></Table.Tr></Table.Thead>
    <Table.Tbody>{data.units.map(u=><Table.Tr key={u.unitId}>
     <Table.Td><Text size="sm" fw={700}>{u.unitId}</Text><Text size="xs" c="dimmed">Revisão {u.revision}{u.importedAt?' · Importação '+new Date(u.importedAt).toLocaleString('pt-BR'):''}</Text></Table.Td>
     <Table.Td><Badge color={u.local?'green':u.stale?'orange':'blue'}>{u.local?'Esta unidade / atual':u.stale?'Snapshot desatualizado':'Snapshot importado'}</Badge></Table.Td>
     <Table.Td ta="right">{u.totals.orders}</Table.Td><Table.Td ta="right">{money(u.totals.netSalesCents)}</Table.Td>
    </Table.Tr>)}</Table.Tbody>
   </Table></div>
  </Section>
 </Stack>;
}
export function BusinessIntelligence({api,mode,onOpenUnits}){
 const [tab,setTab]=useState('dashboard'),[periodDays,setPeriodDays]=useState('30');
 const [forecastDays,setForecastDays]=useState('7'),[leadDays,setLeadDays]=useState('3'),[safetyDays,setSafetyDays]=useState('2');
 const [revision,setRevision]=useState(0),[state,setState]=useState({loading:true,data:null,error:''});
 const params=useMemo(()=>{
  const p=new URLSearchParams();
  if(tab==='dashboard'||tab==='consolidated'){const to=today();p.set('from',dateShift(to,-Number(periodDays)+1));p.set('to',to);}
  if(tab==='forecast'){p.set('days',forecastDays);p.set('lookbackDays','56');}
  if(tab==='replenishment'){p.set('lookbackDays','28');p.set('leadDays',leadDays);p.set('safetyDays',safetyDays);}
  return p.toString();
 },[tab,periodDays,forecastDays,leadDays,safetyDays]);
 useEffect(()=>{
  if(mode!=='live'){setState({loading:false,data:null,error:'BI exige autenticação no host local.'});return;}
  let live=true;setState({loading:true,data:null,error:''});
  api(paths[tab]+'?'+params).then(data=>{if(live)setState({loading:false,data,error:''})})
   .catch(e=>{if(live)setState({loading:false,data:null,error:e.message})});
  return()=>{live=false};
 },[api,mode,tab,params,revision]);
 return <div className="page nexus-management">
  <div className="pageheading">
   <div><p className="eyebrow">GESTÃO / P2</p><h1>BI e planejamento</h1>
    <p className="subtext">Indicadores, projeção de demanda, reposição e visão multiunidade sem serviços externos.</p></div>
   <Button variant="default" leftSection={<RefreshCw size={16}/>} loading={state.loading} onClick={()=>setRevision(n=>n+1)}>Atualizar</Button>
  </div>
  <Group gap="xs" mb="md" wrap="wrap">{Object.entries(titles).map(([id,label])=><Button key={id}
   variant={tab===id?'filled':'default'} color={tab===id?'teal':undefined} onClick={()=>setTab(id)}
   leftSection={id==='dashboard'?<ChartNoAxesCombined size={16}/>:id==='forecast'?<CalendarClock size={16}/>:id==='replenishment'?<PackageSearch size={16}/>:<Store size={16}/>}>
   {label}</Button>)}</Group>
  <Group gap="sm" mb="lg" wrap="wrap">
   {(tab==='dashboard'||tab==='consolidated')&&<Select aria-label="Período do BI" label="Período" value={periodDays} onChange={setPeriodDays} data={[{value:'7',label:'7 dias'},{value:'30',label:'30 dias'},{value:'90',label:'90 dias'},{value:'365',label:'365 dias'}]} w={170}/>}
   {tab==='forecast'&&<Select label="Horizonte" value={forecastDays} onChange={setForecastDays} w={170} data={[{value:'7',label:'7 dias'},{value:'14',label:'14 dias'},{value:'30',label:'30 dias'}]}/>}
   {tab==='replenishment'&&<>
    <Select label="Prazo de reposição" value={leadDays} onChange={setLeadDays} w={170} data={[{value:'1',label:'1 dia'},{value:'3',label:'3 dias'},{value:'7',label:'7 dias'},{value:'14',label:'14 dias'}]}/>
    <Select label="Estoque de segurança" value={safetyDays} onChange={setSafetyDays} w={180} data={[{value:'0',label:'0 dias'},{value:'2',label:'2 dias'},{value:'5',label:'5 dias'},{value:'10',label:'10 dias'}]}/>
   </>}
  </Group>
  {state.loading?<Text c="dimmed">Calculando indicadores no servidor local...</Text>
   :state.error?<Paper withBorder p="md" role="alert"><Text c="red">{state.error}</Text></Paper>
   :tab==='dashboard'?<Dashboard data={state.data}/>
   :tab==='forecast'?<Forecast key={params} data={state.data}/>
   :tab==='replenishment'?<Replenishment data={state.data}/>
   :<><Consolidated data={state.data}/>{onOpenUnits&&<Button mt="md" onClick={onOpenUnits}>Exportar ou importar atualizações de unidades</Button>}</>}
 </div>;
}
