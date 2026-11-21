import React,{useMemo,useState,useEffect} from 'react';
import {Badge,Button,Group,Paper,SimpleGrid,Stack,Text,ThemeIcon} from '@mantine/core';
import {AreaChart,DonutChart} from '@mantine/charts';
import {DataTable} from 'mantine-datatable';
import {BarChart3,Wallet,Boxes,ClipboardList,LayoutDashboard,ArrowRight,RefreshCw} from 'lucide-react';
import {formatMoney} from './model.mjs';

const cents=value=>Number.isSafeInteger(value)?value:0;
const money=value=>formatMoney(cents(value));
const real=value=>cents(value)/100;
const labels={cash:'Dinheiro',pix:'Pix',credit:'Crédito',debit:'Débito',other:'Outros'};
const palette=['orange.7','blue.6','teal.7','gray.6','yellow.7','red.6'];
const colors=['#C2410C','#2563EB','#0F766E','#57534E','#A16207','#B91C1C'];

export function EmptyChart({description='Sem dados para o período selecionado.',icon:Icon=BarChart3}){
 return <Stack align="center" justify="center" gap="sm" className="nexus-chart-empty">
  <ThemeIcon variant="light" color="orange" size={44}><Icon size={23}/></ThemeIcon>
  <Text fw={700}>Nenhuma movimentação registrada</Text>
  <Text c="dimmed" ta="center" size="sm">{description}</Text>
 </Stack>;
}
function Grid({records,columns,idAccessor='id',minHeight=190}){
 return <div className="nexus-management-table">
  <DataTable idAccessor={idAccessor} minHeight={minHeight} records={records||[]}
   columns={columns} noRecordsText="Nenhum registro encontrado" highlightOnHover striped
   withTableBorder withColumnBorders={false} horizontalSpacing="md" verticalSpacing="sm"/>
 </div>;
}
export function StockLedger({ingredients=[]}){
 return <Grid records={ingredients} columns={[
  {accessor:'name',title:'Ingrediente',render:i=><Text fw={700} size="sm">{i.name}</Text>},
  {accessor:'onHandMilli',title:'Saldo',textAlign:'right',render:i=><Text size="sm">{(i.onHandMilli/1000).toLocaleString('pt-BR',{maximumFractionDigits:3})} {i.unit}</Text>},
  {accessor:'bookValueCents',title:'Valor contábil',textAlign:'right',render:i=><Text fw={600} size="sm">{money(i.bookValueCents)}</Text>},
  {accessor:'lowStockMilli',title:'Alerta',render:i=>i.lowStockMilli>0&&i.onHandMilli<=i.lowStockMilli
   ?<Badge color="red" variant="light">Baixo</Badge>:<Badge color="green" variant="light">Normal</Badge>}
 ]}/>;
}
export function PurchasesLedger({purchases=[],onReceive,disabled=false}){
 return <Grid records={purchases} columns={[
  {accessor:'supplierName',title:'Fornecedor',render:p=><Text fw={650} size="sm">{p.supplierName||'—'}</Text>},
  {accessor:'createdAt',title:'Data',render:p=>p.createdAt?.slice(0,10)||'—'},
  {accessor:'status',title:'Situação',render:p=><Badge color={p.status==='DRAFT'?'orange':'green'} variant="light">{p.status==='DRAFT'?'Pendente':p.status}</Badge>},
  {accessor:'id',title:'Ação',render:p=>p.status==='DRAFT'
   ?<Button variant="default" size="xs" disabled={disabled} onClick={()=>onReceive(p)}>Receber</Button>
   :<Text size="sm" c="dimmed">—</Text>}
 ]}/>;
}
export function FinancialTrend({byDay=[]}){
 const values=useMemo(()=>byDay.map(day=>({
  day:day.day,Receita:real(day.netSalesCents),CMV:real(day.cogsCents)
 })),[byDay]);
 return <section className="nexus-financial-chart" aria-label="Evolução da receita e CMV">
  {values.length
   ?<AreaChart h={270} data={values} dataKey="day"
      series={[{name:'Receita',color:'orange.7'},{name:'CMV',color:'gray.6'}]}
      curveType="linear" withLegend accessibilityLayer
      yAxisProps={{tickFormatter:value=>'R$ '+Number(value).toLocaleString('pt-BR')}}/>
   :<EmptyChart/>}
 </section>;
}
export function FinancialPayments({methods={}}){
 const rows=Object.entries(methods).filter(([_,value])=>Number.isSafeInteger(value)).map(([method,value],index)=>({
  name:labels[method]||method,value:real(value),amountCents:cents(value),
  color:palette[index%palette.length],colorHex:colors[index%colors.length]
 }));
 const positive=rows.filter(x=>x.value>0);
 return <div className="nexus-financial-payments">
  <div className="nexus-payment-donut">
   {positive.length?<DonutChart data={positive} size={220} thickness={28} withLabelsLine={false} withLabels={false}
     chartLabel="Pagamentos" strokeWidth={1}/>:<EmptyChart icon={Wallet} description="Nenhum pagamento confirmado no período."/>}
  </div>
  <Grid minHeight={165} idAccessor="name" records={rows}
   columns={[
    {accessor:'name',title:'Forma de pagamento',render:item=><Group gap={8} wrap="nowrap">
      <span className="nexus-donut-dot" style={{background:item.colorHex}} aria-hidden="true"/>
      <Text size="sm">{item.name}</Text>
     </Group>},
    {accessor:'amountCents',title:'Valor',textAlign:'right',render:item=><Text fw={700} size="sm">{money(item.amountCents)}</Text>}
   ]}/>
 </div>;
}
export function FinancialDaysTable({byDay=[]}){
 return <Grid idAccessor="day" records={byDay}
   columns={[
    {accessor:'day',title:'Data'},
    {accessor:'orders',title:'Pedidos',textAlign:'right'},
    {accessor:'netSalesCents',title:'Líquido',textAlign:'right',render:day=>money(day.netSalesCents)},
    {accessor:'cogsCents',title:'CMV',textAlign:'right',render:day=>money(day.cogsCents)}
   ]}/>;
}
export function FinancialSessions({cashSessions=[]}){
 return <Grid records={cashSessions}
  columns={[
    {accessor:'openedAt',title:'Abertura',render:s=>s.openedAt?.slice(0,16).replace('T',' ')||'—'},
    {accessor:'status',title:'Status',render:s=><Badge color={s.status==='OPEN'?'green':'gray'} variant="light">{s.status}</Badge>},
    {accessor:'expectedCents',title:'Valor esperado',textAlign:'right',render:s=>s.expectedCents===null?'Aberto':money(s.expectedCents)}
   ]}/>;
}


