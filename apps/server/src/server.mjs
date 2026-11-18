import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createOrder, addOrderLine, confirmOrder, closeOrder, cancelOrder, orderTotalCents } from '../../../packages/core/src/order.ts';
import { openDatabase, createBackup, defaultDataPath } from './db.mjs';
import {buildSalesDocument,salesToCsv} from './sales-export.mjs';
import { restaurantRead,restaurantWrite,dispatchKitchenTickets } from './restaurant.mjs';
import { refundWrite } from './refunds.mjs';
import { validateLanConfig,lanRole,roleAllows } from './lan-security.mjs';

const publicDir = fileURLToPath(new URL('../../web/public/', import.meta.url));
const actorId = 'operator-local';
const stamp = () => new Date().toISOString();

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
const bad = (message, code='INVALID_INPUT') => { throw new HttpError(400,code,message); };
const conflict = (message,code='CONFLICT') => { throw new HttpError(409,code,message); };
const missing = (what) => { throw new HttpError(404,'NOT_FOUND', `${what} não encontrado`); };
const safeCents = (v, allowZero=true) => Number.isSafeInteger(v) && v>= (allowZero ? 0:1);
const requireCents = (v,label='Valor',zero=true) => { if(!safeCents(v,zero)) bad(`${label} inválido`); return v; };
const requireString = (v,label,max=120) => { if(typeof v!=='string' || !v.trim() || v.length>max) bad(`${label} inválido`); return v.trim(); };
const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x==='object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])) : x;
const digest = (x) => createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');

