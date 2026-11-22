/** Validated local SQLite snapshots. No cloud, third-party account or paid runtime. */
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createBackup} from './db.mjs';

const HOURS=60*60*1000;
const safeFiles=folder=>fs.existsSync(folder)?fs.readdirSync(folder)
  .filter(name=>/^auto-\d{13}-[0-9a-f-]{36}\.sqlite$/i.test(name))
  .sort():[];

export function createAutomaticBackupScheduler(db,dataPath,{
  now=Date.now,intervalMs=6*HOURS,retention=14,initialDelayMs=60_000
}={}){
  if(!Number.isSafeInteger(intervalMs)||intervalMs<1)throw new Error('Intervalo de backup inválido');
  if(!Number.isSafeInteger(retention)||retention<1||retention>365)throw new Error('Retenção de backup inválida');
  const folder=path.join(path.dirname(dataPath),'backups');
  let timer=null,initial=null,running=null,closed=false;
  async function runOnce(){
    if(closed)return null;
    if(running)return running;
    fs.mkdirSync(folder,{recursive:true,mode:0o700});
    const entries=safeFiles(folder);
    const last=entries.at(-1);
    const lastTime=last?Number(last.slice(5,18)):0;
    const timestamp=now();
    if(lastTime&&timestamp-lastTime<intervalMs)return null;
    const destination=path.join(folder,`auto-${timestamp}-${randomUUID()}.sqlite`);
    running=(async()=>{
      await createBackup(db,destination); // integrity and foreign-key verification precede rename
      const backups=safeFiles(folder);
      for(const name of backups.slice(0,Math.max(0,backups.length-retention))){
        const candidate=path.join(folder,name);
        if(fs.lstatSync(candidate).isFile())fs.rmSync(candidate,{force:true});
      }
      return destination;
    })();
    try{return await running;}finally{running=null;}
  }
  function report(error){console.error('[Nexus backup] Falha ao criar snapshot automático:',error?.message??'erro desconhecido');}
  function start(){
    if(timer||closed)return;
    initial=setTimeout(()=>{void runOnce().catch(report);},initialDelayMs);
    initial.unref?.();
    timer=setInterval(()=>{void runOnce().catch(report);},intervalMs);
    timer.unref?.();
  }
  async function stop(){
    closed=true;
    if(initial)clearTimeout(initial);
    if(timer)clearInterval(timer);
    if(running)await running.catch(()=>{});
  }
  return {start,stop,runOnce};
}
