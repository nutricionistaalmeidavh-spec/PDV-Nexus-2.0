import React,{useEffect,useState} from 'react';
export function Maintenance({mode,api}){
 const [version,setVersion]=useState(null),[backups,setBackups]=useState([]),[updates,setUpdates]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const reload=async()=>{
  const [v,b]=await Promise.all([api('/api/system/version'),api('/api/system/backups')]);
  setVersion(v);setBackups(b.backups||[]);
 };
 useEffect(()=>{if(mode!=='live')return;let active=true;
  Promise.all([api('/api/system/version'),api('/api/system/backups')]).then(([v,b])=>{
   if(active){setVersion(v);setBackups(b.backups||[]);}
  }).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false};
 },[mode,api]);
 const action=async fn=>{setError('');setNotice('');setBusy(true);try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}};
 const check=()=>void action(async()=>{setUpdates(await api('/api/system/update/check'))});
 const backup=()=>void action(async()=>{
  const result=await api('/api/system/backup',{method:'POST',body:{commandId:crypto.randomUUID()}});
  setNotice('Backup SQLite validado: '+result.path);
  await reload();
 });
 return <div className="page">
  <div className="pageheading"><div><p className="eyebrow">MANUTENÇÃO / LOCAL FIRST</p><h1>Backup e atualizações</h1><p className="subtext">Nenhum serviço externo é necessário para abrir o caixa. Atualizações não são instaladas automaticamente.</p></div></div>
  {error&&<p className="errorbox" role="alert">{error}</p>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  {mode!=='live'?<section className="panel">Conecte e autentique o host local para utilizar a manutenção.</section>:<>
   <section className="panel"><h2>Versão instalada</h2><p className="hero-number">{version?.version||'Consultando...'}</p>
    <button className="btn secondary" type="button" disabled={busy} onClick={check}>Verificar atualização disponível</button>
    {updates&&<div className="stack"><p className="help">{updates.status==='available'?'Há uma versão publicada mais recente':updates.status==='up_to_date'?'Versão atualizada':updates.status==='no_release'?'Ainda não existe release publicada':'Consulta indisponível; o caixa permanece funcional'}</p>
    {updates.latestVersion&&<p>Última versão: {updates.latestVersion}</p>}
    {updates.url&&<a href={updates.url} target="_blank" rel="noopener noreferrer">Abrir release oficial no GitHub</a>}</div>}
    <p className="help">Confira o instalador antes de atualizar. O sistema não executa downloads nem alterações automáticas.</p>
   </section>
   <section className="panel"><h2>Proteção de dados</h2><p className="help">O backup é criado na pasta local do host, validado antes de finalizar. Quando há atualização de schema, um backup pré-migração também é salvo automaticamente.</p>
    <button className="btn primary" type="button" disabled={busy} onClick={backup}>Criar backup agora</button>
    <h3>Backups no computador</h3><div className="stack">{backups.map(x=><div className="list-row" key={x.name}><strong>{x.name}</strong><small>{(x.sizeBytes/1024).toFixed(0)} KB · {new Date(x.modifiedAt).toLocaleString('pt-BR')}</small></div>)}</div>
    {!backups.length&&<p className="help">Nenhum backup listado.</p>}
   </section>
   <section className="panel"><h2>Restauração assistida e offline</h2><p className="help">Para preservar a integridade, a restauração é feita com o PDV completamente fechado. Primeiro inspecione o arquivo, depois execute o comando offline indicado na documentação do projeto. O backup anterior é preservado.</p>
    <a href="https://github.com/nutricionistaalmeidavh-spec/PDV-Nexus-2.0/blob/main/docs/RESTAURACAO_E_ATUALIZACAO.md" target="_blank" rel="noopener noreferrer">Instruções de restauração segura</a>
   </section>
  </>}
 </div>;
}
