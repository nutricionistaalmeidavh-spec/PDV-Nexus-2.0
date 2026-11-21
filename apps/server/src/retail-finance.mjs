/** Financial analytics over confirmed payments and canonical stock ledger only. */
const validDate=value=>{
  if(value===null)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('Período inválido');
  const day=new Date(value+'T00:00:00.000Z');
  if(!Number.isFinite(day.valueOf())||day.toISOString().slice(0,10)!==value)throw new Error('Data inválida');
  return value;
};
const add=(a,b)=>{const x=a+b;if(!Number.isSafeInteger(x))throw new Error('Total financeiro excedeu precisão');return x;};
export function financialRead(db,method,route,params){
  if(method!=='GET'||route!=='/api/reports/financial')return null;
  const from=validDate(params.get('from')),to=validDate(params.get('to'));
  if(from&&to&&from>to)throw new Error('Data inicial maior que a final');
  const orders=db.prepare("SELECT o.id,substr(o.closed_at,1,10) AS day,COALESCE(r.amount_cents,0)+(SELECT COALESCE(SUM(amount_cents),0) FROM order_item_refund WHERE order_id=o.id) AS refund FROM sales_order o LEFT JOIN order_refund r ON r.order_id=o.id WHERE o.status='CLOSED' AND o.closed_at IS NOT NULL AND (? IS NULL OR substr(o.closed_at,1,10)>=?) AND (? IS NULL OR substr(o.closed_at,1,10)<=?) ORDER BY o.closed_at,o.id LIMIT 10001").all(from,from,to,to);
  if(orders.length>10000)throw new Error('Selecione período menor: relatório limitado a 10 mil vendas');
  const grossQuery=db.prepare('SELECT COALESCE(SUM(unit_price_cents*quantity),0) AS amount FROM order_line WHERE order_id=? AND cancelled_at IS NULL');
  const costQuery=db.prepare("SELECT COALESCE(SUM(-value_delta_cents),0) AS amount FROM stock_movement WHERE kind='SALE' AND source_order_id=?");
  const methodsQuery=db.prepare("SELECT method,amount_cents FROM payment WHERE order_id=? AND state='CONFIRMED'");
  const byDay=new Map(),methods={cash:0,pix:0,credit:0,debit:0,other:0};
  let grossSalesCents=0,refundedCents=0,cogsCents=0;
  for(const order of orders){
    const gross=grossQuery.get(order.id).amount,cost=costQuery.get(order.id).amount,refunded=order.refund;
    grossSalesCents=add(grossSalesCents,gross);
    refundedCents=add(refundedCents,refunded);
    cogsCents=add(cogsCents,cost);
    const current=byDay.get(order.day)??{day:order.day,orders:0,grossSalesCents:0,refundedCents:0,cogsCents:0,netSalesCents:0};
    current.orders++;
    current.grossSalesCents=add(current.grossSalesCents,gross);
    current.refundedCents=add(current.refundedCents,refunded);
    current.cogsCents=add(current.cogsCents,cost);
    current.netSalesCents=current.grossSalesCents-current.refundedCents;
    byDay.set(order.day,current);
    const payments=methodsQuery.all(order.id);
    const paid=payments.reduce((sum,p)=>add(sum,p.amount_cents),0);
    if(paid!==gross)throw new Error('Pedido com pagamento inconsistente: '+order.id);
    for(const p of payments)methods[p.method]=add(methods[p.method]??0,p.amount_cents);
  }
  const cashSessions=db.prepare("SELECT id,opened_at AS openedAt,closed_at AS closedAt,opening_amount_cents AS openingCents,counted_amount_cents AS countedCents,expected_amount_cents AS expectedCents,status FROM cash_session WHERE (? IS NULL OR substr(opened_at,1,10)>=?) AND (? IS NULL OR substr(opened_at,1,10)<=?) ORDER BY opened_at DESC LIMIT 100").all(from,from,to,to);
  return {status:200,body:{
    period:{from,to},orders:orders.length,
    grossSalesCents,refundedCents,netSalesCents:grossSalesCents-refundedCents,cogsCents,
    grossMarginCents:grossSalesCents-refundedCents-cogsCents,
    averageTicketCents:orders.length?Math.round((grossSalesCents-refundedCents)/orders.length):0,
    methods,byDay:[...byDay.values()],cashSessions
  }};
}
