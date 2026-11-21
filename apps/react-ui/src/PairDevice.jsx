import React,{useState} from 'react';
import {request} from './api.mjs';
/** Paired roles never receive the local operator cookie or admin modules. */
export function PairDevice({role='waiter',onPaired}){
 const [code,setCode]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const safeRole=role==='kitchen'?'kitchen':'waiter';
 const submit=async event=>{
  event.preventDefault();if(busy)return;
  setBusy(true);setError('');
  try{
   const result=await request('/api/pairing/redeem',{method:'POST',body:{code:code.trim()}});
   if(result.role!==safeRole)throw Error('Este PIN pertence a um perfil diferente. Solicite outro no caixa.');
   sessionStorage.setItem('pdv-nexus-token',result.token);
   sessionStorage.setItem('pdv-nexus-role',result.role);
   onPaired(result.token,result.role);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 };
 return <main className="authpage"><section className="authcard">
  <span className="authbrand">PDV Nexus 2.0</span>
  <h1>{safeRole==='kitchen'?'Conectar painel da cozinha':'Conectar dispositivo do garçom'}</h1>
  <p className="subtext">Digite o PIN temporário emitido no computador principal. A conexão exige HTTPS na rede local e não usa serviço em nuvem.</p>
  <form onSubmit={submit} className="stack">
   <label className="field">PIN de 6 dígitos<input autoFocus type="text" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={e=>setCode(e.target.value)} required/></label>
   <button className="btn primary" disabled={busy||code.length!==6}>{busy?'Validando...':'Parear dispositivo'}</button>
  </form>
  {error&&<p className="errorbox" role="alert">{error}</p>}
  <p className="help">Acesso limitado ao perfil pareado; nenhum dado financeiro ou de configuração é disponibilizado ao garçom ou à cozinha.</p>
 </section></main>;
}
