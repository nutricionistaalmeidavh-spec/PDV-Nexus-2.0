'use strict';
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
let server;
let appUrl;
app.whenReady().then(async () => {
  // Sem credenciais, cookies ou configuração externa: servidor local do usuário.
  ({ createApp: server } = await import('../server/src/server.mjs'));
  const pos=server({dataPath:path.join(app.getPath('userData'),'nexus.db'),operationMode:'demo'});
  server=pos;
  appUrl=await pos.listen({port:0});
  const window=new BrowserWindow({width:1370,height:880,minWidth:800,minHeight:650,show:false,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(appUrl+'/'))event.preventDefault();});
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.once('ready-to-show',()=>window.show());
  await window.loadURL(appUrl);
});
app.on('window-all-closed',()=>app.quit());
let shutdownInProgress = false;
app.on('before-quit', event => {
  if (!server || shutdownInProgress) return;
  event.preventDefault();
  shutdownInProgress = true;
  void server.close().finally(() => app.quit());
});
