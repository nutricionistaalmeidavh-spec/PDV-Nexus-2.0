(() => {
  'use strict';
  let currentUser=null;
  const isHost=['localhost','127.0.0.1'].includes(location.hostname);
  const node=(tag,cls,content)=>{const e=document.createElement(tag);e.className=cls;if(content!==undefined)e.textContent=content;return e;};
  async function send(route,data){
    const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const result=await r.json();
    if(!r.ok)throw Error(result.message||'Não foi possível autenticar');
    return result;
  }
  const ready=new Promise(async resolve=>{
    if(!isHost){resolve(null);return;}
    const screen=node('section','nexus-auth-screen');
    screen.setAttribute('role','dialog');screen.setAttribute('aria-modal','true');
    screen.setAttribute('aria-label','Acesso ao PDV Nexus');
    const panel=node('div','nexus-auth-panel');
    const heading=node('h1','', 'Acesso ao PDV Nexus');
    const hint=node('p','', 'Conta local do estabelecimento. Não exige internet ou assinatura.');
    const error=node('p','nexus-auth-error');error.setAttribute('role','alert');
    const form=document.createElement('form');
    form.id='operator-login-form';
    const username=document.createElement('input');username.name='username';username.required=true;username.minLength=3;username.maxLength=40;username.autocomplete='username';
    const password=document.createElement('input');password.name='password';password.type='password';password.required=true;password.minLength=12;password.maxLength=128;password.autocomplete='current-password';
    const userLabel=node('label','', 'Usuário');userLabel.append(username);
    const passLabel=node('label','', 'Senha (mínimo de 12 caracteres)');passLabel.append(password);
    const button=node('button','button primary full','Entrar');button.type='submit';
    form.append(userLabel,passLabel,button);
    panel.append(heading,hint,error,form);screen.append(panel);document.body.append(screen);
    async function configure(){
      try{
        const r=await fetch('/api/auth/status',{cache:'no-store'});const status=await r.json();
        if(status.authenticated){
          currentUser=status.user;screen.remove();resolve(currentUser);mountLogout();return;
        }
        const setup=!!status.needsSetup;
        heading.textContent=setup?'Configurar primeiro supervisor':'Entrar no caixa';
        hint.textContent=setup?'Defina a conta administradora deste computador. Guarde a senha: não existe recuperação por nuvem.':'Informe as credenciais locais do operador.';
        button.textContent=setup?'Criar supervisor':'Entrar';
        password.autocomplete=setup?'new-password':'current-password';
        form.onsubmit=async event=>{
          event.preventDefault();button.disabled=true;error.textContent='';
          try{
            const result=await send(setup?'/api/auth/setup':'/api/auth/login',{username:username.value,password:password.value});
            currentUser=result.user;screen.remove();resolve(currentUser);mountLogout();
          }catch(e){error.textContent=e.message;password.select();}finally{button.disabled=false;}
        };
        username.focus();
      }catch(e){error.textContent='Host indisponível. Recarregue a página quando o serviço estiver ativo.';button.disabled=true;}
    }
    function mountLogout(){
      const bar=document.querySelector('.topbar-right')||document.querySelector('.restaurant-nav');
      if(!bar)return;
      const logout=node('button','button ghost',currentUser.username+' · Sair');
      logout.type='button';logout.setAttribute('aria-label','Sair da conta de operador');
      logout.onclick=async()=>{try{await send('/api/auth/logout',{});}finally{location.reload();}};
      bar.prepend(logout);
    }
    await configure();
  });
  window.pdvAuth={ready:()=>ready,get currentUser(){return currentUser;}};
})();
