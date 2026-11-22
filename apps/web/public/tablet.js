(()=>{'use strict';
const $=id=>document.getElementById(id),money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
let token=localStorage.getItem('nexus-tablet-token')||'',state=null,cart=[],pending=null,working=false,lastRequestId=null;
function alertMessage(message){$('alert').textContent=message;$('alert').hidden=!message;}
function view(name){for(const id of ['pairing','welcome','service','closing'])$(id).hidden=id!==name;}
async function api(route,body){
 const res=await fetch(route,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await res.json();if(!res.ok){const e=new Error(data.message||'Falha de conexão');e.status=res.status;throw e;}return data;
}
function show(){
 if(!state){view('pairing');return;}
 $('table-name').textContent=state.table.label;
 if(!state.order){cart=[];pending=null;lastRequestId=null;view('welcome');return;}
 if(state.closeRequested){view('closing');return;}
 view('service');$('order-number').textContent='Atendimento #'+state.order.id.slice(-8);
 const list=$('products');list.replaceChildren();
 for(const product of state.products){
  const article=node('article'),name=node('strong',product.name),price=node('small',money(product.priceCents)),button=node('button','Adicionar');
  button.addEventListener('click',()=>{
   const current=cart.find(x=>x.product.id===product.id);
   if(current)current.quantity++;else cart.push({product,quantity:1});
   pending=null;renderCart();
  });
  article.append(name,price,button);list.append(article);
 }
 renderCart();
}
function renderCart(){
 const c=$('cart');c.replaceChildren();let total=0;
 for(const line of cart){
  total+=line.product.priceCents*line.quantity;
  const div=node('div');div.className='cart-line';
  const name=node('span',line.quantity+' × '+line.product.name),remove=node('button','Remover');
  remove.className='secondary';
  remove.addEventListener('click',()=>{cart=cart.filter(x=>x!==line);pending=null;renderCart();});
  div.append(name,remove);c.append(div);
 }
 if(!cart.length)c.append(node('p','Selecione produtos para iniciar um pedido.'));
 $('total').textContent=money(total);
 $('send').disabled=!cart.length||working;
 $('bill').disabled=working;
}
async function reload(){
 if(!token){state=null;show();return;}
 try{state=await api('/api/tablet/state');alertMessage('');show();
  if(state.order&&lastRequestId&&!state.closeRequested){
   try{const r=await api('/api/tablet/requests/'+encodeURIComponent(lastRequestId));
    $('order-notice').textContent=r.statusText==='ACCEPTED'?'Pedido confirmado e enviado à cozinha.':r.statusText==='REJECTED'?'Pedido não aprovado. Chame o garçom.':'Pedido aguardando aprovação do garçom.';
   }catch{}
  }
 catch(e){if(e.status===401){token='';localStorage.removeItem('nexus-tablet-token');state=null;show();}
  alertMessage(e.message);}
}
$('pair-form').addEventListener('submit',async event=>{
 event.preventDefault();const next=$('pair-token').value.trim();
 if(!/^[a-f0-9]{64}$/.test(next))return alertMessage('Credencial inválida');
 token=next;localStorage.setItem('nexus-tablet-token',token);await reload();
});
$('start').addEventListener('click',async()=>{
 if(working)return;working=true;
 try{await api('/api/tablet/start',{commandId:crypto.randomUUID()});await reload();}
 catch(e){alertMessage(e.message)}finally{working=false;}
});
$('send').addEventListener('click',async()=>{
 if(working||!cart.length)return;working=true;renderCart();
 const items=cart.map(x=>({productId:x.product.id,quantity:x.quantity}));
 const fingerprint=JSON.stringify(items);
 if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,id:crypto.randomUUID()};
 try{
  const data=await api('/api/tablet/orders',{clientRequestId:pending.id,items});
  lastRequestId=data.requestId;
  $('order-notice').textContent=data.statusText==='PENDING'?'Pedido enviado para aprovação do garçom.':'Pedido enviado à cozinha.';
  cart=[];pending=null;await reload();
 }catch(e){alertMessage(e.message)}finally{working=false;renderCart();}
});
$('bill').addEventListener('click',async()=>{
 if(working)return;if(!window.confirm('Solicitar conta e bloquear novos pedidos?'))return;
 working=true;renderCart();
 try{await api('/api/tablet/close-request',{commandId:crypto.randomUUID()});await reload();}
 catch(e){alertMessage(e.message)}finally{working=false;renderCart();}
});
void reload();setInterval(()=>{if(!working&&token)void reload()},5000);
})();