import React,{useMemo} from 'react';
import {Badge,Button,Group,Stack,Text,ThemeIcon} from '@mantine/core';
import {AreaChart,DonutChart} from '@mantine/charts';
import {DataTable} from 'mantine-datatable';
import {BarChart3,Wallet} from 'lucide-react';
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
