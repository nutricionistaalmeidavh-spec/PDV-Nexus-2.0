'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
let server;
let appUrl;
app.whenReady().then(async () => {
  // Sem credenciais, cookies ou configuração externa: servidor local do usuário.
  ({ createApp: server } = await import('../server/src/server.mjs'));
  const manifestPath=path.join(__dirname,'edition-manifest.json');
  const edition=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{commercialActivation:false};
  const dataPath=path.join(app.getPath('userData'),'nexus.db');
  const commercialLicense=edition.commercialActivation===true?{
    required:true,publicJwk:edition.publicJwk,endpoint:edition.endpoint,
    storagePath:dataPath+'.license.json'
  }:{required:false};
  const pos=server({dataPath,operationMode:'production',commercialLicense});
  server=pos;
  appUrl=await pos.listen({port:0});
  const window=new BrowserWindow({width:1370,height:880,minWidth:800,minHeight:650,show:false,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(appUrl+'/'))event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.once('ready-to-show',()=>window.show());
  await window.loadURL(appUrl+'/ui/?embedded=1');
});
app.on('window-all-closed',()=>app.quit());
let shutdownInProgress = false;
app.on('before-quit', event => {
  if (!server || shutdownInProgress) return;
  event.preventDefault();
  shutdownInProgress = true;
  void server.close().finally(() => app.quit());
});
