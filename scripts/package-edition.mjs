/** Package the MIT edition or a commercial edition with a PUBLIC verification key.
 * No secret signing key, Cloudflare token, or paid service belongs in a client build.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=path.join(root,'apps/desktop/edition-manifest.json');
const edition=process.argv[2],platform=process.argv[3]||'win';
if(!['free','commercial'].includes(edition)||!['win','linux'].includes(platform))throw Error('Uso: node scripts/package-edition.mjs free|commercial win|linux');
if(fs.existsSync(manifest))throw Error('Manifesto temporario presente: remova somente apos verificar que nao ha outro build em andamento');
let config={commercialActivation:false};
if(edition==='commercial'){
  const publicKeyPath=process.env.NEXUS_LICENSE_PUBLIC_JWK_FILE;
  if(!publicKeyPath)throw Error('Informe NEXUS_LICENSE_PUBLIC_JWK_FILE (chave PUBLICA, nunca privada)');
  const key=JSON.parse(fs.readFileSync(publicKeyPath,'utf8'));
  if(key.kty!=='EC'||key.crv!=='P-256'||!key.x||!key.y||key.d)throw Error('Arquivo deve conter apenas a chave publica P-256');
  const endpoint=process.env.NEXUS_LICENSE_ENDPOINT||'https://pdv-artisys.sistema-artisys.workers.dev';
  const target=new URL(endpoint);
  if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash)throw Error('Endpoint HTTPS invalido');
  config={commercialActivation:true,publicJwk:{kty:'EC',crv:'P-256',x:key.x,y:key.y},endpoint};
}
fs.writeFileSync(manifest,JSON.stringify(config),{mode:0o600,flag:'wx'});
try{
  const cli=path.join(root,'node_modules','electron-builder','cli.js');
  if(!fs.existsSync(cli))throw Error('electron-builder nao instalado: execute npm ci antes do build');
  const r=spawnSync(process.execPath,[cli,'--'+platform,platform==='win'?'nsis':'AppImage','--x64','--publish','never'],{cwd:root,stdio:'inherit'});
  if(r.error)throw r.error;
  if(r.status!==0)throw Error('Falha no empacotamento: '+r.status);
}finally{
  fs.unlinkSync(manifest);
}
