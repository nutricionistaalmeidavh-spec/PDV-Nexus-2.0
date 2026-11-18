(()=>{'use strict';const $=id=>document.getElementById(id),uuid=()=>crypto.randomUUID();let token=sessionStorage.getItem('pdv-nexus-token')||'',busy=false;
let streamController=null;
const states=[{status:'PENDING',label:'Aguardando',next:'PREPARING',button:'Iniciar preparo'},{status:'PREPARING',label:'Preparando',next:'READY',button:'Marcar pronto'},{status:'READY',label:'Prontos',next:'SERVED',button:'Entregue'}];
const node=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
const alert=(message,error=true)=>{const n=$('kitchen-alert');n.textContent=message;n.classList.toggle('error',error);n.hidden=false;setTimeout(()=>n.hidden=true,5000);};
async function api(method,route,body){const headers={};if(token)headers.authorization='Bearer '+token;if(body)headers['content-type']='application/json';let r;try{r=await fetch(route,{method,headers,body:body?JSON.stringify(body):undefined});}catch{throw Error('Conexão com host perdida. Nenhuma atualização confirmada.');}const value=await r.json();if(!r.ok)throw Error(value.message||`Erro ${r.status}`);return value;}
async function update(ticket,next){try{await api('POST',`/api/kitchen/tickets/${ticket.id}/status`,{commandId:uuid(),expectedRevision:ticket.revision,status:next});await refresh();}catch(e){alert(e.message);await refresh().catch(()=>{});}}
async function refresh(){if(busy)return;busy=true;try{const {tickets}=await api('GET','/api/kitchen/tickets'),board=$('kitchen-board');board.replaceChildren();for(const state of states){const col=node('section','panel kitchen-column');col.append(node('h2','',`${state.label} (${tickets.filter(t=>t.status===state.status).length})`));for(const t of tickets.filter(t=>t.status===state.status)){const card=node('article','kitchen-ticket');card.append(node('strong','',t.tableLabel||'Balcão/Retirada'),node('p','',`${t.quantity} × ${t.productName}`));if(t.modifiers)card.append(node('small','',`Adicionais: ${t.modifiers}`));if(t.note)card.append(node('small','',`Obs.: ${t.note}`));card.append(node('small','',`Pedido ${t.orderId.slice(0,8)}`));const button=node('button','button primary',state.button);button.onclick=()=>update(t,state.next);card.append(button);col.append(card);}board.append(col);}$('kitchen-connection').textContent='Host conectado · atualizado agora';$('kitchen-connection').classList.remove('offline');}catch(e){$('kitchen-connection').textContent='Host indisponível';$('kitchen-connection').classList.add('offline');alert(e.message);}finally{busy=false;}}
async function connectLive(){
  if(streamController)streamController.abort();
  const controller=new AbortController();streamController=controller;
  let backoff=1500;
  while(!controller.signal.aborted){
    try{
      const headers=token?{authorization:'Bearer '+token}:{};
      const r=await fetch('/api/kitchen/events',{headers,signal:controller.signal,cache:'no-store'});
      if(!r.ok)throw Error('Acesso ao feed da cozinha negado: '+r.status);
      backoff=1500;
      $('kitchen-connection').textContent='KDS conectado · atualizações em tempo real';
      $('kitchen-connection').classList.remove('offline');
      const reader=r.body.getReader();let buffer='';
      while(!controller.signal.aborted){
        const {value,done}=await reader.read();if(done)break;
        buffer+=new TextDecoder().decode(value,{stream:true});
        let split;while((split=buffer.indexOf('\n\n'))>=0){
          const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);
          if(frame.includes('event: changed'))void refresh();
        }
        if(buffer.length>4096)buffer='';
      }
    }catch(e){
      if(!controller.signal.aborted){$('kitchen-connection').textContent='Feed interrompido; reconectando';$('kitchen-connection').classList.add('offline');}
    }
    if(controller.signal.aborted)break;
    await new Promise(resolve=>setTimeout(resolve,backoff));
    backoff=Math.min(backoff*2,15000);
  }
}
$('pair-device').onclick=()=>{const next=prompt('Token de acesso da cozinha:',token);if(next===null)return;token=next.trim();sessionStorage.setItem('pdv-nexus-token',token);refresh();void connectLive();};
window.pdvAuth.ready().then(()=>{refresh();void connectLive();setInterval(refresh,30000);}).catch(e=>alert(e.message));
})();
