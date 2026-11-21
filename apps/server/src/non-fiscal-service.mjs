/** Comprovante ESC/POS não fiscal, derivado de snapshots imutáveis de pedido. */
export function receiptBytes(payload) {
  // ESC/POS básico, sem dependência: permitir apenas ASCII até parametrizar página de código.
  const clean=x=>String(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
  const width=38;
  const lines=['PDV NEXUS 2.0','RECIBO DE PEDIDO - NAO FISCAL','',`Pedido ${payload.id.slice(0,8)}`, '-'.repeat(width),
    ...payload.lines.map(l=>`${l.quantity}x ${clean(l.productName).slice(0,24)}  ${(l.unitPriceCents*l.quantity/100).toFixed(2)}`),
    '-'.repeat(width),`TOTAL R$ ${(payload.totalCents/100).toFixed(2)}`,'','NAO SUBSTITUI DOCUMENTO FISCAL',''];
  return Buffer.concat([Buffer.from([0x1b,0x40]),Buffer.from(lines.join('\n')+'\n\n\n','ascii'),Buffer.from([0x1d,0x56,0x01])]);
}