function databaseOrder(db, id) {
  const row=db.prepare('SELECT * FROM sales_order WHERE id=?').get(id);
  if (!row) missing('Pedido');
  const lines=db.prepare('SELECT id,product_id AS productId,product_name_snapshot AS productName,unit_price_cents AS unitPriceCents,quantity,note_snapshot AS note FROM order_line WHERE order_id=? ORDER BY rowid').all(id);
  const payments=db.prepare('SELECT id,method,amount_cents AS amountCents,state,created_at AS createdAt FROM payment WHERE order_id=? ORDER BY rowid').all(id);
  for (const line of lines) line.modifiers=db.prepare('SELECT name_snapshot AS name,price_cents_snapshot AS priceCents FROM order_line_modifier WHERE line_id=?').all(line.id);
  const refunded=Boolean(db.prepare('SELECT 1 FROM order_refund WHERE order_id=?').get(id));
  const order={id:row.id,tableId:row.service_table_id,serviceMode:row.service_mode,createdAt:row.created_at,status:row.status,revision:row.revision,lines,payments,refunded,totalCents:0};
  order.totalCents=orderTotalCents(order);
  return order;
}
function audit(db,aggregateId,action,payload={}) {
  db.prepare('INSERT INTO audit_log(id,aggregate_id,action,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(),aggregateId,action,actorId,JSON.stringify(payload),stamp());
}
function transact(db, route, body, handler, status=200) {
  const commandId = requireString(body.commandId,'Identificador do comando',128);
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(commandId)) bad('Identificador do comando inválido');
  const hash = digest({route,body});
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous=db.prepare('SELECT request_hash,response_json FROM command_receipt WHERE command_id=?').get(commandId);
    if (previous) {
      if(previous.request_hash!==hash) conflict('Identificador reutilizado com dados diferentes','IDEMPOTENCY_CONFLICT');
      const result=JSON.parse(previous.response_json);db.exec('COMMIT');return result;
    }
    const data=handler();
    const response={status,body:data};
    db.prepare('INSERT INTO command_receipt(command_id,request_hash,response_json,created_at) VALUES (?,?,?,?)')
      .run(commandId,hash,JSON.stringify(response),stamp());
    db.exec('COMMIT');return response;
  } catch(e) { db.exec('ROLLBACK');throw e; }
}
function assertRevision(order, revision) {
  if (!Number.isSafeInteger(revision)||revision<0) bad('Revisão obrigatória');
  if (order.revision !== revision) conflict('Pedido alterado em outro terminal','REVISION_CONFLICT');
}
function writeOrder(db,order) {
  db.prepare('UPDATE sales_order SET status=?,revision=?,closed_at=? WHERE id=?')
    .run(order.status,order.revision,order.status==='CLOSED'?stamp():null,order.id);
}
function cashSession(db) {
  return db.prepare("SELECT * FROM cash_session WHERE terminal_id='t-local' AND status='OPEN'").get();
}
function cashExpected(db,session) {
  const money=db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM payment WHERE cash_session_id=? AND method='cash' AND state='CONFIRMED'").get(session.id).cents;
  const supplies=db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='SUPPLY' THEN amount_cents ELSE -amount_cents END),0) AS cents FROM cash_movement WHERE session_id=?").get(session.id).cents;
  const value=session.opening_amount_cents+money+supplies;
  if(!safeCents(value)) conflict('Movimento de caixa excedeu limite seguro');
  return value;
}
function visibleCash(db) {
  const session=cashSession(db);
  return session?{id:session.id,status:session.status,openedAt:session.opened_at,openingCents:session.opening_amount_cents,expectedCents:cashExpected(db,session)}:null;
}
function isPrivateIPv4(ip) {
  if(net.isIP(ip)!==4) return false;
  const v=ip.split('.').map(Number);
  return v[0]===10 || v[0]===127 || v[0]===192&&v[1]===168 || v[0]===172&&v[1]>=16&&v[1]<=31;
}
function receiptBytes(payload) {
  // ESC/POS básico, sem dependência: permitir apenas ASCII até parametrizar página de código.
  const clean=x=>String(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
  const width=38;
  const lines=['PDV NEXUS 2.0','RECIBO DE PEDIDO - NAO FISCAL','',`Pedido ${payload.id.slice(0,8)}`, '-'.repeat(width),
    ...payload.lines.map(l=>`${l.quantity}x ${clean(l.productName).slice(0,24)}  ${(l.unitPriceCents*l.quantity/100).toFixed(2)}`),
    '-'.repeat(width),`TOTAL R$ ${(payload.totalCents/100).toFixed(2)}`,'','NAO SUBSTITUI DOCUMENTO FISCAL',''];
  return Buffer.concat([Buffer.from([0x1b,0x40]),Buffer.from(lines.join('\n')+'\n\n\n','ascii'),Buffer.from([0x1d,0x56,0x01])]);
}
async function transmit(host,port,buffer) {
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection({host,port});
    socket.setTimeout(2500);
    socket.once('connect',()=>socket.end(buffer));
    socket.once('error',reject);
    socket.once('timeout',()=>socket.destroy(new Error('Tempo de impressão excedido')));
    socket.once('close',hadError=>{if(!hadError)resolve();});
  });
}
async function readJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415,'UNSUPPORTED_MEDIA_TYPE','Envie JSON');
  let input='';
  for await (const chunk of req) { input+=chunk; if(input.length>32768) throw new HttpError(413,'PAYLOAD_TOO_LARGE','Dados excedem 32KB'); }
  try { const value=JSON.parse(input);if(!value||Array.isArray(value)||typeof value!=='object') bad('JSON inválido');return value; }
  catch(e) { if(e instanceof HttpError) throw e;bad('JSON inválido'); }
}
function response(res,status,body) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body)); }

