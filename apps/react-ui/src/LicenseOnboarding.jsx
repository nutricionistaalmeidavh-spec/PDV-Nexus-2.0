import React,{useState} from 'react';

/** Commercial onboarding is separate from local operator credentials. */
export function LicenseOnboarding({license,onActivated,onReadOnly}){
  const [email,setEmail]=useState(license?.email||'');
  const [code,setCode]=useState('');
  const expired=['EXPIRED','SUSPENDED'].includes(license?.reason);
  const [step,setStep]=useState(expired?'code':'email');
  const [manual,setManual]=useState(expired);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const submit=async event=>{
    event.preventDefault();setError('');setNotice('');setBusy(true);
    try{
      const endpoint=step==='email'?'/api/license/trial/request':manual?'/api/license/activate':'/api/license/trial/confirm';
      const payload=step==='email'?{email}:{email,code};
      const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(j.message||j.error||'Não foi possível concluir a solicitação.');
      if(step==='email'){setStep('code');setNotice('Se o cadastro for elegível, enviamos um código de confirmação ao e-mail informado.');}
      else onActivated(j);
    }catch(e){setError(e.message)}
    finally{setBusy(false)}
  };
  return <main className="authpage">
    <section className="authcard">
      <span className="authbrand">▣ PDV Nexus <b>2.0</b></span>
      <h1>{expired?'Avaliação encerrada ou suspensa':'Ative sua avaliação de 3 dias'}</h1>
      <p className="subtext">{expired?
        'Seu período de avaliação terminou. Os dados locais foram preservados. Informe um código comercial para continuar operando.':
        'Confirme seu e-mail para liberar 72 horas de uso da edição comercial. Nenhum cartão é necessário.'}</p>
      {license?.expiresAt&&<p className="notice" role="status">Validade da licença anterior: {new Date(license.expiresAt).toLocaleString('pt-BR')}</p>}
      <form onSubmit={submit} className="stack">
        <label className="field">E-mail da empresa
          <input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}
            maxLength={254} required disabled={busy||step==='code'}/>
        </label>
        {step==='code'&&<label className="field">Código de seis dígitos
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
            value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} required disabled={busy}/>
        </label>}
        {notice&&<p className="notice" role="status">{notice}</p>}
        {error&&<p className="errorbox" role="alert">{error}</p>}
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy?'Aguarde…':step==='email'?'Enviar código de confirmação':manual?'Ativar licença comercial':'Confirmar e ativar 3 dias'}
        </button>
        {step==='code'&&!expired&&<button type="button" className="btn secondary block" disabled={busy} onClick={()=>{setStep('email');setCode('');setNotice('');setError('')}}>Corrigir e-mail ou reenviar código</button>}
      </form>
      <div className="stack" style={{marginTop:16}}>
        {!expired&&<button type="button" className="btn secondary block" onClick={()=>{setManual(x=>!x);setStep(manual?'email':'code');setCode('');setError('');setNotice('')}} disabled={busy}>
          {manual?'Voltar para avaliação gratuita':'Já tenho um código de licença comercial'}
        </button>}
        {expired&&<button type="button" className="btn secondary block" onClick={onReadOnly}>
          Consultar meus dados e fazer backup
        </button>}
      </div>
      <p className="help">A conta do operador e a senha permanecem no computador. A Central recebe apenas os dados necessários para ativar a licença.</p>
    </section>
  </main>;
}
