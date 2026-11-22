/** Controle de acesso por perfil na rede local: sempre HTTPS e token explícito. */
import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';

const ROLES=['waiter','kitchen','manager','mirror'];
const sha=s=>createHash('sha256').update(s).digest();
export function validateLanConfig(lan) {
  if(!lan) return null;
  if(typeof lan.certPath!=='string'||typeof lan.keyPath!=='string') throw new Error('Rede LAN exige certificado e chave TLS');
  if(!fs.existsSync(lan.certPath)||!fs.existsSync(lan.keyPath))throw new Error('Certificado TLS não encontrado');
  const tokens=lan.tokens??{};
  if(!Object.values(tokens).length)throw new Error('Rede LAN exige token de pareamento por perfil');
  for(const [role,token] of Object.entries(tokens)) {
    if(!ROLES.includes(role)||typeof token!=='string'||token.length<32)throw new Error('Token LAN inválido (32 caracteres mínimo)');
  }
  if(new Set(Object.values(tokens)).size!==Object.values(tokens).length)throw new Error('Tokens LAN não podem ser compartilhados entre perfis');
  return {cert:fs.readFileSync(lan.certPath),key:fs.readFileSync(lan.keyPath),digests:Object.entries(tokens).map(([role,token])=>({role,hash:sha(token)}))};
}
export function lanRole(req,config,dynamicRole=()=>null) {
  if(!config)return 'local';
  const address=req.socket.remoteAddress;
  const host=req.headers.host??'';
  if((address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1') && /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host))return 'local';
  const auth=req.headers.authorization;
  if(typeof auth!=='string'||!auth.startsWith('Bearer '))return null;
  const token=auth.slice(7);
  if(token.length<32||token.length>512)return null;
  const digest=sha(token);
  const match=config.digests.find(entry=>timingSafeEqual(entry.hash,digest));
  return match?.role??dynamicRole(token);
}
export function roleAllows(role,method,route) {
  if(role==='local'||role==='manager')return true;
  if(role==='mirror')return method==='GET'&&route==='/api/sync/operational/export';
  if(role==='kitchen') return (method==='GET'&&['/api/kitchen/tickets','/api/kitchen/events'].includes(route)) ||
    (method==='POST'&&/^\/api\/kitchen\/tickets\/[^/]+\/status$/.test(route)) ||
    (method==='GET'&&route==='/api/health');
  if(role==='waiter')return (method==='GET'&&(
    (route==='/api/attendance/overview'||route==='/api/attendance/analytics'||route==='/api/attendance/me')||
    ['/api/products','/api/orders','/api/tables','/api/restaurant/summary','/api/health'].includes(route)||
    /^\/api\/orders\/[^/]+$/.test(route)||
    /^\/api\/orders\/[^/]+\/line-history$/.test(route)||
    /^\/api\/tables\/[^/]+\/requests$/.test(route)||
    /^\/api\/products\/[^/]+\/modifiers$/.test(route))) ||
    (method==='POST'&&(
      route==='/api/orders'|| /^\/api\/tables\/[^/]+\/open$/.test(route)||
      /^\/api\/orders\/[^/]+\/waiter$/.test(route)||
      /^\/api\/attendance\/tickets\/[^/]+\/(claim|deliver)$/.test(route)||
      /^\/api\/orders\/[^/]+\/(lines|confirm|transfer-table)$/.test(route)||
      /^\/api\/orders\/[^/]+\/lines\/[^/]+\/(edit|cancel)$/.test(route)||
      /^\/api\/tables\/[^/]+\/qr$/.test(route)||
      /^\/api\/table-requests\/[^/]+\/(accept|reject)$/.test(route)));
  return false;
}
