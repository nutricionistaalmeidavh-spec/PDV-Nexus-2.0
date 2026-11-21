import React,{useEffect,useMemo,useState} from 'react';
import {
  ActionIcon,Badge,Box,Button,Card,Checkbox,Divider,Group,Image,Modal,NumberInput,
  Paper,Radio,ScrollArea,SegmentedControl,SimpleGrid,Stack,Text,Textarea,
  TextInput,ThemeIcon
} from '@mantine/core';
import {
  Check,ChevronDown,CircleAlert,Grid2X2,LayoutList,Minus,PackageSearch,
  Plus,Search,ShoppingBag,ShoppingCart,Trash2,UtensilsCrossed,Wallet
} from 'lucide-react';
import {foodAsset} from './media.mjs';
import {sampleModifiers} from './demo.mjs';
import {formatMoney,parseMoney,paymentDraft,sumOrder} from './model.mjs';

const money=value=>formatMoney(Number.isSafeInteger(value)?value:0);
const statusText={DRAFT:'Rascunho',OPEN:'Em aberto',CLOSED:'Concluído',CANCELLED:'Cancelado'};
const asError=e=>e?.message||'Não foi possível concluir a operação.';

function Illustration({product,size=92}){
 const photo=foodAsset(product);
 return <Box className="nexus-food-illustration" style={{height:size}}>
  {photo?<Image src={photo} alt="" fit="contain" h="100%" w="100%" loading="lazy"/>:
  <UtensilsCrossed size={30} strokeWidth={1.5} aria-hidden="true"/>}
 </Box>;
}

export function PosProductModal({product,requester,onClose,onSubmit,busy,demo}){
 const [qty,setQty]=useState(1);
 const [note,setNote]=useState('');
 const [mods,setMods]=useState([]);
 const [chosen,setChosen]=useState([]);
 const [error,setError]=useState('');
 useEffect(()=>{
  let alive=true;
  if(demo){setMods(sampleModifiers);return()=>{alive=false;};}
  requester('/api/products/'+encodeURIComponent(product.id)+'/modifiers')
   .then(data=>{if(alive)setMods((data.modifiers||[]).filter(m=>m.active));})
   .catch(e=>{if(alive)setError(asError(e));});
  return()=>{alive=false;};
 },[product.id,requester,demo]);
 const selected=mods.filter(m=>chosen.includes(m.id));
 const extra=selected.reduce((n,m)=>n+m.priceCents,0);
 const quantity=Number(qty);
 const valid=Number.isSafeInteger(quantity)&&quantity>0&&quantity<=99;
 const submit=()=>{
  if(!valid){setError('Informe uma quantidade inteira de 1 a 99');return;}
  onSubmit({product,quantity,note,modifierIds:chosen,modifiers:selected,modifierPriceCents:extra});
 };
 return <Modal opened onClose={onClose} centered size="lg" radius="lg"
   title={<Group gap="sm"><ThemeIcon color="orange" variant="light"><ShoppingBag size={18}/></ThemeIcon><Text fw={800}>Personalizar produto</Text></Group>}
   classNames={{content:'nexus-modal-content',body:'nexus-modal-body'}} closeButtonProps={{'aria-label':'Fechar'}}>
  <Stack gap="md">
   <Group align="center" wrap="nowrap" gap="md">
    <Box className="nexus-product-preview"><Illustration product={product} size={106}/></Box>
    <Stack gap={3}>
     <Text fw={800} size="lg">{product.name}</Text>
     <Text fw={800} c="orange.9" size="xl">{money(product.priceCents)}</Text>
     <Text c="dimmed" size="sm">Escolha adicionais e observações para a cozinha.</Text>
    </Stack>
   </Group>
   <Divider/>
   <Group justify="space-between" align="center">
    <Text fw={700}>Quantidade</Text>
    <Group gap="xs">
     <ActionIcon aria-label="Diminuir quantidade" variant="light" color="orange" size="lg"
       disabled={!valid||quantity<=1} onClick={()=>setQty(x=>Math.max(1,Number(x)-1))}><Minus size={18}/></ActionIcon>
     <NumberInput min={1} max={99} allowNegative={false} allowDecimal={false}
       aria-label="Quantidade" value={qty} onChange={setQty} w={88} size="md" hideControls/>
     <ActionIcon aria-label="Aumentar quantidade" variant="light" color="orange" size="lg"
       disabled={!valid||quantity>=99} onClick={()=>setQty(x=>Math.min(99,Number(x)+1))}><Plus size={18}/></ActionIcon>
    </Group>
   </Group>
   <Stack gap="xs">
    <Text fw={700}>Adicionais</Text>
    {mods.length?mods.map(m=><Paper key={m.id} p="sm" radius="md" withBorder>
      <Checkbox label={<Group justify="space-between" gap="sm" wrap="nowrap" w="100%">
       <Text size="sm">{m.name}</Text><Text fw={700} size="sm">+ {money(m.priceCents)}</Text>
      </Group>} checked={chosen.includes(m.id)}
       onChange={e=>setChosen(x=>e.currentTarget.checked?[...x,m.id]:x.filter(k=>k!==m.id))}/>
    </Paper>):<Paper p="md" radius="md" bg="gray.0"><Text size="sm" c="dimmed">Nenhum adicional cadastrado.</Text></Paper>}
   </Stack>
   <Textarea label="Observações para cozinha" rows={2} value={note}
    onChange={e=>setNote(e.currentTarget.value)} maxLength={200}
    description={note.length+'/200 caracteres'} placeholder="Ex.: sem cebola, molho separado"/>
   {error&&<Text size="sm" role="alert" c="red.8">{error}</Text>}
   <Group className="nexus-modal-actions" justify="space-between" align="center" wrap="nowrap">
    <Button variant="default" onClick={onClose}>Cancelar</Button>
    <Button color="orange" onClick={submit} disabled={!valid} loading={busy} leftSection={<Plus size={16}/>}>
     Adicionar ao pedido · {money((product.priceCents+extra)*(valid?quantity:1))}
    </Button>
   </Group>
  </Stack>
 </Modal>;
}

