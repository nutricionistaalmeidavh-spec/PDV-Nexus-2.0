import React,{useEffect,useState} from 'react';
import {commandId} from './api.mjs';

export function PairedDevicesPanel({mode,api}){
 const [role,setRole]=useState('waiter'),[label,setLabel]=useState('');
 const [lanUrl,setLanUrl]=useState(''),[pin,setPin]=useState(''),[until,setUntil]=useState('');
 const [devices,setDevices]=useState([]),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  if(mode!=='live')return;
  let live=true;
  api('/api/pairing/devices').then(result=>{if(live)setDevices(result.devices||[])}).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false;};
 },[mode,api,revision]);
 const destination=()=>{
  const base=new URL(lanUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash)throw Error('Informe somente a origem HTTPS privada da rede local');
  return new URL(role==='waiter'?'/restaurant.html':'/kitchen.html',base).href;
 };
 const action=async task=>{
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{await task();setRevision(x=>x+1);}
  catch(e){setError(e.message);}
  finally{setBusy(false);}
 };
 const issue=async event=>{
  event.preventDefault();
  await action(async()=>{
   destination();
   const result=await api('/api/pairing/start',{method:'POST',body:{commandId:commandId(),role,label}});
   setPin(result.code||'');setUntil(result.expiresAt||'');
   setNotice('PIN temporário emitido somente pelo host. Compartilhe-o diretamente com o operador autorizado.');
  });
 };
 const qr=()=>{
   if(!pin||!lanUrl)return null;
   try{return '/api/pairing/qr.svg?url='+encodeURIComponent(destination());}catch{return null;}
 };
 return <div className="page"><div className="pageheading"><div><p className="eyebrow">REDE LOCAL / SEGURANÇA</p><h1>Dispositivos LAN</h1><p className="subtext">Pareie garçom e cozinha em HTTPS com PIN individual, sem serviços externos.</p></div></div>
 {error&&<p className="errorbox" role="alert">{error}</p>}
 {notice&&<p className="help" role="status">{notice}</p>}
 <section className="panel"><div className="sectiontitle"><h2>Gerar novo pareamento</h2></div>
 <form className="form-grid" onSubmit={issue}>
  <label className="field">Perfil<select value={role} onChange={e=>{setRole(e.target.value);setPin('')}}><option value="waiter">Garçom</option><option value="kitchen">Cozinha KDS</option></select></label>
  <label className="field">Identificação do dispositivo<input required maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Tablet 01"/></label>
  <label className="field">Endereço HTTPS privado<input type="url" required value={lanUrl} onChange={e=>{setLanUrl(e.target.value);setPin('')}} placeholder="https://192.168.1.10:3434"/></label>
  <button className="btn primary" disabled={mode!=='live'||busy}>Gerar PIN e QR Code</button>
 </form>
 {pin&&<div className="stack"><p className="notice">PIN: <strong>{pin}</strong> · Válido até {until?new Date(until).toLocaleTimeString('pt-BR'):'expirar'}</p>
   {qr()&&<img src={qr()} width="220" height="220" alt={'QR Code de acesso ao '+(role==='waiter'?'garçom':'KDS')+' no host HTTPS'}/>}
   <p className="help">Abra a URL pelo dispositivo, faça o pareamento com o PIN e mantenha o token privado. O QR transporta apenas o endereço HTTPS; nenhum segredo fica embutido.</p>
 </div>}
 </section>
 <section className="panel"><div className="sectiontitle"><h2>Acessos emitidos</h2></div>
 {devices.map(device=><div className="list-row" key={device.id}><span className="grow"><strong>{device.label}</strong><small>{device.role} · {device.revokedAt?'Revogado':'Expira em '+device.expiresAt}</small></span>
 {!device.revokedAt&&<button className="btn secondary" disabled={busy||mode!=='live'} onClick={()=>{if(window.confirm('Revogar o acesso deste dispositivo?'))void action(async()=>{await api('/api/pairing/revoke',{method:'POST',body:{commandId:commandId(),deviceId:device.id}});setNotice('Token revogado pelo servidor.');});}}>Revogar</button>}
 </div>)}
 {!devices.length&&<p className="help">Nenhum dispositivo registrado.</p>}
 </section>
 </div>;
}
