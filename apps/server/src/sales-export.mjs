/** Exportacao de dados de vendas para contabilidade/emissao externa; NAO gera documento fiscal. */
const MAX_ORDERS=10000;

function periodDate(value,label){
  if(value===null)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error(label+' invalida: use AAAA-MM-DD');
  const date=new Date(value+'T00:00:00.000Z');
  if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value)throw new Error(label+' invalida');
  return value;
}
function addCents(a,b){
  const result=a+b;
  if(!Number.isSafeInteger(result)||result<0)throw new Error('Total de centavos fora do limite seguro');
  return result;
}
function csvCell(value){
  if(value===null||value===undefined)return '';
  if(typeof value==='number')return String(value);
  let text=String(value);
  if(/^\s*[=+\-@\t\r]/.test(text))text="'"+text;
  if(/[;"\r\n]/.test(text))return '"'+text.replaceAll('"','""')+'"';
  return text;
}

export function buildSalesDocument(db,params=new URLSearchParams()){
  const from=periodDate(params.get('from'),'Data inicial');
  const to=periodDate(params.get('to'),'Data final');
  if(from&&to&&from>to)throw new Error('Data inicial posterior a data final');
  const orders=db.prepare(
    "SELECT o.id,o.service_mode AS serviceMode,o.created_at AS createdAt,"+
    "o.closed_at AS closedAt,r.amount_cents AS refundedCents,r.cash_cents AS cashRefundCents,"+
    "r.reason AS refundReason,r.created_at AS refundCreatedAt "+
    "FROM sales_order o LEFT JOIN order_refund r ON r.order_id=o.id "+
    "WHERE o.status='CLOSED' AND o.closed_at IS NOT NULL "+
    "AND (? IS NULL OR substr(o.closed_at,1,10)>=?) "+
    "AND (? IS NULL OR substr(o.closed_at,1,10)<=?) "+
    "ORDER BY o.closed_at,o.id LIMIT ?"
  ).all(from,from,to,to,MAX_ORDERS+1);
  if(orders.length>MAX_ORDERS)throw new Error('Muitas vendas para exportar. Selecione um periodo menor.');
  const lineQuery=db.prepare('SELECT id,product_id AS productId,product_name_snapshot AS productName,unit_price_cents AS unitPriceCents,quantity,note_snapshot AS note FROM order_line WHERE order_id=? ORDER BY rowid');
  const modifierQuery=db.prepare('SELECT name_snapshot AS name,price_cents_snapshot AS priceCents FROM order_line_modifier WHERE line_id=? ORDER BY rowid');
  const paymentQuery=db.prepare("SELECT method,amount_cents AS amountCents,state,created_at AS createdAt FROM payment WHERE order_id=? AND state='CONFIRMED' ORDER BY rowid");
  const sales=orders.map(row=>{
    let grossCents=0;
    const lines=lineQuery.all(row.id).map(line=>{
      const modifiers=modifierQuery.all(line.id);
      const lineTotalCents=line.unitPriceCents*line.quantity;
      if(!Number.isSafeInteger(lineTotalCents)||lineTotalCents<0)throw new Error('Subtotal invalido no pedido');
      grossCents=addCents(grossCents,lineTotalCents);
      return {...line,modifiers,lineTotalCents};
    });
    const payments=paymentQuery.all(row.id);
    const paidCents=payments.reduce((sum,p)=>addCents(sum,p.amountCents),0);
    if(paidCents!==grossCents)throw new Error('Pagamento inconsistente no pedido '+row.id);
    const refundedCents=row.refundedCents??0;
    if(!Number.isSafeInteger(refundedCents)||refundedCents<0||refundedCents>grossCents)throw new Error('Devolucao inconsistente no pedido '+row.id);
    return {
      orderId:row.id,
      serviceMode:row.serviceMode,
      createdAt:row.createdAt,
      closedAt:row.closedAt,
      status:'CLOSED',
      lines,
      payments,
      grossCents,
      refundedCents,
      netCents:grossCents-refundedCents,
      refund:row.refundReason===null?null:{reason:row.refundReason,cashCents:row.cashRefundCents,createdAt:row.refundCreatedAt}
    };
  });
  return {schemaVersion:1,documentType:'DATA_ONLY_NON_FISCAL',generatedAt:new Date().toISOString(),
    period:{from,to},sales};
}
export function salesToCsv(document){
  const columns=['order_id','closed_at','service_mode','line_id','product_id','product_name','quantity',
    'unit_price_cents','line_total_cents','modifiers','note','payment_methods','gross_order_cents',
    'refunded_order_cents','net_order_cents'];
  const rows=[columns.join(';')];
  for(const sale of document.sales){
    const methods=sale.payments.map(p=>p.method+':'+p.amountCents).join('|');
    for(const line of sale.lines){
      const values=[sale.orderId,sale.closedAt,sale.serviceMode,line.id,line.productId,line.productName,line.quantity,
        line.unitPriceCents,line.lineTotalCents,line.modifiers.map(m=>m.name+':'+m.priceCents).join('|'),
        line.note,methods,sale.grossCents,sale.refundedCents,sale.netCents];
      rows.push(values.map(csvCell).join(';'));
    }
  }
  return '\uFEFF'+rows.join('\r\n')+'\r\n';
}
