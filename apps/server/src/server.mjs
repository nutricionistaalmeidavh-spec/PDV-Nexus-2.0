import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { databaseOrder } from './order-read.mjs';
import { orderWrite } from './order-router.mjs';
import { HttpError,bad,conflict,missing,safeCents,requireCents,requireString,assertRevision } from './request-validation.mjs';
import { transact } from './command-service.mjs';
import { audit } from './audit-service.mjs';
import { openDatabase, createBackup, defaultDataPath } from './db.mjs';
import {createOperatorAuth,allowedOperator} from './operator-auth.mjs';
import {supplyRead,supplyWrite} from './retail-supply.mjs';
import {purchasesRead,purchasesWrite} from './purchases.mjs';
import {validatePrinterQueueName,transmitWindowsRaw} from './windows-raw-printer.mjs';
import {financialRead} from './retail-finance.mjs';
import {checkUpdates,currentVersion} from './system-maintenance.mjs';
import {encodeEan13,decodeEan13,decodeScaleLabel,parseScaleSerial,validateSerialDevicePath,transmitSerial} from './retail-hardware.mjs';
import {createDevicePairing,lookupPairedRole} from './device-pairing.mjs';
import {comboRead,comboWrite} from './restaurant-extras.mjs';
import {inventoryRead,inventoryWrite,snapshotLineRecipe} from './inventory.mjs';
import {publicRead,createPublicRequests,deliveryRead,deliveryWrite} from './delivery.mjs';
import {installationRead} from './install-identity.mjs';
import {syncRead,syncWrite} from './multiunit-sync.mjs';
import {operationalRead,operationalWrite,createOperationalPoller} from './operational-mirror.mjs';
import {privacyRead,privacyWrite} from './delivery-privacy.mjs';
import {categoryRead,categoryWrite,activeCategory} from './categories.mjs';
import {buildSalesDocument,salesToCsv} from './sales-export.mjs';
import { restaurantRead,restaurantWrite } from './restaurant.mjs';
import { refundWrite } from './refunds.mjs';
import { cashWrite } from './cash-service.mjs';
import { receiptBytes } from './non-fiscal-service.mjs';
import { validateLanConfig,lanRole,roleAllows } from './lan-security.mjs';

const publicDir = fileURLToPath(new URL('../../web/public/', import.meta.url));
const reactDistDir = fileURLToPath(new URL('../../react-ui/dist/', import.meta.url));
const stamp = () => new Date().toISOString();

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
async function readJson(req,maxLength=32768) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new HttpError(415,'UNSUPPORTED_MEDIA_TYPE','Envie JSON');
  let input='';
  for await (const chunk of req) { input+=chunk; if(input.length>maxLength) throw new HttpError(413,'PAYLOAD_TOO_LARGE','Dados excedem o tamanho permitido'); }
  try { const value=JSON.parse(input);if(!value||Array.isArray(value)||typeof value!=='object') bad('JSON inválido');return value; }
  catch(e) { if(e instanceof HttpError) throw e;bad('JSON inválido'); }
}
function response(res,status,body) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body)); }

