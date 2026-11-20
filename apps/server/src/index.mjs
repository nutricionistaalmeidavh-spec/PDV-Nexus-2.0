import {createApp} from './server.mjs';
// LAN e explicitamente opt-in; segredo/configuração fora do repositório. TLS obrigatório.
const env=process.env;
const lanHost=env.PDV_LAN_HOST;
const tokens={};
for(const role of ['waiter','kitchen','manager','mirror']) {
  const variable=`PDV_LAN_${role.toUpperCase()}_TOKEN`;
  if(env[variable])tokens[role]=env[variable];
}
const lan=lanHost?{certPath:env.PDV_LAN_CERT,keyPath:env.PDV_LAN_KEY,tokens}:null;
const operationalSync=env.PDV_OPERATIONAL_PEERS_JSON?
  {peers:JSON.parse(env.PDV_OPERATIONAL_PEERS_JSON),intervalMs:Number(env.PDV_SYNC_INTERVAL_MS??60000)}:null;
const app=createApp({dataPath:env.PDV_DATA_PATH,operationMode:env.PDV_OPERATION_MODE??'demo',lan,
  publicMenuEnabled:env.PDV_PUBLIC_MENU_ENABLED==='true',operationalSync});
const origin=await app.listen({host:lanHost??'127.0.0.1',port:Number(env.PDV_PORT??3434)});
if(env.PDV_PUBLIC_PORT){
  const publicOrigin=await app.startPublicPortal({port:Number(env.PDV_PUBLIC_PORT)});
  console.log('Portal público isolado (somente loopback): '+publicOrigin);
  console.log('Para acesso externo configure um proxy HTTPS self-hosted; não exponha a porta administrativa.');
}
console.log(`PDV Nexus 2.0 (comprovantes nao fiscais + exportacao externa): ${origin}`);
if(lan)console.log('Acesso LAN exige HTTPS e um token por perfil; distribua URL e token separadamente.');
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};
process.on('SIGTERM',()=>void stop());
process.on('SIGINT',()=>void stop());