export function createApp({dataPath=defaultDataPath(),operationMode='demo',lan=null}={}) {
  // Modo operacional nao emite documentos fiscais: comprovante nao fiscal + exportacao externa.
  if(!['demo','production'].includes(operationMode))throw new Error('Modo de operacao invalido');
  const lanConfig=validateLanConfig(lan);
  const db=openDatabase(dataPath);
  let server, origin, closed=false;
  const sendingPrintJobs=new Set();
  async function handler(req,res) {
    const url=new URL(req.url,'http://localhost');
    const route=url.pathname;
    const method=req.method;
    try {
      const host=req.headers.host||'';
      const isLoopbackHost=/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host);
      const hostname=host.split(':')[0];
      const isLanHost=net.isIP(hostname)===4&&isPrivateIPv4(hostname) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local$/i.test(hostname);
      if(!isLoopbackHost && !(lanConfig&&isLanHost))throw new HttpError(403,'INVALID_HOST','Host não permitido');
      const allowed=`${lanConfig?'https':'http'}://${host}`;
      if(req.headers.origin&&req.headers.origin!==allowed)throw new HttpError(403,'CROSS_ORIGIN','Origem não permitida');
      if(route.startsWith('/api/')) {
        const role=lanRole(req,lanConfig);
        if(!role)throw new HttpError(401,'AUTH_REQUIRED','Token do dispositivo obrigatório');
        if(!roleAllows(role,method,route))throw new HttpError(403,'FORBIDDEN','A função do dispositivo não permite esta operação');
        if(method==='GET'&&route==='/api/health') return response(res,200,{ok:true,mode:operationMode,sqlite:db.prepare('PRAGMA integrity_check').get().integrity_check});
        if(method==='GET'&&route==='/api/products') return response(res,200,{products:db.prepare('SELECT id,name,price_cents AS priceCents,active,category_id AS categoryId FROM menu_product ORDER BY name').all()});
        if(method==='GET'&&route==='/api/orders') return response(res,200,{orders:db.prepare('SELECT id,service_mode AS serviceMode,status,revision,created_at AS createdAt FROM sales_order ORDER BY created_at DESC LIMIT 100').all()});
        const orderGet=route.match(/^\/api\/orders\/([^/]+)$/);
        if(method==='GET'&&orderGet) return response(res,200,{order:databaseOrder(db,orderGet[1])});
        if(method==='GET'&&route==='/api/cash/current') return response(res,200,{session:visibleCash(db),expectedCents:visibleCash(db)?.expectedCents??null});
        if(method==='GET'&&route==='/api/print/jobs') return response(res,200,{jobs:db.prepare("SELECT id,aggregate_id AS orderId,status,attempts,created_at AS createdAt FROM outbox_event WHERE kind='PRINT_RECEIPT' ORDER BY created_at DESC LIMIT 100").all()});
        if(method==='GET'&&route==='/api/printer') return response(res,200,{profile:db.prepare("SELECT host,port,enabled FROM printer_profile WHERE id='default'").get()??null});
        if(method==='GET'&&route==='/api/fiscal/status') return response(res,200,{emissionAvailable:false,exportAvailable:true,emissionScope:'external-only',mode:operationMode,warning:'Comprovantes nao fiscais. Exporte as vendas para processamento fiscal externo.'});
        if(method==='GET'&&/^\/api\/exports\/sales\.(?:csv|json)$/.test(route)){
          const isCsv=route.endsWith('.csv');
          const document=buildSalesDocument(db,url.searchParams);
          const filename='pdv-nexus-vendas.'+(isCsv?'csv':'json');
          res.writeHead(200,{
            'content-type':isCsv?'text/csv; charset=utf-8':'application/json; charset=utf-8',
            'content-disposition':'attachment; filename="'+filename+'"',
            'cache-control':'no-store',
            'x-content-type-options':'nosniff'
          });
          res.end(isCsv?salesToCsv(document):JSON.stringify(document));
          return;
        }
        const restaurantResult=restaurantRead(db,method,route,{missing});
        if(restaurantResult)return response(res,restaurantResult.status,restaurantResult.body);
        if(!['POST','PATCH'].includes(method)) return response(res,405,{code:'METHOD_NOT_ALLOWED',message:'Método não permitido'});
        const body=await readJson(req);
        let out;
        const h={transact,requireString,requireCents,bad,conflict,missing,assertRevision,databaseOrder,audit,stamp,cashSession,cashExpected};
        const special=restaurantWrite(db,method,route,body,h)??refundWrite(db,method,route,body,h);
        if(special){out=special;} else if(method==='POST'&&route==='/api/products') {
          out=transact(db,route,body,()=>{
            const name=requireString(body.name,'Nome do produto');
            const priceCents=requireCents(body.priceCents,'Preço');
            const categoryId=body.categoryId||'c-default';
            if(!db.prepare('SELECT id FROM menu_category WHERE id=? AND restaurant_id=?').get(categoryId,'r-local')) bad('Categoria inválida');
            const product={id:randomUUID(),name,priceCents,categoryId};
            db.prepare('INSERT INTO menu_product(id,category_id,name,price_cents) VALUES(?,?,?,?)').run(product.id,categoryId,name,priceCents);
            audit(db,product.id,'PRODUCT_CREATED',product);return {product};
          },201);
        } else if(method==='PATCH'&&route.match(/^\/api\/products\/[^/]+$/)) {
          const id=route.split('/').at(-1);
          out=transact(db,route,body,()=>{
            const record=db.prepare('SELECT * FROM menu_product WHERE id=?').get(id);if(!record)missing('Produto');
            const name=requireString(body.name,'Nome do produto');const priceCents=requireCents(body.priceCents,'Preço');
            db.prepare('UPDATE menu_product SET name=?,price_cents=? WHERE id=?').run(name,priceCents,id);
            audit(db,id,'PRODUCT_UPDATED',{name,priceCents});return {product:{id,name,priceCents}};
          });
        } else if(method==='POST'&&route==='/api/orders') {
          out=transact(db,route,body,()=>{
            if(body.serviceMode==='table') {
              if(!body.tableId)bad('Mesa obrigatória');
              if(!db.prepare("SELECT 1 FROM service_table WHERE id=? AND restaurant_id='r-local'").get(body.tableId))missing('Mesa');
              if(db.prepare("SELECT 1 FROM sales_order WHERE service_table_id=? AND status IN ('DRAFT','OPEN')").get(body.tableId))conflict('Mesa ocupada','TABLE_OCCUPIED');
            } else if(body.tableId!==undefined)bad('Mesa apenas para atendimento em mesa');
            const order=createOrder({id:randomUUID(),serviceMode:body.serviceMode,createdAt:stamp()});
            db.prepare('INSERT INTO sales_order(id,restaurant_id,terminal_id,service_table_id,service_mode,status,revision,created_at) VALUES(?,?,?,?,?,?,?,?)')
              .run(order.id,'r-local','t-local',body.serviceMode==='table'?body.tableId:null,order.serviceMode,order.status,order.revision,order.createdAt);
            audit(db,order.id,'ORDER_CREATED',{serviceMode:order.serviceMode});
            return {order:databaseOrder(db,order.id)};
          },201);
        } else if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/lines$/)) {
          const id=route.split('/')[3];
          out=transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            const product=db.prepare('SELECT * FROM menu_product WHERE id=? AND active=1').get(body.productId);if(!product)missing('Produto');
            const note=body.note===undefined?'':typeof body.note==='string'?body.note.trim():null;
            if(note===null||note.length>240)bad('Observação inválida');
            const ids=body.modifierIds??[];
            if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length)bad('Adicionais inválidos');
            const modifiers=[];let extraCents=0;
            for(const modifierId of ids) {
              if(typeof modifierId!=='string')bad('Adicional inválido');
              const mod=db.prepare('SELECT * FROM product_modifier WHERE id=? AND product_id=? AND active=1').get(modifierId,product.id);
              if(!mod)bad('Adicional indisponível para este produto');
              extraCents+=mod.price_cents;if(!safeCents(extraCents))bad('Adicionais excedem limite seguro');
              modifiers.push(mod);
            }
            const unitPriceCents=product.price_cents+extraCents;if(!safeCents(unitPriceCents))bad('Preço excede limite seguro');
            const next=addOrderLine(order,{id:randomUUID(),productId:product.id,productName:product.name,unitPriceCents,quantity:body.quantity});
            const line=next.lines.at(-1);
            db.prepare('INSERT INTO order_line(id,order_id,product_id,product_name_snapshot,unit_price_cents,quantity) VALUES (?,?,?,?,?,?)').run(line.id,id,line.productId,line.productName,line.unitPriceCents,line.quantity);
            db.prepare('UPDATE order_line SET note_snapshot=? WHERE id=?').run(note,line.id);
            for(const mod of modifiers)db.prepare('INSERT INTO order_line_modifier(id,line_id,modifier_id,name_snapshot,price_cents_snapshot) VALUES (?,?,?,?,?)').run(randomUUID(),line.id,mod.id,mod.name,mod.price_cents);
            writeOrder(db,next);
            if(next.status==='OPEN')dispatchKitchenTickets(db,id,stamp);
            audit(db,id,'ORDER_ITEM_ADDED',{...line,modifierIds:ids});
            return {order:databaseOrder(db,id)};
          });
        } else if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/confirm$/)) {
          const id=route.split('/')[3];
          out=transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            const next=confirmOrder(order);writeOrder(db,next);dispatchKitchenTickets(db,id,stamp);audit(db,id,'ORDER_CONFIRMED');return {order:databaseOrder(db,id)};
          });
        } else if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/close$/)) {
          const id=route.split('/')[3];
          out=transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            const session=cashSession(db);if(!session)conflict('Abra o caixa antes de receber pagamento','CASH_CLOSED');
            const payments=body.payments;if(!Array.isArray(payments)||payments.length===0||payments.length>10)bad('Pagamentos inválidos');
            let amount=0,change=0;
            for(const p of payments) {
              if(!['cash','pix','credit','debit','other'].includes(p.method))bad('Meio de pagamento inválido');
              requireCents(p.amountCents,'Pagamento',false);
              if(p.method==='cash') {
                requireCents(p.tenderedCents??p.amountCents,'Valor recebido');
                if((p.tenderedCents??p.amountCents)<p.amountCents)bad('Dinheiro recebido inferior ao pagamento');
                change+= (p.tenderedCents??p.amountCents)-p.amountCents;
              } else if(p.tenderedCents!==undefined) bad('Troco somente para dinheiro');
              amount+=p.amountCents;
              if(!safeCents(amount)||!safeCents(change))bad('Valor excedeu limite seguro');
            }
            let next;try{next=closeOrder(order,amount);}catch(e){bad(e.message);}
            for(const p of payments)db.prepare('INSERT INTO payment(id,order_id,method,amount_cents,state,created_at,cash_session_id) VALUES(?,?,?,?,?,?,?)')
              .run(randomUUID(),id,p.method,p.amountCents,'CONFIRMED',stamp(),session.id);
            writeOrder(db,next);
            db.prepare('INSERT INTO outbox_event(id,kind,aggregate_id,payload_json,status,created_at) VALUES (?,?,?,?,?,?)')
              .run(randomUUID(),'PRINT_RECEIPT',id,JSON.stringify({id,lines:next.lines,totalCents:amount}),'PENDING',stamp());
            audit(db,id,'ORDER_CLOSED',{payments,changeCents:change});
            return {order:databaseOrder(db,id),changeCents:change};
          });
        } else if(method==='POST'&&route.match(/^\/api\/orders\/[^/]+\/cancel$/)) {
          const id=route.split('/')[3];
          out=transact(db,route,body,()=>{
            const order=databaseOrder(db,id);assertRevision(order,body.expectedRevision);
            const reason=requireString(body.reason,'Motivo do cancelamento',240);
            const next=cancelOrder(order);writeOrder(db,next);
            db.prepare("UPDATE kitchen_ticket SET status='CANCELLED',revision=revision+1,updated_at=? WHERE order_id=? AND status NOT IN ('SERVED','CANCELLED')").run(stamp(),id);
            audit(db,id,'ORDER_CANCELLED',{reason});return {order:databaseOrder(db,id)};
          });
        } else if(method==='POST'&&route==='/api/cash/open') {
          out=transact(db,route,body,()=>{
            requireCents(body.openingCents,'Abertura');if(cashSession(db)) conflict('Já existe caixa aberto');
            const id=randomUUID();db.prepare('INSERT INTO cash_session(id,terminal_id,opened_at,opening_amount_cents,status) VALUES(?,?,?,?,?)')
              .run(id,'t-local',stamp(),body.openingCents,'OPEN');audit(db,id,'CASH_OPENED',{openingCents:body.openingCents});return {session:visibleCash(db)};
          },201);
        } else if(method==='POST'&&route==='/api/cash/movements') {
          out=transact(db,route,body,()=>{
            const session=cashSession(db);if(!session)conflict('Caixa fechado');
            if(!['SUPPLY','WITHDRAWAL'].includes(body.kind))bad('Tipo de movimentação inválido');
            requireCents(body.amountCents,'Valor',false);
            if(body.kind==='WITHDRAWAL'&&body.amountCents>cashExpected(db,session))bad('Sangria superior ao saldo');
            const id=randomUUID();db.prepare('INSERT INTO cash_movement(id,session_id,kind,amount_cents,actor_id,created_at) VALUES(?,?,?,?,?,?)')
              .run(id,session.id,body.kind,body.amountCents,actorId,stamp());
            audit(db,session.id,'CASH_MOVEMENT',{kind:body.kind,amountCents:body.amountCents});return {session:visibleCash(db)};
          },201);
        } else if(method==='POST'&&route==='/api/cash/close') {
          out=transact(db,route,body,()=>{
            const session=cashSession(db);if(!session)conflict('Caixa fechado');
            requireCents(body.countedCents,'Dinheiro contado');const expected=cashExpected(db,session);
            db.prepare("UPDATE cash_session SET status='CLOSED',counted_amount_cents=?,expected_amount_cents=?,closed_at=? WHERE id=?")
              .run(body.countedCents,expected,stamp(),session.id);
            audit(db,session.id,'CASH_CLOSED',{expected,counted:body.countedCents});
            return {id:session.id,expectedCents:expected,countedCents:body.countedCents,differenceCents:body.countedCents-expected};
          });
        } else if(method==='POST'&&route==='/api/printer') {
          out=transact(db,route,body,()=>{
            const host=requireString(body.host,'IP da impressora',64);
            if(!isPrivateIPv4(host))bad('Use IPv4 da rede local');
            const port=body.port;if(!Number.isInteger(port)||port<1||port>65535)bad('Porta inválida');
            db.prepare("INSERT INTO printer_profile(id,host,port,enabled) VALUES('default',?,?,1) ON CONFLICT(id) DO UPDATE SET host=excluded.host,port=excluded.port,enabled=1").run(host,port);
            return {profile:{host,port,enabled:1}};
          });
        } else if(method==='POST'&&route.match(/^\/api\/print\/jobs\/[^/]+\/send$/)) {
          const id=route.split('/')[4];
          const job=db.prepare("SELECT * FROM outbox_event WHERE id=? AND kind='PRINT_RECEIPT'").get(id);if(!job)missing('Impressão');
          if(job.status==='DONE'||sendingPrintJobs.has(id)) conflict('Impressão já enviada ou em andamento; nova via exige fluxo explícito');
          const printer=db.prepare("SELECT * FROM printer_profile WHERE id='default' AND enabled=1").get();
          if(!printer)conflict('Impressora não configurada');
          // Impresso pelo aplicativo local; a entrega TCP não confirma impressão física.
          sendingPrintJobs.add(id);
          try {
            await transmit(printer.host,printer.port,receiptBytes(JSON.parse(job.payload_json)));
            db.prepare("UPDATE outbox_event SET status='DONE',attempts=attempts+1 WHERE id=?").run(id);
            audit(db,job.aggregate_id,'RECEIPT_SENT',{jobId:id});out={status:200,body:{id,status:'DONE',warning:'Envio TCP concluído; impressão física não confirmada'}};
          } catch(e) {
            db.prepare("UPDATE outbox_event SET status='FAILED',attempts=attempts+1 WHERE id=?").run(id);
            out={status:502,body:{code:'PRINT_FAILED',message:'Não foi possível enviar à impressora',jobId:id}};
          } finally {sendingPrintJobs.delete(id);}
        } else return response(res,404,{code:'NOT_FOUND',message:'Rota não encontrada'});
        return response(res,out.status,out.body);
      }
      if(method!=='GET') return response(res,405,{code:'METHOD_NOT_ALLOWED'});
      const file=route==='/'?'index.html':route.slice(1);
      if(!['index.html','app.js','styles.css','restaurant.html','kitchen.html','restaurant.js','kitchen.js','restaurant.css','manifest.webmanifest','pwa-icon.svg','sw.js','pwa-register.js'].includes(file)) return response(res,404,{code:'NOT_FOUND'});
      const ext=path.extname(file);
      const contentType=ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':ext==='.svg'?'image/svg+xml':ext==='.webmanifest'?'application/manifest+json':'text/html; charset=utf-8';
      res.writeHead(200,{'content-type':contentType,'x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'cache-control':'no-store'});
      fs.createReadStream(path.join(publicDir,file)).pipe(res);
    } catch(e) {
      const status=e instanceof HttpError?e.status:400;
      return response(res,status,{code:e.code??'INVALID_OPERATION',message:e instanceof HttpError?e.message:e.message||'Erro interno'});
    }
  }
  server=lanConfig?https.createServer({cert:lanConfig.cert,key:lanConfig.key},handler):http.createServer(handler);
  return {
    get origin(){return origin;},
    listen({port=3434,host='127.0.0.1'}={}){return new Promise((resolve,reject)=>{
      if(!lanConfig&&host!=='127.0.0.1')return reject(new Error('A API LAN requer TLS e tokens por perfil'));
      if(lanConfig&&!['0.0.0.0','127.0.0.1'].includes(host))return reject(new Error('Host LAN não autorizado'));
      server.once('error',reject);server.listen(port,host,()=>{const address=server.address();origin=`${lanConfig?'https':'http'}://${host==='0.0.0.0'?'127.0.0.1':host}:${address.port}`;server.off('error',reject);resolve(origin);});
    });},
    backup(dest){return createBackup(db,dest);},
    close(){return new Promise(resolve=>{if(closed)return resolve();closed=true;if(server.listening)server.close(()=>{db.close();resolve();});else{db.close();resolve();}});}
  };
}