export function ManagementOverview({orders=[],tables=[],session,onGo,api,mode}){
 const [report,setReport]=useState({loading:false,data:null,error:''});
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(mode!=='live'){setReport({loading:false,data:null,error:''});return;}
  let active=true;setReport(v=>({...v,loading:true,error:''}));
  api('/api/reports/financial').then(data=>{if(active)setReport({loading:false,data,error:''})})
   .catch(error=>{if(active)setReport({loading:false,data:null,error:error.message})});
  return()=>{active=false};
 },[api,mode,refresh]);
 const closed=orders.filter(o=>o.status==='CLOSED').length;
 const occupied=tables.filter(t=>t.orderId).length;
 return <div className="page nexus-management nexus-overview">
  <div className="pageheading">
   <div><p className="eyebrow">ADMINISTRAÇÃO / VISÃO GERAL</p>
    <h1>Gestão e relatórios</h1>
    <p className="subtext">Indicadores do host local; resumo de pedidos carregados e financeiro confirmado.</p></div>
   <Button variant="default" leftSection={<RefreshCw size={16}/>} loading={report.loading} onClick={()=>setRefresh(n=>n+1)}>Atualizar</Button>
  </div>
  <SimpleGrid cols={{base:2,md:4}} spacing="md" className="nexus-overview-kpis">
   {[
    ['Pedidos carregados',orders.length,'Últimos registros consultados'],
    ['Pedidos abertos',orders.filter(o=>o.status==='OPEN').length,'No conjunto consultado'],
    ['Mesas ocupadas',occupied,'Atualização local'],
    ['Dinheiro no caixa (esperado)',money(session?.expectedCents||0),session?'Sessão aberta':'Sem sessão ativa']
   ].map(([label,value,description])=><Paper withBorder p="md" radius="lg" key={label}>
     <Text c="dimmed" size="xs">{label}</Text>
     <Text fw={800} size="xl" mt="xs">{value}</Text>
     <Text size="xs" c="dimmed">{description}</Text>
    </Paper>)}
  </SimpleGrid>
  {report.error&&<p className="errorbox" role="alert">{report.error}</p>}
  {report.data&&<SimpleGrid cols={{base:1,lg:2}} spacing="lg" mt="lg">
   <Paper withBorder radius="lg" p="lg">
    <Group justify="space-between" mb="lg"><Text fw={800} component="h2">Receita e CMV</Text>
     <Text fw={700} c="orange.9">{money(report.data.netSalesCents)}</Text></Group>
    <FinancialTrend byDay={report.data.byDay||[]}/>
   </Paper>
   <Paper withBorder radius="lg" p="lg">
    <Text fw={800} component="h2" mb="lg">Pagamentos confirmados</Text>
    <FinancialPayments methods={report.data.methods||{}}/>
   </Paper>
  </SimpleGrid>}
  {!report.data&&mode!=='live'&&<Paper p="md" mt="lg" withBorder>
    <Text c="dimmed" size="sm">Dados financeiros reais exigem conexão com o host local.</Text>
   </Paper>}
  <Paper withBorder radius="lg" p="lg" mt="lg">
   <Text fw={800} component="h2" mb="md">Pedidos recentes</Text>
   <Grid records={orders.slice(0,30)} columns={[
    {accessor:'id',title:'Pedido',render:o=><Text fw={650} size="sm">#{o.id?.slice(-8)}</Text>},
    {accessor:'createdAt',title:'Data',render:o=>o.createdAt?.slice(0,16).replace('T',' ')||'—'},
    {accessor:'status',title:'Situação',render:o=><Badge color={o.status==='CLOSED'?'green':o.status==='CANCELLED'?'red':'orange'} variant="light">{o.status}</Badge>},
    {accessor:'serviceMode',title:'Atendimento',render:o=>o.serviceMode||'—'}
   ]}/>
  </Paper>
  <SimpleGrid cols={{base:1,sm:2,lg:3}} spacing="md" className="nexus-management-shortcuts" mt="lg">
   {[
    ['estoque','Estoque','Saldos e movimentações',Boxes],
    ['financeiro','Financeiro','Recebimentos confirmados',Wallet],
    ['relatorios','Relatórios','Vendas, CMV e desempenho',BarChart3],
    ['usuarios','Usuários','Acessos e permissões',LayoutDashboard],
    ['integracoes','Integrações','Periféricos e serviços opcionais',ClipboardList]
   ].map(([id,label,description,Icon])=><Button key={id} variant="default" className="nexus-management-shortcut"
     onClick={()=>onGo(id)} leftSection={<Icon size={18}/>}>
     <Stack gap={1} align="start"><Text fw={700}>{label}</Text><Text size="xs" c="dimmed">{description}</Text></Stack>
     <ArrowRight size={14}/></Button>)}
  </SimpleGrid>
 </div>;
}
