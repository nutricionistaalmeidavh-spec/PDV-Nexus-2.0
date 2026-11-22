import React,{useEffect,useState} from 'react';
import {Badge,Button,Group,Paper,Select,SimpleGrid,Stack,Text} from '@mantine/core';
import {commandId} from './api.mjs';

/** Painel central: consulta o SQLite canônico, não cria filas de pedidos paralelas. */
export function AttendancePanel({api,mode,pairedRole}){
 const [overview,setOverview]=useState(null),[analytics,setAnalytics]=useState(null);
 const [deviceId,setDeviceId]=useState(''),[devices,setDevices]=useState([]);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(mode==='demo'||(mode==='paired'&&pairedRole==='kitchen'))return;
  let alive=true;
  const load=async()=>{
   try{
    const [o,a]=await Promise.all([api('/api/attendance/overview'),mode==='paired'?Promise.resolve(null):api('/api/attendance/analytics')]);
    if(alive){setOverview(o);setAnalytics(a);}
   }catch(e){if(alive)setError(e.message);}
  };
  void load();
  const id=setInterval(()=>void load(),8000);
  return()=>{alive=false;clearInterval(id)};
 },[api,mode,pairedRole]);
 useEffect(()=>{
  if(mode==='demo')return;
  let alive=true;
  if(mode==='paired'){
   void api('/api/attendance/me').then(x=>{if(alive)setDeviceId(x.waiterDeviceId||'')}).catch(e=>{if(alive)setError(e.message)});
  }else{
   void api('/api/pairing/devices').then(x=>{if(alive)setDevices((x.devices||[]).filter(d=>d.role==='waiter'&&!d.revokedAt))}).catch(()=>{});
  }
  return()=>{alive=false};
 },[api,mode]);
 const act=async(ticketId,action)=>{
  if(!deviceId)return setError('Selecione ou autentique um garçom para registrar a ação.');
  setBusy(true);setError('');
  try{
   await api('/api/attendance/tickets/'+encodeURIComponent(ticketId)+'/'+action,{
    method:'POST',body:{commandId:commandId(),waiterDeviceId:deviceId}});
   const next=await api('/api/attendance/overview');setOverview(next);
  }catch(e){setError(e.message)}finally{setBusy(false);}
 };
 if(mode==='demo'||(mode==='paired'&&pairedRole==='kitchen'))return null;
 const closing=overview?.closingRequests||[],unassigned=overview?.readyUnassigned||[],assigned=overview?.readyAssigned||[];
 return <section className="page nexus-attendance" aria-label="Painel central de atendimento">
  <header className="pageheading"><div><p className="eyebrow">ATENDIMENTO / PÓS-PAGAMENTO</p>
    <h2>Painel Central de Atendimento</h2>
    <Text c="dimmed" size="sm">Pedidos prontos sem responsável e contas solicitadas no tablet.</Text>
   </div></header>
  {error&&<Paper withBorder p="sm" role="alert"><Text c="red">{error}</Text></Paper>}
  {mode!=='paired'&&<Select label="Garçom que assumirá e entregará os pedidos" placeholder="Selecione o garçom" value={deviceId} onChange={setDeviceId}
    data={devices.map(d=>({value:d.id,label:d.label}))}/>}
  <SimpleGrid cols={{base:1,md:3}} spacing="md" mt="md">
   <Paper withBorder radius="lg" p="md"><Text fw={800}>Solicitações de conta</Text>
    <Badge color="orange" mt="xs">{closing.length}</Badge>
    <Stack gap="xs" mt="md">{closing.map(x=><Paper key={x.orderId} p="sm" withBorder>
     <Text fw={700}>{x.tableLabel} · #{x.orderId.slice(-8)}</Text>
     <Text size="sm">{x.preparingTickets?x.preparingTickets+' item(ns) em preparação':'Sem preparo pendente'}</Text>
     <Text size="sm">Pagamento permitido, inclusive com preparo em andamento.</Text>
    </Paper>)}{!closing.length&&<Text c="dimmed" size="sm">Nenhuma conta solicitada.</Text>}</Stack>
   </Paper>
   <Paper withBorder radius="lg" p="md"><Text fw={800}>Prontos sem responsável</Text>
    <Badge color="orange" mt="xs">{unassigned.length}</Badge>
    <Stack gap="xs" mt="md">{unassigned.map(x=><Paper key={x.id} p="sm" withBorder>
      <Group justify="space-between"><Text fw={700}>#{x.orderId.slice(-8)}</Text>{x.paid&&<Badge color="green">Pago</Badge>}</Group>
      <Text size="sm">{x.tableLabel||'Balcão'} · {x.quantity} × {x.productName}</Text>
      <Button fullWidth size="xs" mt="sm" disabled={busy||!deviceId} onClick={()=>void act(x.id,'claim')}>Assumir pedido</Button>
     </Paper>)}{!unassigned.length&&<Text c="dimmed" size="sm">Nenhum pedido disponível.</Text>}</Stack>
   </Paper>
   <Paper withBorder radius="lg" p="md"><Text fw={800}>Aguardando entrega</Text>
    <Badge color="blue" mt="xs">{assigned.length}</Badge>
    <Stack gap="xs" mt="md">{assigned.map(x=><Paper key={x.id} p="sm" withBorder>
      <Group justify="space-between"><Text fw={700}>#{x.orderId.slice(-8)}</Text>{x.paid&&<Badge color="green">Pago</Badge>}</Group>
      <Text size="sm">{x.tableLabel||'Balcão'} · {x.productName}</Text>
      <Text size="xs" c="dimmed">Garçom: {x.waiterName||devices.find(d=>d.id===x.claimedBy)?.label||'Responsável pelo pedido'}</Text>
      {(x.claimedBy||x.waiterDeviceId)===deviceId&&<Button fullWidth size="xs" mt="sm" disabled={busy} onClick={()=>void act(x.id,'deliver')}>Confirmar entrega</Button>}
     </Paper>)}{!assigned.length&&<Text c="dimmed" size="sm">Nenhuma entrega pendente.</Text>}</Stack>
   </Paper>
  </SimpleGrid>
  {analytics&&<Text size="xs" c="dimmed" mt="md">Indicadores canônicos: {analytics.paidPendingTickets} ticket(s) pagos ainda não entregues · {analytics.deliveredClaims} entrega(s) registrada(s) pelo painel.</Text>}
 </section>;
}
