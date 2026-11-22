/** Comprovante ESC/POS não fiscal, derivado de snapshots imutáveis de pedido. */
export function receiptBytes(payload) {
  // ESC/POS básico, sem dependência: permitir apenas ASCII até parametrizar página de código.
  const clean=x=>String(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
  const width=38;
  // Reserva espaço para o subtotal, mesmo em nomes longos e valores elevados.
  const itemLine=l=>{
    const subtotal=(l.unitPriceCents*l.quantity/100).toFixed(2);
    const suffix='  '+subtotal;
    return (`${l.quantity}x ${clean(l.productName)}`).slice(0,Math.max(0,width-suffix.length))+suffix;
  };
  const titles={PREBILL:'PRE-CONTA - NAO FISCAL',KITCHEN:'TICKET DE COZINHA - NAO FISCAL',CASH_CLOSING:'FECHAMENTO DE CAIXA - NAO FISCAL'};
  const title=titles[payload.kind]??'RECIBO DE PEDIDO - NAO FISCAL';
  const lines=['PDV NEXUS 2.0',title,'',`${payload.kind==='CASH_CLOSING'?'Sessao':'Pedido'} ${payload.kind==='CASH_CLOSING'?payload.id.slice(0,8):Number.isSafeInteger(payload.orderNumber)&&payload.orderNumber>0?String(payload.orderNumber).padStart(6,'0'):payload.id.slice(0,8)}`,
    ...(payload.stationName?['Setor: '+clean(payload.stationName).slice(0,30)]:[]),
    '-'.repeat(width),
    ...payload.lines.flatMap(l=>[
      itemLine(l),
      `  Item #${clean(l.id??'').slice(-8)}`,
      ...(l.modifiers??[]).map(m=>`  + ${clean(m.name).slice(0,width-4)}`),
      ...(l.note?[`  Obs: ${clean(l.note).slice(0,width-7)}`]:[])
    ]),
    '-'.repeat(width),
    ...(payload.kind==='CASH_CLOSING'?[
      'Caixa aberto: '+clean(payload.openedAt??''),
      'Caixa fechado: '+clean(payload.closedAt??''),
      'Esperado R$ '+(payload.expectedCents/100).toFixed(2),
      'Contado R$ '+(payload.countedCents/100).toFixed(2),
      'Diferenca R$ '+(payload.differenceCents/100).toFixed(2)
    ]:[`TOTAL R$ ${(payload.totalCents/100).toFixed(2)}`]),
    '','NAO SUBSTITUI DOCUMENTO FISCAL',''];
  return Buffer.concat([Buffer.from([0x1b,0x40]),Buffer.from(lines.join('\n')+'\n\n\n','ascii'),Buffer.from([0x1d,0x56,0x01])]);
}