export function createApp({dataPath=defaultDataPath(),operationMode='demo',lan=null,publicMenuEnabled=false,operationalSync=null}={}) {
  // Modo operacional nao emite documentos fiscais: comprovante nao fiscal + exportacao externa.
  if(!['demo','production'].includes(operationMode))throw new Error('Modo de operacao invalido');
  const lanConfig=validateLanConfig(lan);
  const db=openDatabase(dataPath);
  const operatorAuth=createOperatorAuth(db);
  const pairing=createDevicePairing(db);
  const peerPoller=createOperationalPoller(db,operationalSync);
  const publicRequests=createPublicRequests(db);
  const isPublicEnabled=()=>publicMenuEnabled===true||db.prepare("SELECT enabled FROM delivery_public_setting WHERE id='local'").get()?.enabled===1;
  let server, origin, closed=false,portalServer=null;
  const sendingPrintJobs=new Set();
  const backupJobs=new Map();
  const kitchenListeners=new Set();
  function notifyKitchen() {
    const message='event: changed\ndata: {"changed":true}\n\n';
    for(const res of kitchenListeners){
      if(res.destroyed){kitchenListeners.delete(res);continue;}
      try{res.write(message);}catch{kitchenListeners.delete(res);}
    }
  }
  function transactWithEvents(db,route,body,handler,status){
    const result=transact(db,route,body,handler,status);
    queueMicrotask(notifyKitchen);
    return result;
  }
  async function handler(req,res) {
    let requestActor='unauthenticated',requestRole=null;
    const auditForRequest=(db,aggregateId,action,payload={})=>audit(db,aggregateId,action,payload,requestActor);
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
        if(route.startsWith('/api/public/')){
          if(!isPublicEnabled())return response(res,404,{code:'PUBLIC_MENU_DISABLED',message:'Cardápio digital desativado'});
          const found=publicRead(db,method,route);
          if(found)return response(res,found.status,found.body);
          if(method==='POST'&&route==='/api/public/delivery/requests'){
            const payload=await readJson(req);
            const result=publicRequests.submit(payload,req.socket.remoteAddress);
            return response(res,result.status,result.body);
          }
          return response(res,404,{code:'NOT_FOUND'});
        }
        if(route.startsWith('/api/auth/')){
          if(!isLoopbackHost || !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
            throw new HttpError(403,'LOCAL_ONLY','Autenticacao de operador permitida apenas no host local');
          if(method!=='GET'&&method!=='POST')return response(res,405,{code:'METHOD_NOT_ALLOWED'});
          const authBody=method==='POST'?await readJson(req):null;
          return operatorAuth.handle(req,res,route,authBody);
        }
        // Resgate de PIN é público somente no host local ou na LAN HTTPS configurada.
        if(method==='POST'&&route==='/api/pairing/redeem'){
          if(!isLoopbackHost&&!lanConfig)throw new HttpError(403,'LOCAL_OR_TLS_ONLY','Pareamento exige host local ou HTTPS LAN');
          const payload=await readJson(req);
          const result=pairing.redeem(payload,req.socket.remoteAddress);
          return response(res,result.status,result.body);
        }
        const role=lanRole(req,lanConfig,token=>lookupPairedRole(db,token));
        if(role&&role!=='local')requestActor='lan-'+role;
        if(!role)throw new HttpError(401,'AUTH_REQUIRED','Token do dispositivo obrigatório');
        if(!roleAllows(role,method,route))throw new HttpError(403,'FORBIDDEN','A função do dispositivo não permite esta operação');
        if(role==='local'){
          const operator=operatorAuth.user(req);
          if(!operator)throw new HttpError(401,'OPERATOR_REQUIRED','Entre com um operador local');
          requestActor=operator.id;
          requestRole=operator.role;
          if(!allowedOperator(operator.role,method,route))throw new HttpError(403,'OPERATOR_FORBIDDEN','Perfil sem permissao para este comando');
        }
        if(method==='GET'&&route==='/api/kitchen/events'){
          res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-store, must-revalidate','connection':'keep-alive','x-content-type-options':'nosniff'});
          res.write('retry: 2500\nevent: ready\ndata: {}\n\n');
          kitchenListeners.add(res);
          const ping=setInterval(()=>{if(!res.destroyed)res.write(': ping\n\n');},25000);
          req.on('close',()=>{clearInterval(ping);kitchenListeners.delete(res);});
          return;
        }
        if(method==='GET'&&route==='/api/pairing/qr.svg'){
          const target=url.searchParams.get('url');
          let candidate;
          try{candidate=new URL(target);}catch{bad('URL do QR invalida');}
          const isLanAddress=net.isIP(candidate.hostname)===4&&isPrivateIPv4(candidate.hostname)&&!candidate.hostname.startsWith('127.')
            || /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local$/i.test(candidate.hostname);
          if(!target||target.length>256||candidate.protocol!=='https:'||!isLanAddress||candidate.username||candidate.password
            ||!['/restaurant.html','/kitchen.html'].includes(candidate.pathname)||candidate.search||candidate.hash)
            bad('Use URL HTTPS da rede privada para salao ou cozinha');
          const module=await import('qr');
          const svg=module.default(target,'svg',{ecc:'medium',border:3,scale:7});
          res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'none'; sandbox"});
          res.end(svg);return;
        }
        if(method==='GET'&&route==='/api/pairing/devices')return response(res,200,{devices:pairing.list()});
        if(method==='GET'&&route==='/api/health') return response(res,200,{ok:true,mode:operationMode,sqlite:db.prepare('PRAGMA integrity_check').get().integrity_check});
        if(method==='GET'&&route==='/api/system/config'){
          const restaurant=db.prepare("SELECT id,display_name AS displayName FROM restaurant WHERE id='r-local'").get();
          const terminal=db.prepare("SELECT id,label FROM terminal WHERE id='t-local'").get();
          return response(res,200,{restaurant,terminal});
        }
        if(method==='GET'&&route==='/api/system/version')return response(res,200,{version:currentVersion,offline:true,updateMode:'manual'});
        if(method==='GET'&&route==='/api/system/update/check'){
          if(role!=='local')throw new HttpError(403,'LOCAL_ONLY','A verificação de atualização exige o supervisor no host local');
          return response(res,200,await checkUpdates());
        }
        if(method==='GET'&&route==='/api/system/backups'){
          if(role!=='local')throw new HttpError(403,'LOCAL_ONLY','Consulte backups apenas no host local');
          const dir=path.join(path.dirname(dataPath),'backups');
          const backups=fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>/^[a-z0-9._-]+\.sqlite$/i.test(x))
            .map(name=>({name,sizeBytes:fs.statSync(path.join(dir,name)).size,modifiedAt:fs.statSync(path.join(dir,name)).mtime.toISOString()}))
            .sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)).slice(0,100):[];
          return response(res,200,{backups});
        }
        if(method==='GET'&&route==='/api/products') return response(res,200,{products:db.prepare('SELECT p.id,p.name,p.price_cents AS priceCents,p.active,p.is_combo AS isCombo,p.category_id AS categoryId,p.barcode,c.active AS categoryActive FROM menu_product p JOIN menu_category c ON c.id=p.category_id ORDER BY p.name').all()});
        const identity=installationRead(db,method,route);
        if(identity)return response(res,identity.status,identity.body);
        if(method==='POST'&&route==='/api/sync/operational/pull')return response(res,200,await peerPoller.syncOnce());
        const operationalResult=operationalRead(db,method,route,peerPoller);
        if(operationalResult)return response(res,operationalResult.status,operationalResult.body);
        const syncResult=syncRead(db,method,route);
        if(syncResult)return response(res,syncResult.status,syncResult.body);
        const privacyResult=privacyRead(db,method,route);
        if(privacyResult)return response(res,privacyResult.status,privacyResult.body);
        const deliveryResult=deliveryRead(db,method,route);
        if(deliveryResult)return response(res,deliveryResult.status,deliveryResult.body);
        const financeResult=financialRead(db,method,route,url.searchParams);
        if(financeResult)return response(res,financeResult.status,financeResult.body);
        const purchaseResult=purchasesRead(db,method,route);
        if(purchaseResult)return response(res,purchaseResult.status,purchaseResult.body);
        const suppliersResult=supplyRead(db,method,route,url.searchParams);
        if(suppliersResult)return response(res,suppliersResult.status,suppliersResult.body);
        if(method==='GET'&&route==='/api/catalog/barcode'){
          const code=url.searchParams.get('code')??'';
          if(!decodeEan13(code).valid)bad('EAN-13 inválido');
          const product=db.prepare('SELECT id,name,price_cents AS priceCents,active FROM menu_product WHERE barcode=?').get(code);
          return response(res,200,{barcode:code,product:product??null});
        }
        if(method==='GET'&&route==='/api/hardware/scale/parse'){
          const raw=url.searchParams.get('raw')??'',brand=url.searchParams.get('brand')??'generic';
          const parsed=parseScaleSerial(raw,{brand});
          return response(res,200,{reading:parsed,warning:'Leitura por texto; confirme estabilidade e homologação antes de vender'});
        }
        if(method==='GET'&&route==='/api/hardware/scale/label'){
          const code=url.searchParams.get('code')??'',mode=url.searchParams.get('mode')??'weight';
          return response(res,200,{label:decodeScaleLabel(code,{mode})});
        }
        const stockResult=inventoryRead(db,method,route,url.searchParams,{missing,bad});
        if(stockResult)return response(res,stockResult.status,stockResult.body);
        const cats=categoryRead(db,method,route);
        if(cats)return response(res,cats.status,cats.body);
        const comboResult=comboRead(db,method,route,{missing});
        if(comboResult)return response(res,comboResult.status,comboResult.body);
        if(method==='GET'&&route==='/api/orders') return response(res,200,{orders:db.prepare('SELECT id,service_mode AS serviceMode,status,revision,created_at AS createdAt FROM sales_order ORDER BY created_at DESC LIMIT 100').all()});
        const orderGet=route.match(/^\/api\/orders\/([^/]+)$/);
        if(method==='GET'&&orderGet) return response(res,200,{order:databaseOrder(db,orderGet[1])});
        if(method==='GET'&&route==='/api/cash/current') return response(res,200,{session:visibleCash(db),expectedCents:visibleCash(db)?.expectedCents??null});
        if(method==='GET'&&route==='/api/print/jobs') return response(res,200,{jobs:db.prepare("SELECT id,aggregate_id AS orderId,status,attempts,created_at AS createdAt FROM outbox_event WHERE kind='PRINT_RECEIPT' ORDER BY created_at DESC LIMIT 100").all()});
        if(method==='GET'&&route==='/api/printer') return response(res,200,{profile:db.prepare("SELECT host,port,enabled,transport,device_path AS devicePath,baud_rate AS baudRate FROM printer_profile WHERE id='default'").get()??null});
        if(method==='GET'&&route==='/api/exports/status') return response(res,200,{emissionAvailable:false,exportAvailable:true,emissionScope:'external-only',mode:operationMode,warning:'Comprovantes nao fiscais. Exporte as vendas para processamento fiscal externo.'});
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
        const body=await readJson(req,route==='/api/sync/operational/import'?4500000:route==='/api/sync/import'?524288:32768);
        if(method==='POST'&&route==='/api/system/config'){
          const out=transactWithEvents(db,route,body,()=>{
            const displayName=requireString(body.displayName,'Nome do estabelecimento',120);
            const terminalLabel=requireString(body.terminalLabel,'Nome do terminal',80);
            db.prepare("UPDATE restaurant SET display_name=? WHERE id='r-local'").run(displayName);
            db.prepare("UPDATE terminal SET label=? WHERE id='t-local'").run(terminalLabel);
            auditForRequest(db,'r-local','INSTALLATION_CONFIGURED',{displayName,terminalLabel});
            return {restaurant:{id:'r-local',displayName},terminal:{id:'t-local',label:terminalLabel}};
          });
          return response(res,out.status,out.body);
        }
        if(method==='POST'&&route==='/api/system/backup'){
          if(role!=='local')throw new HttpError(403,'LOCAL_ONLY','Backup manual somente no host local');
          const commandId=requireString(body.commandId,'Identificador do backup',100);
          if(!/^[a-zA-Z0-9_-]{3,100}$/.test(commandId))bad('Identificador do backup inválido');
          const destination=path.join(path.dirname(dataPath),'backups','manual-'+commandId+'.sqlite');
          const existing=fs.existsSync(destination);
          let created=false;
          if(!existing&&!backupJobs.has(commandId)&&backupJobs.size)conflict('Backup já em andamento no host','BACKUP_BUSY');
          if(!existing){
            const ongoing=backupJobs.get(commandId);
            if(ongoing)await ongoing;
            else{
              const operation=createBackup(db,destination);
              backupJobs.set(commandId,operation);
              try{await operation;created=true;auditForRequest(db,'r-local','BACKUP_CREATED',{file:path.basename(destination)});}
              finally{backupJobs.delete(commandId);}
            }
          }
          return response(res,created?201:200,{created,filename:path.basename(destination),path:destination,warning:'Para restaurar, feche o PDV e use o procedimento offline.'});
        }
        if(method==='POST'&&route==='/api/pairing/start'){
          try{return response(res,201,pairing.start(body));}
          catch(e){return response(res,400,{code:'PAIRING_INVALID',message:e.message});}
        }
        if(method==='POST'&&route==='/api/pairing/revoke'){
          const revoked=pairing.revoke(body.deviceId);
          return response(res,revoked?200:404,{revoked});
        }
        let out;
        const h={transact:transactWithEvents,requireString,requireCents,bad,conflict,missing,assertRevision,databaseOrder,audit:auditForRequest,actor:requestActor,operatorRole:requestRole,deviceRole:role,stamp,cashSession,cashExpected,visibleCash,snapshotLineRecipe};
        const special=purchasesWrite(db,method,route,body,h)??supplyWrite(db,method,route,body,h)??operationalWrite(db,method,route,body,h)??syncWrite(db,method,route,body,h)??privacyWrite(db,method,route,body,h)??deliveryWrite(db,method,route,body,h)??inventoryWrite(db,method,route,body,h)??categoryWrite(db,method,route,body,h)??comboWrite(db,method,route,body,h)??restaurantWrite(db,method,route,body,h)??refundWrite(db,method,route,body,h)??cashWrite(db,method,route,body,h)??orderWrite(db,method,route,body,h);
        if(special){out=special;} else if(method==='POST'&&route==='/api/products') {
          out=transactWithEvents(db,route,body,()=>{
            const name=requireString(body.name,'Nome do produto');
            const priceCents=requireCents(body.priceCents,'Preço');
            const categoryId=body.categoryId||'c-default';
            if(!activeCategory(db,categoryId)) bad('Categoria inexistente ou arquivada');
            const barcode=body.barcode===undefined||body.barcode===null||body.barcode===''?null:String(body.barcode);
            if(barcode&&!decodeEan13(barcode).valid)bad('EAN-13 inválido');
            const product={id:randomUUID(),name,priceCents,categoryId,barcode};
            db.prepare('INSERT INTO menu_product(id,category_id,name,price_cents,barcode) VALUES(?,?,?,?,?)').run(product.id,categoryId,name,priceCents,barcode);
            auditForRequest(db,product.id,'PRODUCT_CREATED',product);return {product};
          },201);
        } else if(method==='PATCH'&&route.match(/^\/api\/products\/[^/]+$/)) {
          const id=route.split('/').at(-1);
          out=transactWithEvents(db,route,body,()=>{
            const record=db.prepare('SELECT * FROM menu_product WHERE id=?').get(id);if(!record)missing('Produto');
            const name=body.name===undefined?record.name:requireString(body.name,'Nome do produto');
            const priceCents=body.priceCents===undefined?record.price_cents:requireCents(body.priceCents,'Preco');
            const categoryId=body.categoryId===undefined?record.category_id:requireString(body.categoryId,'Categoria',128);
            if(!activeCategory(db,categoryId))bad('Categoria inexistente ou arquivada');
            const active=body.active===undefined?record.active:typeof body.active==='boolean'?(body.active?1:0):null;
            if(active===null)bad('Ativo deve ser verdadeiro ou falso');
            const barcode=body.barcode===undefined?record.barcode:(body.barcode===null||body.barcode===''?null:String(body.barcode));
            if(barcode&&!decodeEan13(barcode).valid)bad('EAN-13 inválido');
            db.prepare('UPDATE menu_product SET name=?,price_cents=?,category_id=?,active=?,barcode=? WHERE id=?').run(name,priceCents,categoryId,active,barcode,id);
            auditForRequest(db,id,'PRODUCT_UPDATED',{name,priceCents,categoryId,active,barcode});
            return {product:{id,name,priceCents,categoryId,active,barcode}};
          });
        } else if(method==='POST'&&route==='/api/printer') {
          out=transactWithEvents(db,route,body,()=>{
            const transport=body.transport??'tcp';
            if(!['tcp','serial','windows'].includes(transport))bad('Transporte de impressão inválido');
            const host=transport==='tcp'?requireString(body.host,'IP da impressora',64):'127.0.0.1';
            if(transport==='tcp'&&!isPrivateIPv4(host))bad('Use IPv4 da rede local');
            const port=transport==='tcp'?body.port:9100;
            if(!Number.isInteger(port)||port<1||port>65535)bad('Porta inválida');
            const devicePath=transport==='serial'||transport==='windows'?body.devicePath:null;
            if(transport==='serial'&&!validateSerialDevicePath(devicePath))bad('Porta serial inválida: use COM1 ou /dev/ttyUSB0');
            if(transport==='windows'&&!validatePrinterQueueName(devicePath))bad('Nome da impressora Windows inválido');
            const baudRate=transport==='serial'?(body.baudRate??9600):9600;
            if(![9600,19200,38400,57600,115200].includes(baudRate))bad('Baud rate inválido');
            db.prepare("INSERT INTO printer_profile(id,host,port,enabled,transport,device_path,baud_rate) VALUES('default',?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET host=excluded.host,port=excluded.port,enabled=1,transport=excluded.transport,device_path=excluded.device_path,baud_rate=excluded.baud_rate").run(host,port,transport,devicePath,baudRate);
            return {profile:{host,port,enabled:1,transport,devicePath,baudRate}};
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
            const bytes=receiptBytes(JSON.parse(job.payload_json));
            if(printer.transport==='serial')await transmitSerial(printer.device_path,printer.baud_rate,bytes);
            else if(printer.transport==='windows')await transmitWindowsRaw(printer.device_path,bytes);
            else await transmit(printer.host,printer.port,bytes);
            db.prepare("UPDATE outbox_event SET status='DONE',attempts=attempts+1 WHERE id=?").run(id);
            auditForRequest(db,job.aggregate_id,'RECEIPT_SENT',{jobId:id});out={status:200,body:{id,status:'DONE',warning:'Envio ao transporte concluído; impressão física não confirmada'}};
          } catch(e) {
            db.prepare("UPDATE outbox_event SET status='FAILED',attempts=attempts+1 WHERE id=?").run(id);
            out={status:502,body:{code:'PRINT_FAILED',message:'Não foi possível enviar à impressora',jobId:id}};
          } finally {sendingPrintJobs.delete(id);}
        } else return response(res,404,{code:'NOT_FOUND',message:'Rota não encontrada'});
        return response(res,out.status,out.body);
      }
      if(method!=='GET') return response(res,405,{code:'METHOD_NOT_ALLOWED'});
      // Interface única React. URLs antigas apenas redirecionam, nunca servem o PDV legado.
      const redirects={'/':'/ui/?embedded=1','/index.html':'/ui/?embedded=1','/restaurant.html':'/ui/?device=waiter','/kitchen.html':'/ui/?device=kitchen'};
      if(Object.hasOwn(redirects,route)){
        res.writeHead(302,{'location':redirects[route],'cache-control':'no-store','x-content-type-options':'nosniff'});
        res.end();return;
      }
      // Build estático de uma única UI React, hospedada inteiramente no servidor local.
      // Apenas o output estático assinado pelo build local do Vite é servido.
      if(route==='/ui'||route==='/ui/'||route.startsWith('/ui/assets/')){
        const relative=route.startsWith('/ui/assets/')?route.slice('/ui/'.length):'index.html';
        if(relative!=='index.html'&&!/^assets\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:js|css|png|svg|webp|ico|woff2?)$/.test(relative))
          return response(res,404,{code:'NOT_FOUND'});
        const target=path.join(reactDistDir,relative);
        let info;
        try{info=fs.lstatSync(target);}
        catch(e){return response(res,relative==='index.html'?503:404,{code:relative==='index.html'?'UI_BUILD_REQUIRED':'NOT_FOUND'});}
        // Não seguir links simbólicos nem servir arquivos fora de dist.
        if(!info.isFile()||info.isSymbolicLink())return response(res,404,{code:'NOT_FOUND'});
        const ext=path.extname(target).toLowerCase();
        const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff'};
        const type=types[ext];
        if(!type)return response(res,404,{code:'NOT_FOUND'});
        res.writeHead(200,{'content-type':type,'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",'cache-control':'no-store'});
        fs.createReadStream(target).pipe(res);
        return;
      }
      // Somente portal público do cliente e recursos de atualização dos PWAs antigos.
      // As páginas operacionais clássicas e scripts administrativos não são mais servidos.
      const file=route.slice(1);
      if(!['menu.html','menu.js','menu.css','manifest.webmanifest','pwa-icon.svg','sw.js','pwa-192.png','pwa-512.png'].includes(file))
        return response(res,404,{code:'NOT_FOUND'});
      const ext=path.extname(file);
      const contentType=ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':ext==='.png'?'image/png':ext==='.svg'?'image/svg+xml':ext==='.webmanifest'?'application/manifest+json':'text/html; charset=utf-8';
      res.writeHead(200,{'content-type':contentType,'x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'cache-control':'no-store'});
      fs.createReadStream(path.join(publicDir,file)).pipe(res);
    } catch(e) {
      const status=e instanceof HttpError?e.status:400;
      return response(res,status,{code:e.code??'INVALID_OPERATION',message:e instanceof HttpError?e.message:e.message||'Erro interno'});
    }
  }

  function publicClientAddress(req){
    const remote=req.socket.remoteAddress??'unknown';
    // Caddy must overwrite X-Real-IP. Never trust a forwarded header from non-loopback peers.
    const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);
    const forwarded=req.headers['x-real-ip'];
    return local&&typeof forwarded==='string'&&net.isIP(forwarded.trim())>0?forwarded.trim():remote;
  }
  async function publicPortalHandler(req,res){
    try{
      const route=new URL(req.url,'http://localhost').pathname;
      const method=req.method;
      const rawOrigin=req.headers.origin;
      if(rawOrigin){
        let parsed;
        try{parsed=new URL(rawOrigin);}catch{throw new HttpError(403,'CROSS_ORIGIN','Origem inválida');}
        if(parsed.host!==req.headers.host||!['http:','https:'].includes(parsed.protocol))
          throw new HttpError(403,'CROSS_ORIGIN','Origem não permitida');
      }
      if(method==='GET'&&['/menu.html','/menu.js','/menu.css'].includes(route)){
        const kind=route.endsWith('.html')?'text/html':route.endsWith('.js')?'text/javascript':'text/css';
        res.writeHead(200,{'content-type':kind+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','cross-origin-resource-policy':'same-origin',
          'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'"});
        fs.createReadStream(path.join(publicDir,route.slice(1))).pipe(res);return;
      }
      if(!isPublicEnabled())return response(res,404,{code:'PUBLIC_MENU_DISABLED',message:'Cardápio indisponível'});
      const found=publicRead(db,method,route);
      if(found)return response(res,found.status,found.body);
      if(method==='POST'&&route==='/api/public/delivery/requests'){
        const body=await readJson(req),result=publicRequests.submit(body,publicClientAddress(req));
        return response(res,result.status,result.body);
      }
      return response(res,404,{code:'NOT_FOUND',message:'Rota não encontrada'});
    }catch(e){
      const status=e instanceof HttpError?e.status:500;
      return response(res,status,{code:e.code??'PUBLIC_PORTAL_ERROR',message:e instanceof HttpError?e.message:'Não foi possível concluir a solicitação'});
    }
  }
  server=lanConfig?https.createServer({cert:lanConfig.cert,key:lanConfig.key},handler):http.createServer(handler);
  return {
    get origin(){return origin;},
    listen({port=3434,host='127.0.0.1'}={}){return new Promise((resolve,reject)=>{
      if(!lanConfig&&host!=='127.0.0.1')return reject(new Error('A API LAN requer TLS e tokens por perfil'));
      if(lanConfig&&!['0.0.0.0','127.0.0.1'].includes(host))return reject(new Error('Host LAN não autorizado'));
      server.once('error',reject);server.listen(port,host,()=>{const address=server.address();origin=`${lanConfig?'https':'http'}://${host==='0.0.0.0'?'127.0.0.1':host}:${address.port}`;server.off('error',reject);peerPoller.start();resolve(origin);});
    });},
    startPublicPortal({port=3435,host='127.0.0.1'}={}){
      if(closed)return Promise.reject(new Error('Servidor encerrado'));
      if(host!=='127.0.0.1')return Promise.reject(new Error('Portal público deve escutar somente no loopback 127.0.0.1'));
      if(!Number.isSafeInteger(port)||port<0||port>65535)return Promise.reject(new Error('Porta pública inválida'));
      if(portalServer)return Promise.reject(new Error('Portal público já iniciado'));
      portalServer=http.createServer(publicPortalHandler);
      return new Promise((resolve,reject)=>{
        const onError=e=>{portalServer=null;reject(e);};
        portalServer.once('error',onError);
        portalServer.listen(port,'127.0.0.1',()=>{
          portalServer.off('error',onError);
          const actualPort=portalServer.address().port;
          resolve('http://127.0.0.1:'+actualPort);
        });
      });
    },
    syncPeersOnce(){return peerPoller.syncOnce();},
    backup(dest){return createBackup(db,dest);},
    async close(){
      if(closed)return;closed=true;
      await peerPoller.stop();
      for(const client of kitchenListeners)client.end();kitchenListeners.clear();
      if(portalServer?.listening)await new Promise(resolve=>portalServer.close(resolve));
      if(server.listening)await new Promise(resolve=>server.close(resolve));
      db.close();
    }
  };
}
