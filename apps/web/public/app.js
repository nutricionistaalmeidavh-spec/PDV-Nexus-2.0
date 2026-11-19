(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
  const toCents=v=>{const n=Number(v);if(!Number.isFinite(n)||n<0||Math.round(n*100)!==n*100 && Math.abs(Math.round(n*100)-n*100)>0.000001)throw Error('Valor monetário inválido');return Math.round(n*100);};
  const uid=()=>crypto.randomUUID();
  let products=[],categories=[],order=null, session=null, view='pos';
  const show=(message,error=false)=>{const toast=$('toast');toast.textContent=message;toast.classList.toggle('error',error);toast.hidden=false;setTimeout(()=>toast.hidden=true,4500);};
  const api=async(method,url,data)=>{
    const opts={method,headers:data?{'content-type':'application/json'}:{}};
    if(data)opts.body=JSON.stringify(data);
    let response;
    try{response=await fetch(url,opts);}catch{ $('connection').textContent='Host indisponível';$('connection').classList.add('offline');throw Error('O host local está indisponível'); }
    const result=await response.json();if(!response.ok)throw Error(result.message||'Erro na operação');
    $('connection').textContent='Host local conectado';$('connection').classList.remove('offline');return result;
  };
  const text=(el,value)=>{el.textContent=String(value);return el;};
  const elt=(tag,cls='',value='')=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined&&value!==null)text(e,value);return e;};
  const renderProducts=()=>{
    const grid=$('product-grid'),list=$('product-list'),filter=$('search').value.toLocaleLowerCase('pt-BR');grid.replaceChildren();list.replaceChildren();
    const active=products.filter(p=>p.active!==0&&p.categoryActive!==0&&p.name.toLocaleLowerCase('pt-BR').includes(filter));
    if(!active.length)grid.append(elt('p','empty','Nenhum produto encontrado. Cadastre no Cardápio.'));
    for(const product of active){
      const button=elt('button','product');button.type='button';button.append(elt('span','product-name',product.name),elt('span','product-price',money(product.priceCents)));
      button.addEventListener('click',()=>perform(async()=>addProductToOrder(product)));grid.append(button);
    }
    const modSelect=$('modifier-product');modSelect.replaceChildren();for(const p of products.filter(p=>p.active&&p.categoryActive)){const opt=elt('option','',p.name);opt.value=p.id;modSelect.append(opt);}
    const comboSelect=$('combo-components');comboSelect.replaceChildren();for(const p of products.filter(p=>p.active&&p.categoryActive&&!p.isCombo)){const opt=elt('option','',p.name);opt.value=p.id;comboSelect.append(opt);}
    for(const product of products){
      const row=elt('div','data-row'),info=elt('div');info.append(elt('b','',product.name),elt('small','',`ID: ${product.id.slice(0,8)}`));
      const state=elt('span','',product.active&&product.categoryActive?'Ativo':'Inativo');
      const edit=elt('button','button secondary','Editar');
      edit.onclick=()=>perform(async()=>{
        const name=prompt('Nome do produto',product.name);if(!name?.trim())return;
        const price=prompt('Preço (R$)',(product.priceCents/100).toFixed(2));if(price===null)return;
        await api('PATCH','/api/products/'+product.id,{commandId:uid(),name,priceCents:toCents(price)});
        show('Produto atualizado');await refresh();
      });
      const toggle=elt('button','button ghost',product.active?'Desativar':'Reativar');
      toggle.disabled=!product.active&&product.categoryActive===0;
      toggle.onclick=()=>perform(async()=>{
        await api('PATCH','/api/products/'+product.id,{commandId:uid(),active:!product.active});
        show('Disponibilidade atualizada');await refresh();
      });
      row.append(info,elt('span','',money(product.priceCents)),state,edit,toggle);list.append(row);
    }
  };

  function renderCategories(){
    const list=$('categories-list'),select=$('product-category');list.replaceChildren();select.replaceChildren();
    for(const cat of categories){
      if(cat.active){const option=elt('option','',cat.name);option.value=cat.id;select.append(option);}
      const row=elt('div','data-row'),label=elt('div');
      label.append(elt('strong','',cat.name),elt('small','',cat.active?'Ativa':'Arquivada'));
      row.append(label);
      if(cat.id!=='c-default'&&cat.active){
        const edit=elt('button','button secondary','Renomear');
        edit.onclick=()=>perform(async()=>{
          const name=prompt('Nome da categoria',cat.name);if(!name?.trim())return;
          await api('PATCH','/api/categories/'+cat.id,{commandId:uid(),name});
          await refresh();show('Categoria renomeada');
        });
        const archive=elt('button','button ghost','Arquivar');
        archive.onclick=()=>perform(async()=>{
          if(!confirm('Os produtos desta categoria ficarão indisponíveis para novas vendas. Confirmar?'))return;
          await api('POST','/api/categories/'+cat.id+'/archive',{commandId:uid()});
          await refresh();show('Categoria arquivada, histórico preservado');
        });
        row.append(edit,archive);
      }
      list.append(row);
    }
  }
  const renderOrder=()=>{
    const lines=$('cart-lines');lines.replaceChildren();
    const status=order?.status??'EMPTY';$('order-status').textContent={EMPTY:'Novo pedido',DRAFT:'Rascunho',OPEN:'Confirmado',CLOSED:'Fechado',CANCELLED:'Cancelado'}[status]||status;
    const lineList=order?.lines??[];
    if(!lineList.length)lines.append(elt('p','empty','Adicione produtos para iniciar um pedido.'));
    for(const line of lineList){const row=elt('div','cart-line'),info=elt('div');info.append(elt('strong','',line.productName),elt('small','',`${line.quantity} × ${money(line.unitPriceCents)}`));row.append(info,elt('span','line-price',money(line.quantity*line.unitPriceCents)));lines.append(row);}
    $('cart-total').textContent=money(order?.totalCents??0);
    $('confirm-order').disabled=status!=='DRAFT'||!lineList.length;
    $('pay-order').disabled=status!=='OPEN'||!session;
    $('cancel-order').disabled=!['DRAFT','OPEN'].includes(status);
    $('split-order').disabled=!['DRAFT','OPEN'].includes(status)||!lineList.length;
    if(!['DRAFT','OPEN'].includes(status))$('split-summary').textContent='';
  };
  async function refresh(){const [p,c,cat]=await Promise.all([api('GET','/api/products'),api('GET','/api/cash/current'),api('GET','/api/categories')]);products=p.products;session=c.session;categories=cat.categories;renderProducts();renderCategories();renderOrder();renderCash();}
  async function perform(task){try{await task();}catch(e){show(e.message,true);}}
  async function showSplit(){
    if(!order)return;
    const r=await api('GET','/api/orders/'+order.id+'/split');
    const split=r.split;
    $('split-summary').textContent=split.guests.length?split.guests.map(x=>x.guest+': '+money(x.totalCents)).join(' · '):'Comanda não dividida';
  }
  async function addProductToOrder(product){
    if(!order||['CLOSED','CANCELLED'].includes(order.status))order=(await api('POST','/api/orders',{commandId:uid(),serviceMode:'counter'})).order;
    const result=await api('POST',`/api/orders/${order.id}/lines`,{commandId:uid(),expectedRevision:order.revision,productId:product.id,quantity:1});
    order=result.order;renderOrder();$('split-summary').textContent='';show(`${product.name} adicionado`);
  }
  async function changeView(next){view=next;document.querySelectorAll('.view').forEach(e=>e.classList.toggle('visible',e.id==='view-'+next));document.querySelectorAll('[data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===next));$('view-title').textContent={pos:'Caixa e vendas',products:'Cardápio',history:'Histórico de pedidos',cash:'Gestão do caixa',print:'Impressão',devices:'Dispositivos',fiscal:'Exportação de vendas',stock:'Estoque & fichas',delivery:'Delivery'}[next];
    if(next==='history')await renderHistory();if(next==='devices')await renderPairedDevices();if(next==='print')await renderPrint();if(next==='cash'){const c=await api('GET','/api/cash/current');session=c.session;renderCash();}
  }
  async function renderHistory(){const result=await api('GET','/api/orders'),container=$('history-list');container.replaceChildren();if(!result.orders.length)container.append(elt('p','empty','Nenhum pedido registrado.'));for(const item of result.orders){const row=elt('div','data-row'),info=elt('div');info.append(elt('b','',`Pedido ${item.id.slice(0,8)}`),elt('small','',`${item.serviceMode} · ${new Date(item.createdAt).toLocaleString('pt-BR')}`));row.append(info,elt('span','',item.status));if(item.status==='CLOSED'&&window.pdvAuth.currentUser?.role==='admin'){const b=elt('button','button ghost','Registrar devolução');b.addEventListener('click',()=>perform(async()=>{const reason=prompt('Motivo da devolução integral');if(!reason?.trim())return;const externalRefundConfirmed=confirm('Se houve Pix/cartão, a devolução já foi feita externamente? Confirme somente após executá-la.');await api('POST',`/api/orders/${item.id}/refund`,{commandId:uid(),reason,externalRefundConfirmed});show('Devolução registrada');await renderHistory();}));row.append(b);}if(['DRAFT','OPEN'].includes(item.status)){const btn=elt('button','button secondary','Abrir no caixa');btn.addEventListener('click',()=>perform(async()=>{order=(await api('GET',`/api/orders/${item.id}`)).order;renderOrder();await changeView('pos');show('Comanda carregada');}));row.append(btn);}container.append(row);}}

  async function renderPairedDevices(){
    const data=await api('GET','/api/pairing/devices'),list=$('paired-device-list');
    list.replaceChildren();
    for(const device of data.devices){
      const row=elt('div','data-row'),info=elt('div');
      info.append(elt('strong','',device.label),elt('small','',device.role==='waiter'?'Garçom':'Cozinha'));
      const state=elt('span','',device.revokedAt?'Revogado':new Date(device.expiresAt)<new Date()?'Expirado':'Ativo');
      row.append(info,state);
      if(!device.revokedAt){
        const revoke=elt('button','button ghost','Revogar');
        revoke.onclick=()=>perform(async()=>{
          if(!confirm('Revogar acesso deste dispositivo?'))return;
          await api('POST','/api/pairing/revoke',{deviceId:device.id});
          await renderPairedDevices();show('Credencial revogada');
        });
        row.append(revoke);
      }
      list.append(row);
    }
  }
  function renderCash(){const sum=$('cash-summary');sum.textContent=session?`Caixa aberto · Esperado: ${money(session.expectedCents)}`:'Caixa fechado';$('cash-open-form').hidden=!!session;$('cash-movement-form').hidden=!session;$('cash-close-form').hidden=!session;}
  async function renderPrint(){const result=await api('GET','/api/print/jobs'),container=$('print-list');container.replaceChildren();if(!result.jobs.length)container.append(elt('p','empty','Nenhuma impressão pendente.'));for(const item of result.jobs){const row=elt('div','data-row'),info=elt('div');info.append(elt('b','',`Pedido ${item.orderId.slice(0,8)}`),elt('small','',`Situação: ${item.status} · Tentativas: ${item.attempts}`));row.append(info);if(item.status!=='DONE'){const btn=elt('button','button secondary','Enviar ao dispositivo');btn.addEventListener('click',()=>perform(async()=>{await api('POST',`/api/print/jobs/${item.id}/send`,{});show('Dados enviados à impressora');await renderPrint();}));row.append(btn);}container.append(row);}}
  document.querySelectorAll('[data-view]').forEach(e=>e.addEventListener('click',()=>perform(()=>changeView(e.dataset.view))));
  $('search').addEventListener('input',renderProducts);
  $('product-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{const f=new FormData(e.currentTarget);await api('POST','/api/products',{commandId:uid(),name:f.get('name'),priceCents:toCents(f.get('price')),categoryId:f.get('categoryId')});form.reset();show('Produto cadastrado');await refresh();});});
  $('category-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{
    await api('POST','/api/categories',{commandId:uid(),name:new FormData(e.currentTarget).get('name')});
    form.reset();await refresh();show('Categoria criada');
  });});
  $('pairing-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{
    const f=new FormData(e.currentTarget),role=f.get('role');
    const result=await api('POST','/api/pairing/start',{role,label:f.get('label')});
    const baseUrl=new URL(f.get('lanUrl'));
    if(baseUrl.protocol!=='https:')throw Error('Use endereço HTTPS na rede privada');
    const target=new URL(role==='kitchen'?'/kitchen.html':'/restaurant.html',baseUrl);
    $('pairing-output').textContent='PIN '+result.code+' · válido por 2 minutos · '+target.href;
    const qr=$('pairing-qr');qr.src='/api/pairing/qr.svg?url='+encodeURIComponent(target.href);qr.hidden=false;
    await renderPairedDevices();
  });});
  $('operator-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{
    const f=new FormData(e.currentTarget);
    await api('POST','/api/auth/operators',{username:f.get('username'),password:f.get('password'),role:f.get('role'),commandId:uid()});
    form.reset();show('Operador criado');
  });});
  $('combo-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{
    const f=new FormData(e.currentTarget);
    const ids=[...$('combo-components').selectedOptions].map(x=>x.value);
    if(!ids.length)throw Error('Selecione componentes para o combo');
    const components=[];
    for(const id of ids){
      const product=products.find(p=>p.id===id);
      const qty=prompt('Quantidade de '+product.name+' no combo:','1');
      if(qty===null)return;
      const quantity=Number(qty);
      if(!Number.isSafeInteger(quantity)||quantity<1)throw Error('Quantidade inválida');
      components.push({productId:id,quantity});
    }
    await api('POST','/api/combos',{commandId:uid(),name:f.get('name'),priceCents:toCents(f.get('price')),components});
    form.reset();await refresh();show('Combo cadastrado');
  });});
  $('split-order').addEventListener('click',()=>perform(async()=>{
    if(!order?.lines?.length)return;
    const allocations=[];
    for(const line of order.lines){
      const raw=prompt('Divida '+line.quantity+'x '+line.productName+'. Informe Nome:quantidade separados por vírgula.','Cliente 1:'+line.quantity);
      if(raw===null)return;
      const guests=raw.split(',').map(part=>{
        const sep=part.lastIndexOf(':'),guest=part.slice(0,sep).trim(),quantity=Number(part.slice(sep+1).trim());
        if(sep<=0||!guest||!Number.isSafeInteger(quantity)||quantity<=0)throw Error('Formato inválido. Use Ana:1,Bruno:2');
        return {guest,quantity};
      });
      allocations.push({lineId:line.id,guests});
    }
    const result=await api('POST','/api/orders/'+order.id+'/split',{commandId:uid(),expectedRevision:order.revision,allocations});
    order=result.order;renderOrder();await showSplit();show('Comanda dividida por cliente');
  }));
  $('modifier-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{const f=new FormData(e.currentTarget);await api('POST',`/api/products/${f.get('productId')}/modifiers`,{commandId:uid(),name:f.get('name'),priceCents:toCents(f.get('price'))});show('Adicional cadastrado');form.reset();await refresh();});});
  $('confirm-order').addEventListener('click',()=>perform(async()=>{order=(await api('POST',`/api/orders/${order.id}/confirm`,{commandId:uid(),expectedRevision:order.revision})).order;renderOrder();show('Pedido confirmado');}));
  $('cancel-order').addEventListener('click',()=>perform(async()=>{const reason=prompt('Informe o motivo do cancelamento');if(!reason?.trim())return;order=(await api('POST',`/api/orders/${order.id}/cancel`,{commandId:uid(),expectedRevision:order.revision,reason})).order;renderOrder();show('Pedido cancelado');}));
  $('pay-order').addEventListener('click',()=>{if(!session)return show('Abra o caixa primeiro',true);$('payment-amount').textContent=money(order.totalCents);$('payment-tendered').value=(order.totalCents/100).toFixed(2);$('split-enabled').checked=false;$('split-fields').hidden=true;$('payment-dialog').showModal();});
  $('close-payment').addEventListener('click',()=>$('payment-dialog').close());
  $('payment-method').addEventListener('change',()=>{$('tendered-wrap').hidden=$('payment-method').value!=='cash';});
  $('split-enabled').addEventListener('change',()=>{$('split-fields').hidden=!$('split-enabled').checked;$('split-first-amount').value=(order?.totalCents/200||0).toFixed(2);$('payment-tendered').value=$('split-enabled').checked?$('split-first-amount').value:(order?.totalCents/100||0).toFixed(2);});
  $('payment-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{const method=$('payment-method').value;const split=$('split-enabled').checked;const first=split?toCents($('split-first-amount').value):order.totalCents;
    if(first<=0||first>order.totalCents||(split&&first===order.totalCents))throw Error('Divisão inválida');
    const pay={method,amountCents:first};if(method==='cash')pay.tenderedCents=toCents($('payment-tendered').value);
    const payments=[pay];if(split)payments.push({method:$('split-second-method').value,amountCents:order.totalCents-first});
    const result=await api('POST',`/api/orders/${order.id}/close`,{commandId:uid(),expectedRevision:order.revision,payments});order=result.order;$('payment-dialog').close();renderOrder();show(`Venda finalizada · Troco: ${money(result.changeCents)}`);await refresh();});});
  $('cash-open-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{await api('POST','/api/cash/open',{commandId:uid(),openingCents:toCents(new FormData(e.currentTarget).get('amount'))});show('Caixa aberto');await refresh();});});
  $('cash-movement-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{const f=new FormData(e.currentTarget);await api('POST','/api/cash/movements',{commandId:uid(),kind:f.get('kind'),amountCents:toCents(f.get('amount'))});show('Movimento registrado');await refresh();});});
  $('cash-close-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{const result=await api('POST','/api/cash/close',{commandId:uid(),countedCents:toCents(new FormData(e.currentTarget).get('amount'))});show(`Caixa fechado · Diferença: ${money(result.differenceCents)}`);await refresh();});});
  $('printer-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;perform(async()=>{const f=new FormData(e.currentTarget);await api('POST','/api/printer',{commandId:uid(),host:f.get('host'),port:Number(f.get('port'))});show('Impressora configurada');await renderPrint();});});
  window.pdvAuth.ready().then(user=>{
    const isAdmin=user?.role==='admin';
    for(const view of ['products','print','fiscal','devices']){
      const button=document.querySelector('[data-view="'+view+'"]');if(button&&!isAdmin)button.hidden=true;
    }
    $('operators-panel').hidden=!isAdmin;
    return refresh();
  }).catch(e=>show(e.message,true));
})();
