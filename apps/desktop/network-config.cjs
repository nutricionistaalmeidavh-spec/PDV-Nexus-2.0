'use strict';
/** Per-installation LAN settings: explicit opt-in, no secrets committed to Git. */
const fs=require('node:fs');
const path=require('node:path');
function loadDesktopNetworkConfig(userData){
 const defaults={lan:null,host:'127.0.0.1',port:0,publicMenuEnabled:false,operationalSync:null};
 const configFile=path.join(userData,'network-config.json');
 if(!fs.existsSync(configFile))return defaults;
 if(fs.statSync(configFile).size>16384)throw Error('Configuração de rede excede 16 KiB');
 let data;
 try{data=JSON.parse(fs.readFileSync(configFile,'utf8'));}catch{throw Error('Configuração de rede inválida');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Configuração de rede inválida');
 const enabled=data.lan?.enabled===true;
 const port=data.port??(enabled?3434:0);
 if(!Number.isInteger(port)||port<(enabled?1024:0)||port>65535)throw Error('Porta LAN inválida');
 if(!enabled&&data.operationalSync!=null)
  throw Error('Espelhamento requer LAN segura habilitada no instalador');
 if(!enabled)return {...defaults,port};
 const lan=data.lan;
 if(!path.isAbsolute(lan.certPath??'')||!path.isAbsolute(lan.keyPath??'')||
   !fs.existsSync(lan.certPath)||!fs.existsSync(lan.keyPath))
  throw Error('LAN exige certificado e chave TLS existentes em caminhos absolutos');
 if(!lan.tokens||typeof lan.tokens!=='object'||Array.isArray(lan.tokens)||!Object.keys(lan.tokens).length)
  throw Error('LAN exige tokens individuais de pareamento');
 const roles=['waiter','kitchen','manager','mirror'];
 if(Object.keys(lan.tokens).some(role=>!roles.includes(role)||typeof lan.tokens[role]!=='string'||lan.tokens[role].length<32)
    ||new Set(Object.values(lan.tokens)).size!==Object.values(lan.tokens).length)
  throw Error('Tokens LAN inválidos ou reutilizados');
 return {lan:{certPath:lan.certPath,keyPath:lan.keyPath,tokens:lan.tokens},
  host:'0.0.0.0',port,
  publicMenuEnabled:data.publicMenuEnabled===true,
  operationalSync:data.operationalSync??null};
}
module.exports={loadDesktopNetworkConfig};
