/** Opt-in release inquiry; no updater daemon, download or SaaS runtime dependency. */
import https from 'node:https';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const pkg=JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../../package.json',import.meta.url)),'utf8'));
export const currentVersion=pkg.version;
const parseVersion=tag=>{
 const m=typeof tag==='string'&&/^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag);
 return m?m.slice(1).map(Number):null;
};
export function compareVersions(a,b){
 const va=parseVersion(a),vb=parseVersion(b);
 if(!va||!vb)throw new Error('Versão de atualização inválida');
 for(let i=0;i<3;i++)if(va[i]!==vb[i])return va[i]>vb[i]?1:-1;
 return 0;
}
export function normalizeRelease(data){
 const latestVersion=typeof data?.tag_name==='string'?data.tag_name.replace(/^v/,''):null;
 if(!parseVersion(latestVersion))throw new Error('Release não possui versão semântica compatível');
 const url=new URL(data.html_url??'');
 if(url.origin!=='https://github.com'||!url.pathname.startsWith('/nutricionistaalmeidavh-spec/PDV-Nexus-2.0/releases/tag/'))
  throw new Error('Endereço da release não é o repositório oficial');
 return {currentVersion,latestVersion,updateAvailable:compareVersions(latestVersion,currentVersion)>0,
   url:url.href,status:compareVersions(latestVersion,currentVersion)>0?'available':'up_to_date',manual:true};
}
/** Network access is initiated ONLY when the supervisor explicitly checks for releases. */
export async function checkUpdates(){
 return new Promise(resolve=>{
  let settled=false;
  const end=data=>{if(settled)return;settled=true;resolve(data);};
  const fail=()=>end({status:'unavailable',currentVersion,updateAvailable:false,manual:true,
     message:'Não foi possível consultar versões. O caixa continua operando normalmente.'});
  const req=https.get('https://api.github.com/repos/nutricionistaalmeidavh-spec/PDV-Nexus-2.0/releases/latest',
    {headers:{'user-agent':'PDV-Nexus-2.0-local-manual-update-check','accept':'application/vnd.github+json'},
      timeout:8000},res=>{
    if(res.statusCode===404){res.resume();return end({status:'no_release',currentVersion,updateAvailable:false,manual:true});}
    if(res.statusCode!==200){res.resume();return fail();}
    let content='';
    res.on('data',chunk=>{content+=chunk.toString('utf8');if(content.length>100000)req.destroy(new Error('Resposta excede limite'));});
    res.on('end',()=>{try{end(normalizeRelease(JSON.parse(content)));}catch{fail();}});
    res.on('error',fail);
  });
  req.on('error',fail);req.on('timeout',()=>req.destroy(new Error('Timeout')));
 });
}