export function PosPaymentModal({order,onClose,onPay,busy}){
 const total=sumOrder(order);
 const [method,setMethod]=useState('cash');
 const [tendered,setTendered]=useState((total/100).toFixed(2));
 const [split,setSplit]=useState(false);
 const [first,setFirst]=useState((Math.floor(total/2)/100).toFixed(2));
 const [secondMethod,setSecondMethod]=useState('pix');
 const [error,setError]=useState('');
 let change=0;
 try{
  change=method==='cash'?Math.max(0,parseMoney(tendered)-(split?parseMoney(first):total)):0;
 }catch{change=0;}
 const submit=()=>{
  try{
   const payments=split?(()=>{
    const firstCents=parseMoney(first);
    if(firstCents<=0||firstCents>=total)throw Error('Informe um valor parcial válido');
    const one={method,amountCents:firstCents};
    if(method==='cash'){
     const got=parseMoney(tendered);
     if(got<firstCents)throw Error('Dinheiro insuficiente');
     one.tenderedCents=got;
    }
    const second={method:secondMethod,amountCents:total-firstCents};
    if(secondMethod==='cash')second.tenderedCents=second.amountCents;
    return [one,second];
   })():paymentDraft(total,method,method==='cash'?parseMoney(tendered):0).payments;
   setError('');
   onPay(payments);
  }catch(e){setError(asError(e));}
 };
 return <Modal opened onClose={onClose} centered size="lg" radius="lg"
   title={<Group gap="sm"><ThemeIcon color="orange" variant="light"><Wallet size={18}/></ThemeIcon><Text fw={800}>Finalizar venda</Text></Group>}
   classNames={{content:'nexus-modal-content nexus-checkout-modal',body:'nexus-modal-body'}}
   closeButtonProps={{'aria-label':'Fechar'}}>
  <Stack gap={0} className="nexus-payment-container">
   <Stack gap="md" className="nexus-payment-scroll">
   <Paper p="lg" radius="lg" className="nexus-payment-total">
    <Text size="xs" fw={800} tt="uppercase">Total a receber</Text>
    <Text className="hero-number" fw={800}>{money(total)}</Text>
    <Text size="xs">Confirme o pagamento antes de registrar a venda.</Text>
   </Paper>
   <Radio.Group label="Formas de pagamento" value={method} onChange={setMethod}>
    <SimpleGrid cols={{base:2,sm:4}} spacing="xs" mt="xs">
     {[['cash','Dinheiro'],['pix','Pix'],['credit','Crédito'],['debit','Débito']].map(([v,label])=>
      <Paper key={v} p="sm" withBorder className={'nexus-payment-method '+(method===v?'is-selected':'')}>
       <Radio value={v} label={label} size="sm"/>
      </Paper>)}
    </SimpleGrid>
   </Radio.Group>
   <Checkbox label="Dividir pagamento entre duas formas" checked={split} onChange={e=>setSplit(e.currentTarget.checked)}/>
   {split&&<SimpleGrid cols={{base:1,sm:2}} spacing="sm">
    <TextInput label="Valor da primeira forma (R$)" inputMode="decimal" value={first} onChange={e=>setFirst(e.currentTarget.value)}/>
    <Radio.Group label="Segunda forma" value={secondMethod} onChange={setSecondMethod}>
     <Group gap="sm" mt="sm" wrap="wrap">
      {[['pix','Pix'],['credit','Crédito'],['debit','Débito'],['cash','Dinheiro']].map(([v,l])=><Radio value={v} label={l} key={v}/>)}
     </Group>
    </Radio.Group>
   </SimpleGrid>}
   {method==='cash'&&<TextInput label="Valor recebido em dinheiro (R$)" inputMode="decimal" value={tendered}
       onChange={e=>setTendered(e.currentTarget.value)}/>}
   <Group justify="space-between" className="nexus-change-row">
    <Text fw={600}>Troco calculado</Text><Text fw={800} size="lg">{money(change)}</Text>
   </Group>
   <Text size="xs" c="dimmed">Pix e cartão são registrados somente após confirmação manual. Não há processamento automático ou dependência de gateway pago.</Text>
   {error&&<Group gap="xs" role="alert"><CircleAlert size={16} color="#B91C1C"/><Text c="red.8" size="sm">{error}</Text></Group>}
   </Stack>
   <Group className="nexus-modal-actions" justify="space-between" align="center" wrap="nowrap">
    <Button variant="default" onClick={onClose}>Voltar</Button>
    <Button color="orange" onClick={submit} loading={busy} leftSection={<Check size={18}/>}>Confirmar recebimento</Button>
   </Group>
  </Stack>
 </Modal>;
}

