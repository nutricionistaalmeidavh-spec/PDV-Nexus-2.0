(()=>{'use strict';
const $=id=>document.getElementById(id);
const token=new URLSearchParams(location.search).get('token')||'';
const money=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v/100);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
let products=[],cart=[],chosenProduct=null,pending=null,tracker=null;
function message(text,error=false){
 const e=$('table-alert');e.hidden=false;e.textContent=text;e.classList.toggle('error',error);
}
function status(text){
 $('table-status').replaceChildren(el('p','',text));
}
async function request(route,options={}){
 const r=await fetch(route,{cache:'no-store',...options});
 const body=await r.json();
 if(!r.ok)throw Error(body.message||'Não foi possível concluir a solicitação');
 return body;
}
function card(product){
 const row=el('article','menu-card'),info=el('div');
 info.append(el('h3','',product.name),el('p','',product.categoryName),el('div','menu-price',money(product.priceCents)));
 const button=el('button','','Personalizar');
 button.type='button';button.addEventListener('click',()=>customize(product));
 row.append(info,button);return row;
}
function customize(product){
 chosenProduct=product;$('table-customize-title').textContent='Personalizar '+product.name;
 $('table-qty').value='1';$('table-note').value='';
 const mods=$('table-modifiers');mods.replaceChildren();
 for(const mod of product.modifiers||[]){
  const label=el('label','table-modifier'),input=el('input');
  input.type='checkbox';input.value=mod.id;
  label.append(input,el('span','',mod.name+' · + '+money(mod.priceCents)));
  mods.append(label);
 }
 $('table-customize').showModal();
}
function renderCart(){
 const container=$('table-cart');container.replaceChildren();let total=0;
 if(!cart.length)container.append(el('p','muted','Adicione produtos ao seu pedido.'));
 cart.forEach((entry,i)=>{
  const row=el('div','cart-row'),info=el('div');
  const unit=entry.product.priceCents+entry.mods.reduce((n,m)=>n+m.priceCents,0);
  total+=unit*entry.quantity;
  info.append(el('strong','',entry.quantity+' × '+entry.product.name),
    el('span','table-cart-note',entry.mods.map(m=>m.name).join(', ')),
    el('span','table-cart-note',entry.note),el('strong','',money(unit*entry.quantity)));
  const remove=el('button','','Remover');remove.type='button';
  remove.addEventListener('click',()=>{cart.splice(i,1);pending=null;renderCart()});
  row.append(info,remove);container.append(row);
 });
 $('table-total').textContent=money(total);
 $('table-send').disabled=!cart.length;
}
function track(requestId){
 if(tracker)clearInterval(tracker);
 const check=async()=>{
  try{
   const data=await request('/api/public/table/'+encodeURIComponent(token)+'/requests/'+encodeURIComponent(requestId));
   const names={PENDING:'Recebido. Aguardando o atendente aprovar seu pedido.',ACCEPTED:'Pedido aprovado e enviado para a cozinha.',REJECTED:'Solicitação recusada. Consulte o atendente.'};
   status(names[data.statusText]||'Status: '+data.statusText);
   if(data.statusText!=='PENDING'&&tracker){clearInterval(tracker);tracker=null;}
  }catch(err){status('Não foi possível consultar o andamento: '+err.message);if(tracker){clearInterval(tracker);tracker=null;}}
 };
 void check();tracker=setInterval(check,5000);
}
$('table-cancel').addEventListener('click',()=>$('table-customize').close());
$('table-customize-form').addEventListener('submit',e=>{
 e.preventDefault();
 if(!chosenProduct)return;
 const quantity=Number($('table-qty').value);
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>20)return message('Quantidade entre 1 e 20.',true);
 if(cart.length>=20)return message('Limite de 20 itens por solicitação.',true);
 const ids=[...$('table-modifiers').querySelectorAll('input:checked')].map(x=>x.value);
 const mods=(chosenProduct.modifiers||[]).filter(m=>ids.includes(m.id));
 cart.push({product:chosenProduct,quantity,mods,note:$('table-note').value.trim()});
 pending=null;renderCart();$('table-customize').close();
});
$('table-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!cart.length)return;
 const items=cart.map(x=>({productId:x.product.id,quantity:x.quantity,modifierIds:x.mods.map(m=>m.id),note:x.note}));
 const guestName=new FormData(e.currentTarget).get('guestName')||'';
 const fingerprint=JSON.stringify({items,guestName});
 if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,clientRequestId:crypto.randomUUID()};
 const data={clientRequestId:pending.clientRequestId,guestName,items};
 $('table-send').disabled=true;
 try{
  const res=await request('/api/public/table/'+encodeURIComponent(token)+'/requests',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  cart=[];pending=null;renderCart();message('Pedido registrado: '+res.requestId.slice(0,8));
  track(res.requestId);
 }catch(err){message(err.message,true);$('table-send').disabled=false;}
});
(async()=>{
 if(!/^[0-9a-f]{64}$/.test(token)){message('QR de mesa inválido.',true);return;}
 try{
  const data=await request('/api/public/table/'+encodeURIComponent(token));
  products=data.products||[];
  $('table-label').textContent=data.tableLabel;
  $('table-products').replaceChildren(...products.map(card));
  if(!products.length)$('table-products').append(el('p','muted','Cardápio indisponível.'));
  renderCart();
  status(data.approvalMode==='automatic'?'Seu pedido será enviado à cozinha após registrar.':'O atendente aprovará o pedido antes do preparo.');
 }catch(err){$('table-products').replaceChildren(el('p','muted','Cardápio indisponível.'));message(err.message,true);}
})();
})();
