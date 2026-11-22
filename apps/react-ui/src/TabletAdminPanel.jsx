import React,{useEffect,useState} from 'react';
import {Badge,Button,Group,Paper,Select,Stack,Switch,Text} from '@mantine/core';
import {commandId} from './api.mjs';
/** Pareamento feito somente por administrador no host local, token exibido uma única vez. */
export function TabletAdminPanel({api,tables=[],mode}){
 const [tableId,setTableId]=useState(''),[autoAccept,setAutoAccept]=useState(false),[issued,setIssued]=useState(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(mode!=='live')return;let live=true;
  api('/api/tablet/settings').then(x=>{if(live)setAutoAccept(Boolean(x.autoAccept))}).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[api,mode]);
 if(mode!=='live')return null;
 const run=async(fn)=>{setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}};
 return <Paper withBorder radius="lg" p="md">
  <Stack gap="sm">
   <Group justify="space-between"><Text fw={800}>Tablets fixos por mesa</Text><Badge color="blue">Atendimento Pro</Badge></Group>
   <Text size="sm" c="dimmed">Um tablet por mesa, conectado ao servidor local por HTTPS LAN. Cada nova ocupação cria um atendimento independente.</Text>
   <Switch label="Enviar pedidos do tablet diretamente ao KDS" description="Desativado: o garçom precisa aprovar os pedidos." checked={autoAccept} disabled={busy}
     onChange={e=>{const next=e.currentTarget.checked;void run(async()=>{await api('/api/tablet/settings',{method:'POST',body:{commandId:commandId(),autoAccept:next}});setAutoAccept(next)})}}/>
   <Select label="Mesa para vincular tablet" placeholder="Selecionar mesa" searchable value={tableId} onChange={value=>{setTableId(value||'');setIssued(null)}}
    data={tables.map(x=>({value:x.id,label:x.label}))}/>
   <Button disabled={!tableId||busy} onClick={()=>void run(async()=>{
      const result=await api('/api/tables/'+encodeURIComponent(tableId)+'/tablet/pair',{method:'POST',body:{commandId:commandId()}});
      setIssued(result);
    })}>Vincular novo tablet (revoga o anterior)</Button>
   {issued&&<Paper withBorder p="sm">
      <Text fw={700}>Credencial única do tablet</Text>
      <Text size="xs">Abra /tablet.html no endereço HTTPS da rede local e digite a credencial. Ela não será exibida novamente.</Text>
      <Text ff="monospace" size="xs" style={{overflowWrap:'anywhere'}}>{issued.token}</Text>
      <Button mt="xs" variant="light" size="xs" onClick={()=>void navigator.clipboard?.writeText(issued.token)}>Copiar credencial</Button>
   </Paper>}
   {error&&<Text c="red" role="alert" size="sm">{error}</Text>}
  </Stack>
 </Paper>;
}
