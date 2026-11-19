(()=>{'use strict';
const $=id=>document.getElementById(id);
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
const node=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
let products=[],cart=new Map();
function notify(message,error=false){const el=$('menu-alert');el.hidden=false;el.textContent=message;el.classList.toggle('error',error);}
function render(){
 const items=$('menu-items');items.replaceChildren();
 if(!products.length)items.append(node('p','muted','Nenhum produto disponível.'));
 for(const p of products){
  const card=node('article','menu-card'),info=node('div');info.append(node('h3','',p.name),node('p','',p.categoryName),node('div','menu-price',money(p.priceCents)));
  const button=node('button','','Adicionar');button.type='button';button.onclick=()=>{
    const existing=cart.get(p.id)??0;if(existing>=20){notify('Limite de 20 unidades por produto.',true);return;}cart.set(p.id,existing+1);renderCart();
  };card.append(info,button);items.append(card);
 }
 renderCart();
}
function renderCart(){
 const container=$('menu-cart');container.replaceChildren();let total=0;
 for(const [id,qty] of cart){const p=products.find(x=>x.id===id);if(!p)continue;
  const row=node('div','cart-row'),info=node('div');info.append(node('strong','',qty+' × '+p.name),node('div','muted',money(p.priceCents*qty)));
  const remove=node('button','','−');remove.type='button';remove.setAttribute('aria-label','Remover uma unidade de '+p.name);remove.onclick=()=>{if(qty<=1)cart.delete(id);else cart.set(id,qty-1);renderCart();};
  row.append(info,remove);container.append(row);total+=p.priceCents*qty;
 }
 if(!cart.size)container.append(node('p','muted','Adicione produtos para continuar.'));
 $('menu-total').textContent=money(total);$('send-request').disabled=!cart.size;
}
async function init(){
 try{const r=await fetch('/api/public/menu',{cache:'no-store'}),result=await r.json();
  if(!r.ok)throw Error(result.message||'Cardápio não disponível no momento');
  products=result.products;render();
 }catch(e){$('menu-items').replaceChildren(node('p','muted','Cardápio indisponível.'));notify(e.message,true);$('send-request').disabled=true;}
}
$('menu-checkout').onsubmit=async e=>{e.preventDefault();if(!cart.size)return;
 const form=e.currentTarget,button=$('send-request'),data=new FormData(form);
 const items=[...cart].map(([productId,quantity])=>({productId,quantity}));
 button.disabled=true;try{
  const res=await fetch('/api/public/delivery/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerName:data.get('customerName'),phone:data.get('phone'),address:data.get('address'),note:data.get('note'),items})});
  const result=await res.json();if(!res.ok)throw Error(result.message||'Não foi possível enviar sua solicitação');
  notify('Solicitação registrada (protocolo '+result.requestId.slice(0,8)+'). A loja ainda precisa confirmar disponibilidade e entrega.');
  cart.clear();form.reset();renderCart();
 }catch(error){notify(error.message,true);button.disabled=false;}
};
void init();
})();
