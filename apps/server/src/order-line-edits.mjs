/** Edição individual de comanda. Não cria novas linhas nem regrava vendas encerradas. */
import {randomUUID} from 'node:crypto';

function snapshot(db,lineId){
  const line=db.prepare(`SELECT id,order_id AS orderId,product_id AS productId,
    product_name_snapshot AS productName,unit_price_cents AS unitPriceCents,
    quantity,note_snapshot AS note,cancelled_at AS cancelledAt
    FROM order_line WHERE id=?`).get(lineId);
  if(!line)return null;
  line.modifiers=db.prepare(`SELECT modifier_id AS id,name_snapshot AS name,
    price_cents_snapshot AS priceCents FROM order_line_modifier WHERE line_id=? ORDER BY rowid`).all(lineId);
  return line;
}
export function lineHistory(db,method,route,h){
  if(method!=='GET')return null;
  const match=route.match(/^\/api\/orders\/([^/]+)\/line-history$/);
  if(!match)return null;
  if(!db.prepare('SELECT 1 FROM sales_order WHERE id=?').get(match[1]))h.missing('Pedido');
  const events=db.prepare(`SELECT id,line_id AS lineId,action,before_json AS beforeJson,
    after_json AS afterJson,reason,actor_id AS actorId,created_at AS createdAt
    FROM order_line_change WHERE order_id=? ORDER BY created_at,id`).all(match[1])
    .map(x=>({id:x.id,lineId:x.lineId,action:x.action,before:JSON.parse(x.beforeJson),
      after:x.afterJson?JSON.parse(x.afterJson):null,reason:x.reason,actorId:x.actorId,createdAt:x.createdAt}));
  return {status:200,body:{events}};
}
export function lineWrite(db,method,route,body,h){
  const matched=route.match(/^\/api\/orders\/([^/]+)\/lines\/([^/]+)\/(edit|cancel)$/);
  if(method!=='POST'||!matched)return null;
  const [,orderId,lineId,action]=matched;
  return h.transact(db,route,body,()=>{
    const order=h.databaseOrder(db,orderId);
    h.assertRevision(order,body.expectedRevision);
    if(!['DRAFT','OPEN'].includes(order.status))h.conflict('Comanda já encerrada','ORDER_CLOSED');
    const before=snapshot(db,lineId);
    if(!before||before.orderId!==orderId)h.missing('Linha da comanda');
    if(before.cancelledAt)h.conflict('Linha já cancelada','LINE_CANCELLED');
    const ticket=db.prepare('SELECT status FROM kitchen_ticket WHERE line_id=?').get(lineId);
    if(['PREPARING','READY','SERVED'].includes(ticket?.status)&&!h.supervisor)
      h.conflict('A produção já começou: correção exige supervisor ou gerente','KITCHEN_SUPERVISOR_REQUIRED');
    if(db.prepare('SELECT 1 FROM payment WHERE order_id=? LIMIT 1').get(orderId))
      h.conflict('Pedido já possui pagamento','ORDER_HAS_PAYMENT');
    // Pesagem registra massa e preço congelados; edição genérica permitiria vender
    // quantidades/preços sem atualizar medição e baixa de ingredientes.
    if(action==='edit'&&db.prepare('SELECT 1 FROM order_line_weight WHERE line_id=?').get(lineId))
      h.conflict('Item por peso é imutável. Cancele e pese novamente','WEIGHT_LINE_IMMUTABLE');
    // Pizza: preservar a precificação especial; alteração de adicionais genéricos
    // tornaria preço e snapshots de sabores/bordas inconsistentes.
    if(action==='edit'&&db.prepare('SELECT 1 FROM order_line_pizza WHERE line_id=?').get(lineId)&&body.modifierIds!==undefined)
      h.conflict('Pizza utiliza sabores e bordas próprios; cancele e recrie para mudar composição','PIZZA_CONFIG_LOCKED');
    let after,reason=null,message;
    if(action==='cancel'){
      reason=h.requireString(body.reason,'Motivo do cancelamento',240);
      db.prepare('UPDATE order_line SET cancelled_at=? WHERE id=?').run(h.stamp(),lineId);
      db.prepare('DELETE FROM order_guest_split WHERE line_id=?').run(lineId);
      message='ITEM CANCELADO: '+before.productName+' — '+reason;
      db.prepare(`UPDATE kitchen_ticket SET status='CANCELLED',
        change_note=?,revision=revision+1,updated_at=? WHERE line_id=? AND status<>'CANCELLED'`)
        .run(message,h.stamp(),lineId);
      after=snapshot(db,lineId);
    }else{
      const quantity=body.quantity===undefined?before.quantity:body.quantity;
      if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100)h.bad('Quantidade inválida');
      const note=body.note===undefined?(before.note??''):body.note;
      if(typeof note!=='string'||note.trim().length>240)h.bad('Observação inválida');
      const ids=body.modifierIds===undefined?before.modifiers.map(m=>m.id).filter(Boolean):body.modifierIds;
      if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length||ids.some(x=>typeof x!=='string'))h.bad('Adicionais inválidos');
      const oldExtra=before.modifiers.reduce((s,x)=>s+x.priceCents,0);
      const base=before.unitPriceCents-oldExtra;
      if(!Number.isSafeInteger(base)||base<0)h.conflict('Preço histórico inconsistente');
      const mods=[];
      for(const id of ids){
        // Modificador já vendido conserva seu preço/nome congelados, mesmo após edição do cardápio.
        const historical=before.modifiers.find(m=>m.id===id);
        if(historical){mods.push({id,name:historical.name,priceCents:historical.priceCents});continue;}
        const m=db.prepare('SELECT id,name,price_cents AS priceCents FROM product_modifier WHERE id=? AND product_id=? AND active=1').get(id,before.productId);
        if(!m)h.bad('Adicional não disponível para este produto');
        mods.push(m);
      }
      const nextPrice=base+mods.reduce((s,x)=>s+x.priceCents,0);
      if(!Number.isSafeInteger(nextPrice)||nextPrice<0||!Number.isSafeInteger(nextPrice*quantity))h.bad('Preço excede limite seguro');
      db.prepare('UPDATE order_line SET quantity=?,note_snapshot=?,unit_price_cents=? WHERE id=?')
        .run(quantity,note.trim(),nextPrice,lineId);
      db.prepare('DELETE FROM order_line_modifier WHERE line_id=?').run(lineId);
      const insert=db.prepare('INSERT INTO order_line_modifier(id,line_id,modifier_id,name_snapshot,price_cents_snapshot) VALUES(?,?,?,?,?)');
      for(const m of mods)insert.run(randomUUID(),lineId,m.id,m.name,m.priceCents);
      if(quantity!==before.quantity)db.prepare('DELETE FROM order_guest_split WHERE line_id=?').run(lineId);
      message='ITEM ALTERADO: '+before.productName+' — conferir quantidade, observação e adicionais';
      db.prepare(`UPDATE kitchen_ticket SET
        status=CASE WHEN status='READY' THEN 'PENDING' ELSE status END,
        change_note=?,revision=revision+1,updated_at=? WHERE line_id=? AND status<>'CANCELLED'`)
        .run(message,h.stamp(),lineId);
      after=snapshot(db,lineId);
    }
    db.prepare('UPDATE sales_order SET revision=revision+1 WHERE id=?').run(orderId);
    db.prepare(`INSERT INTO order_line_change
      (id,order_id,line_id,action,before_json,after_json,reason,actor_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),orderId,lineId,action==='cancel'?'CANCELLED':'EDITED',
        JSON.stringify(before),JSON.stringify(after),reason,h.actor,h.stamp());
    h.audit(db,orderId,action==='cancel'?'ORDER_LINE_CANCELLED':'ORDER_LINE_EDITED',
      {lineId,before,after,reason,kitchenNotice:message});
    return {order:h.databaseOrder(db,orderId),lineId,action:action==='cancel'?'CANCELLED':'EDITED'};
  });
}