export function PosSale({products,categories,order,onChoose,onConfirm,onCancel,onPay,onNew,busy,mode}){
 const [filter,setFilter]=useState('');
 const [category,setCategory]=useState('all');
 const [viewMode,setViewMode]=useState('grid');
 const categoryList=useMemo(()=>[
  {id:'all',name:'Todos'},
  ...categories.filter(c=>c.active!==0).map(c=>({id:c.id,name:c.name}))
 ],[categories]);
 const catalog=useMemo(()=>products.filter(p=>
   p.active!==0&&p.categoryActive!==0&&
   (p.name.toLocaleLowerCase('pt-BR').includes(filter.toLocaleLowerCase('pt-BR'))||p.barcode?.includes(filter))&&
   (category==='all'||p.categoryId===category)
 ),[products,filter,category]);
 const status=order?.status||'EMPTY';
 const lines=order?.lines||[];
 const total=sumOrder(order);
 const count=lines.reduce((n,l)=>n+l.quantity,0);
 return <div className="page nexus-pos">
  <div className="pageheading">
   <div><p className="eyebrow">ATENDIMENTO / BALCÃO</p><h1>Nova venda</h1>
    <p className="subtext">Selecione produtos, personalize o pedido e acompanhe o total.</p></div>
   <Badge color={mode==='live'?'green':'orange'} variant="light" size="lg">
    {mode==='live'?'Caixa local':'Prévia sem banco'}
   </Badge>
  </div>
  <div className="sale-layout">
   <Paper className="catalog-pane" withBorder radius="lg">
    <Group justify="space-between" className="sale-toolbar" gap="sm" wrap="nowrap">
     <Box className="searchfield" style={{flex:1}}>
      <TextInput aria-label="Buscar produtos" leftSection={<Search size={18}/>} placeholder="Buscar por nome ou código (F3)"
       value={filter} onChange={e=>setFilter(e.currentTarget.value)} size="md" radius="md"/>
     </Box>
     <SegmentedControl aria-label="Modo de visualização do catálogo" size="md" value={viewMode} onChange={setViewMode}
      data={[{label:<Grid2X2 size={17} aria-label="Grade"/>,value:'grid'},{label:<LayoutList size={17} aria-label="Lista"/>,value:'list'}]}/>
    </Group>
    <ScrollArea type="auto" scrollbarSize={6} offsetScrollbars className="nexus-category-scroller">
     <Group gap="xs" wrap="nowrap" className="categories" aria-label="Categorias de produtos">
      {categoryList.map(c=><button key={c.id} type="button"
       aria-pressed={category===c.id} className={'category '+(category===c.id?'selected':'')}
       onClick={()=>setCategory(c.id)}>{c.name}</button>)}
     </Group>
    </ScrollArea>
    <Group justify="space-between" className="nexus-catalog-meta" gap="xs">
     <Text fw={700} size="sm">Produtos</Text>
     <Text c="dimmed" size="xs" role="status">{catalog.length} encontrados</Text>
    </Group>
    <SimpleGrid className={'product-grid '+(viewMode==='list'?'nexus-product-list':'')} cols={{base:2,sm:2,md:3}} spacing="md">
     {catalog.map(p=><Card key={p.id} component="button" type="button" className="product-card"
       withBorder radius="lg" onClick={()=>onChoose(p)} disabled={busy||status==='OPEN'}>
       <Illustration product={p}/>
       <Stack gap={3} className="nexus-product-info">
        <Text fw={700} className="nexus-product-name" lineClamp={2}>{p.name}</Text>
        <Text size="xs" c="dimmed">{p.isCombo?'Combo':'Produto'}</Text>
        <Text fw={800} className="nexus-product-price">{money(p.priceCents)}</Text>
       </Stack>
      </Card>)}
    </SimpleGrid>
    {!catalog.length&&<Paper p="xl" mt="md" bg="gray.0" radius="md">
      <Stack align="center" gap="xs"><PackageSearch size={34} color="#C2410C"/>
       <Text fw={700}>Nenhum produto encontrado</Text>
       <Text c="dimmed" size="sm">Altere a busca ou a categoria selecionada.</Text>
      </Stack></Paper>}
   </Paper>
   <Paper className="order-pane" withBorder radius="lg">
    <Group justify="space-between" align="center" className="sale-summary-head">
     <Group gap="sm"><ThemeIcon variant="light" color="orange" size="lg" radius="md"><ShoppingCart size={18}/></ThemeIcon>
      <div><Text fw={800}>Comanda atual</Text><Text size="xs" c="dimmed">Resumo do pedido</Text></div>
     </Group>
     <Badge color={status==='OPEN'?'green':'orange'} variant="light">{statusText[status]||'Novo'}</Badge>
    </Group>
    <Group className="nexus-cart-counter" gap="xs">
     <ShoppingBag size={16}/><Text size="sm" fw={600} className="sale-cart-count">
      {count} {count===1?'item':'itens'} na comanda
     </Text>
    </Group>
    <ScrollArea className="order-lines sale-order-summary" type="auto" scrollbarSize={5}>
     {lines.length?lines.map(line=><div className="order-line" key={line.id}>
       <span className="quantity">{line.quantity}</span>
       <div className="nexus-line-info"><Text fw={700} size="sm">{line.productName}</Text>
        <Text c="dimmed" size="xs">{line.modifiers?.length?line.modifiers.map(m=>m.name).join(', '):line.note||'Sem observações'}</Text>
       </div>
       <Text fw={700} size="sm">{money(line.unitPriceCents*line.quantity)}</Text>
      </div>):<Stack align="center" className="nexus-empty-order" gap="sm">
       <ShoppingCart size={34} strokeWidth={1.5}/>
       <Text fw={700}>Sua comanda está vazia</Text>
       <Text size="sm" ta="center">Escolha um produto no catálogo para iniciar.</Text>
      </Stack>}
    </ScrollArea>
    <Stack gap="sm" className="order-foot">
     <Group justify="space-between"><Text c="dimmed" size="sm">Subtotal</Text><Text fw={700}>{money(total)}</Text></Group>
     <Group justify="space-between" className="total-hero">
      <Text fw={700}>Total</Text><Text fw={900} size="xl">{money(total)}</Text>
     </Group>
     {status==='DRAFT'&&<Button fullWidth color="orange" size="md" loading={busy}
       disabled={!lines.length} onClick={onConfirm}>Confirmar pedido</Button>}
     {status==='OPEN'&&<Button fullWidth color="orange" size="md" loading={busy}
       disabled={!lines.length} onClick={onPay} leftSection={<Wallet size={18}/>}>Finalizar venda (F10)</Button>}
     {['CLOSED','CANCELLED'].includes(status)&&<Button fullWidth color="orange" onClick={onNew}>Iniciar nova venda</Button>}
     {['DRAFT','OPEN'].includes(status)&&<Button fullWidth variant="light" color="gray" loading={busy}
       onClick={onCancel} leftSection={<Trash2 size={16}/>}>Cancelar pedido</Button>}
     <Text size="xs" c="dimmed" ta="center">Pagamento confirmado no host · Comprovante não fiscal</Text>
    </Stack>
   </Paper>
  </div>
 </div>;
}
