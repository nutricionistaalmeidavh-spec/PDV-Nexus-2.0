import React,{useState} from 'react';
import {Modal,Textarea,Checkbox,Button,Group,Stack,Text,Alert} from '@mantine/core';

/** Explicit and accessible user confirmation, works in Electron, PWA and desktop.
 * The local API still owns authorization, transaction and audit history.
 */
export function OperationDialog({type,order,onClose,onSubmit,busy=false}){
 const [reason,setReason]=useState('');
 const [externalRefundConfirmed,setExternalRefundConfirmed]=useState(false);
 const [error,setError]=useState('');
 const refund=type==='refund';
 const label=refund?'Registrar devolução integral':'Cancelar pedido';
 const identifier=Number.isSafeInteger(order?.orderNumber)?
  String(order.orderNumber).padStart(6,'0'):String(order?.id||'').slice(-8);
 const submit=async e=>{
  e.preventDefault();
  if(busy||reason.trim().length<3)return;
  setError('');
  try{await onSubmit({reason:reason.trim(),externalRefundConfirmed});}
  catch(e){setError(e?.message||'Não foi possível concluir a operação');}
 };
 return <Modal opened onClose={busy?()=>{}:onClose} title={label+' #'+identifier}
   centered trapFocus closeOnEscape={!busy} closeOnClickOutside={!busy}>
   <form onSubmit={submit}>
    <Stack gap="md">
     <Text size="sm" c="dimmed">Operação auditada no host local. Confira os dados antes de confirmar.</Text>
     <Textarea label="Motivo obrigatório" required autoFocus rows={3}
      minLength={3} maxLength={240} value={reason} onChange={e=>setReason(e.currentTarget.value)}
      placeholder="Informe o motivo do procedimento" />
     {refund&&<Checkbox label="Confirmei manualmente a devolução por Pix ou cartão, se aplicável"
       checked={externalRefundConfirmed} onChange={e=>setExternalRefundConfirmed(e.currentTarget.checked)}/>}
     {refund&&<Text size="xs" c="dimmed">O PDV registra o estorno, mas não movimenta automaticamente valores em bancos ou adquirentes.</Text>}
     {error&&<Alert color="red" role="alert">{error}</Alert>}
     <Group justify="flex-end">
      <Button variant="default" disabled={busy} onClick={onClose}>Voltar</Button>
      <Button color="red" type="submit" loading={busy} disabled={reason.trim().length<3}>{label}</Button>
     </Group>
    </Stack>
   </form>
  </Modal>;
}
