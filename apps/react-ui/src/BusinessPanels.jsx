import React,{useEffect,useState} from 'react';
import {formatMoney} from './model.mjs';
const amt=n=>formatMoney(Number.isSafeInteger(n)?n:0);
const milli=n=>(n/1000).toLocaleString('pt-BR',{maximumFractionDigits:3});
const toMilli=value=>{const n=Number(value);const scaled=Math.round(n*1000);if(!Number.isSafeInteger(scaled)||scaled<=0||Math.abs(scaled-n*1000)>0.000001)throw Error('Quantidade inválida');return scaled;};
const toCents=value=>{const n=Number(value),scaled=Math.round(n*100);if(!Number.isSafeInteger(scaled)||scaled<0||Math.abs(scaled-n*100)>0.000001)throw Error('Custo inválido');return scaled;};
function Notice({error}){return error?<p className="errorbox" role="alert">{error}</p>:null;}
function Block({title,children}){return <section className="panel"><div className="sectiontitle"><h2>{title}</h2></div>{children}</section>;}
export function StockBusiness({mode,api}){
 const [state,setState]=useState({pending:true}),[refresh,setRefresh]=useState(0),[error,setError]=useState('');
 const [supplier,setSupplier]=useState(''),[name,setName]=useState(''),[unit,setUnit]=useState('g'),[purchase,setPurchase]=useState({supplierId:'',ingredientId:'',quantity:'1',cost:'0',lotCode:'',expiryDate:''});
 useEffect(()=>{
  if(mode!=='live'){setState({pending:false,offline:true});return;}
  let alive=true;setState(s=>({...s,pending:true}));
  Promise.all(['/api/stock/report','/api/stock/ingredients','/api/suppliers','/api/purchases']
   .map(p=>api(p))).then(([report,stock,suppliers,purchases])=>{if(alive)setState({pending:false,report,stock,suppliers,purchases});})
    .catch(e=>{if(alive)setState({pending:false,error:e.message})});
  return()=>{alive=false;};
 },[mode,api,refresh]);
 const perform=async(route,body,after)=>{try{
  setError('');
  await api(route,{method:'POST',body:{commandId:crypto.randomUUID(),...body}});
  if(after)after();
  setRefresh(x=>x+1);
 }catch(e){setError(e.message);}};
 return <div className="page"><div className="pageheading"><div><p className="eyebrow">ESTOQUE / DADOS CANÔNICOS</p><h1>Estoque, fornecedores e compras</h1><p className="subtext">Saldo e custo obtidos diretamente do SQLite do host. Compras só afetam estoque após recebimento.</p></div><button className="btn secondary" type="button" onClick={()=>setRefresh(x=>x+1)}>Atualizar</button></div>
  <Notice error={error||state.error}/>
  {state.offline?<Block title="Host local necessário">Sem conexão não há dados reais nem lançamentos.</Block>:state.pending?<p className="subtext">Consultando o host...</p>:<>
   <div className="metric-grid"><div className="metric-card"><span>Valor contábil do estoque</span><strong>{amt(state.report.totalValueCents)}</strong></div><div className="metric-card"><span>Ingredientes com saldo baixo</span><strong>{state.report.lowStockCount}</strong></div><div className="metric-card"><span>Fornecedores cadastrados</span><strong>{state.suppliers.suppliers.length}</strong></div><div className="metric-card"><span>Compras pendentes</span><strong>{state.purchases.purchases.filter(p=>p.status==='DRAFT').length}</strong></div></div>
   <Block title="Ingredientes e saldos"><div className="tablewrap"><table><thead><tr><th>Ingrediente</th><th>Saldo</th><th>Valor</th><th>Alerta</th></tr></thead><tbody>{state.stock.ingredients.map(x=><tr key={x.id}><td>{x.name}</td><td>{milli(x.onHandMilli)} {x.unit}</td><td>{amt(x.bookValueCents)}</td><td>{x.lowStockMilli>0&&x.onHandMilli<=x.lowStockMilli?'Baixo':'—'}</td></tr>)}</tbody></table></div><form className="row wrap compact" onSubmit={e=>{e.preventDefault();void perform('/api/stock/ingredients',{name,unit},()=>setName(''));}}><input required maxLength={100} placeholder="Novo ingrediente" value={name} onChange={e=>setName(e.target.value)}/><select value={unit} onChange={e=>setUnit(e.target.value)}><option value="g">Gramas</option><option value="ml">Mililitros</option><option value="unit">Unidades</option></select><button className="btn primary">Adicionar ingrediente</button></form></Block>
   <Block title="Fornecedores"><div className="stack">{state.suppliers.suppliers.map(x=><div className="list-row" key={x.id}><strong>{x.name}</strong><small>{x.active?'Ativo':'Inativo'}</small></div>)}</div><form className="row wrap compact" onSubmit={e=>{e.preventDefault();void perform('/api/suppliers',{name:supplier},()=>setSupplier(''));}}><input placeholder="Novo fornecedor" required maxLength={120} value={supplier} onChange={e=>setSupplier(e.target.value)}/><button className="btn primary">Cadastrar</button></form></Block>
   <Block title="Pedidos de compra"><div className="tablewrap"><table><thead><tr><th>Fornecedor</th><th>Data</th><th>Situação</th><th>Ação</th></tr></thead><tbody>{state.purchases.purchases.map(p=><tr key={p.id}><td>{p.supplierName}</td><td>{p.createdAt.slice(0,10)}</td><td>{p.status}</td><td>{p.status==='DRAFT'?<button className="btn secondary" type="button" onClick={()=>{if(window.confirm('Confirmar o recebimento físico desta compra?'))void perform('/api/purchases/'+encodeURIComponent(p.id)+'/receive',{});}}>Receber</button>:'—'}</td></tr>)}</tbody></table></div>
    <h3>Registrar compra</h3><form className="form-grid" onSubmit={e=>{e.preventDefault();try{
     const lot=Boolean(purchase.lotCode),expiry=Boolean(purchase.expiryDate);if(lot!==expiry)throw Error('Informe lote e validade juntos');
     const item={ingredientId:purchase.ingredientId,quantityMilli:toMilli(purchase.quantity),costCents:toCents(purchase.cost),
      ...(lot?{lotCode:purchase.lotCode,expiryDate:purchase.expiryDate}:{})};
     void perform('/api/purchases',{supplierId:purchase.supplierId,items:[item]});
    }catch(err){setError(err.message)}}}>
     <label className="field">Fornecedor<select required value={purchase.supplierId} onChange={e=>setPurchase(s=>({...s,supplierId:e.target.value}))}><option value="">Selecione</option>{state.suppliers.suppliers.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
     <label className="field">Ingrediente<select required value={purchase.ingredientId} onChange={e=>setPurchase(s=>({...s,ingredientId:e.target.value}))}><option value="">Selecione</option>{state.stock.ingredients.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
     <label className="field">Quantidade<input required type="number" min="0.001" step="0.001" value={purchase.quantity} onChange={e=>setPurchase(s=>({...s,quantity:e.target.value}))}/></label>
     <label className="field">Custo total (R$)<input required type="number" min="0" step="0.01" value={purchase.cost} onChange={e=>setPurchase(s=>({...s,cost:e.target.value}))}/></label>
     <label className="field">Lote (opcional)<input maxLength={64} value={purchase.lotCode} onChange={e=>setPurchase(s=>({...s,lotCode:e.target.value}))}/></label>
     <label className="field">Validade<input type="date" value={purchase.expiryDate} onChange={e=>setPurchase(s=>({...s,expiryDate:e.target.value}))}/></label>
     <button className="btn primary">Criar compra pendente</button></form>
     <p className="help">Edição de lotes, fichas técnicas e ajustes avançados continuam no <a href="/?view=stock">painel operacional local</a>.</p>
   </Block>
  </>}
 </div>;
}
export function FinanceBusiness({mode,api,section='financeiro'}){
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[revision,setRevision]=useState(0);
 const [state,setState]=useState({pending:true});
 useEffect(()=>{
  if(mode!=='live'){setState({pending:false,offline:true});return;}
  const params=new URLSearchParams();if(from)params.set('from',from);if(to)params.set('to',to);
  let active=true;setState(s=>({...s,pending:true}));
  api('/api/reports/financial?'+params.toString()).then(data=>{if(active)setState({pending:false,data})})
    .catch(e=>{if(active)setState({pending:false,error:e.message})});
  return()=>{active=false;};
 },[api,mode,from,to,revision]);
 return <div className="page"><div className="pageheading"><div><p className="eyebrow">GESTÃO / CONCILIAÇÃO LOCAL</p><h1>{section==='relatorios'?'Relatórios financeiros':'Financeiro'}</h1><p className="subtext">Vendas, devoluções, CMV e pagamentos confirmados no mesmo banco local; sem dados simulados.</p></div><button className="btn secondary" type="button" onClick={()=>setRevision(n=>n+1)}>Atualizar</button></div>
  <Block title="Período"><div className="row wrap compact"><label className="field">Início<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="field">Fim<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div></Block>
  <Notice error={state.error}/>
  {state.offline?<Block title="Host local necessário">Sem dados financeiros demonstrativos.</Block>:state.pending?<p className="subtext">Consultando lançamentos...</p>:<>
   <div className="metric-grid">{[['Vendas fechadas',state.data.orders],['Receita líquida',amt(state.data.netSalesCents)],['CMV',amt(state.data.cogsCents)],['Margem bruta',amt(state.data.grossMarginCents)],['Devoluções',amt(state.data.refundedCents)],['Ticket médio',amt(state.data.averageTicketCents)]].map(([label,value])=><div className="metric-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <Block title="Formas de pagamento confirmadas"><div className="stack">{Object.entries(state.data.methods).map(([method,value])=><div className="list-row" key={method}><span>{({cash:'Dinheiro',pix:'Pix',credit:'Crédito',debit:'Débito',other:'Outros'})[method]||method}</span><strong>{amt(value)}</strong></div>)}</div></Block>
   <Block title="Vendas por dia"><div className="tablewrap"><table><thead><tr><th>Data</th><th>Pedidos</th><th>Líquido</th><th>CMV</th></tr></thead><tbody>{state.data.byDay.map(day=><tr key={day.day}><td>{day.day}</td><td>{day.orders}</td><td>{amt(day.netSalesCents)}</td><td>{amt(day.cogsCents)}</td></tr>)}</tbody></table></div></Block>
   <Block title="Sessões de caixa"><div className="stack">{state.data.cashSessions.map(x=><div className="list-row" key={x.id}><span>{x.openedAt?.slice(0,10)} · {x.status}</span><strong>{x.expectedCents===null?'Aberto':amt(x.expectedCents)}</strong></div>)}</div></Block>
   <p className="help">Indicadores gerenciais, não substituem DRE contábil nem documentos fiscais.</p>
  </>}
 </div>;
}
