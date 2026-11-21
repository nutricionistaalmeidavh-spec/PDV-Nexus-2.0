/** E2E regression for a single operational React UI, isolated on temporary SQLite. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../apps/server/src/server.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-react-parity-'));
const output=path.resolve('artifacts/qa');
fs.mkdirSync(path.join(output,'videos'),{recursive:true});
const app=createApp({dataPath:path.join(tmp,'parity.sqlite')});
let browser,context,page,origin;
const errors=[];
const clickNav=async label=>page.locator('.sidebar .nav-item').filter({hasText:label}).first().click();
const shot=async name=>page.screenshot({path:path.join(output,'parity-'+name+'.png'),fullPage:true,animations:'disabled'});
const remote=async(route,options)=>page.evaluate(async({route,options})=>{
 const response=await fetch(route,options);return {status:response.status,payload:await response.json()};
},{route,options});
const data=async route=>{const value=await remote(route);assert.equal(value.status,200,route);return value.payload;};
const panel=title=>page.locator('section.panel').filter({has:page.getByRole('heading',{name:title,exact:true})});
try{
 origin=await app.listen({port:0});
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 context=await browser.newContext({viewport:{width:1440,height:940},locale:'pt-BR',acceptDownloads:true,recordVideo:{dir:path.join(tmp,'recorded'),size:{width:1440,height:940}}});
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const legacy=await page.request.get(origin+'/',{maxRedirects:0});
 assert.equal(legacy.status(),302);
 assert.match(legacy.headers().location,/^\/ui\//);
 for(const route of ['/app.js','/p2-admin.js','/restaurant.js','/kitchen.js'])assert.equal((await page.request.get(origin+route)).status(),404);
 await page.goto(origin+'/ui/?embedded=1');
 await page.locator('.authcard input').first().fill('admin');
 await page.locator('.authcard input').nth(1).fill(['senhaMuito','Forte-2026'].join(''));
 await page.locator('.authcard button[type=submit]').click();
 await page.locator('.sidebar .nav-item').first().waitFor();

 await clickNav('Produtos e cardápio');
 await page.locator('.product-form input').nth(0).fill('Hamburguer Paridade QA');
 await page.locator('.product-form input').nth(1).fill('20,00');
 await page.locator('.product-form button.btn.primary').click();
 await page.locator('.product-list').getByText('Hamburguer Paridade QA').waitFor();
 await page.getByRole('heading',{name:'Edição de catálogo, adicionais e combos'}).waitFor();
 const products=await data('/api/products');
 const product=products.products.find(p=>p.name==='Hamburguer Paridade QA');
 assert.ok(product);
 const modifiers=panel('Adicionais e personalizações');
 await modifiers.locator('select').selectOption(product.id);
 await modifiers.getByLabel('Nome').fill('Queijo adicional QA');
 await modifiers.getByLabel('Preço adicional (R$)').fill('2,00');
 await modifiers.getByRole('button',{name:'Cadastrar adicional'}).click();
 await modifiers.getByText('Queijo adicional QA').waitFor();
 await shot('01-catalogo-e-adicionais');

 await clickNav('Estoque');
 await page.getByPlaceholder('Novo ingrediente').fill('Carne Paridade QA');
 await page.getByRole('button',{name:'Adicionar ingrediente'}).click();
 await page.getByText('Carne Paridade QA').first().waitFor();
 const stock=await data('/api/stock/ingredients');
 const ing=stock.ingredients.find(x=>x.name==='Carne Paridade QA');assert.ok(ing);
 const receipt=panel('Entrada de estoque e lotes FEFO');
 await receipt.locator('select[name=ingredientId]').selectOption(ing.id);
 await receipt.locator('input[name=quantity]').fill('2');
 await receipt.locator('input[name=cost]').fill('40');
 await receipt.getByRole('button',{name:'Confirmar entrada'}).click();
 await page.waitForFunction(async id=>(await (await fetch('/api/stock/ingredients')).json()).ingredients.find(i=>i.id===id)?.onHandMilli===2000,ing.id);
 const recipe=panel('Ficha técnica por produto');
 await recipe.getByLabel('Produto',{exact:true}).selectOption(product.id);
 await recipe.getByLabel('Ingrediente',{exact:true}).selectOption(ing.id);
 await recipe.getByLabel('Quantidade por produto').fill('0.200');
 await recipe.getByRole('button',{name:'Adicionar ingrediente'}).click();
 await recipe.getByRole('button',{name:'Salvar ficha técnica'}).click();
 await page.waitForFunction(async id=>(await (await fetch('/api/stock/recipes/'+id)).json()).items.length===1,product.id);
 await shot('02-estoque-receita-e-lotes');

 await clickNav('Controle de caixa');
 await page.locator('.cash-main input').fill('100,00');
 await page.getByRole('button',{name:'Abrir caixa'}).click();
 await page.getByText('Caixa aberto',{exact:true}).waitFor();
 await clickNav('Garçom mobile');
 await page.getByRole('heading',{name:'Garçom mobile'}).waitFor();
 await shot('p2-01-garcom-mobile');
 await clickNav('Mesas e comandas');
 await page.getByPlaceholder('Ex.: Mesa 13').fill('Mesa Paridade QA');
 await page.getByRole('button',{name:/Nova mesa/}).click();
 const roomTiles=page.locator('.nexus-room-summary > .mantine-Paper-root');
 assert.equal(await roomTiles.count(),3,'Mapa deve oferecer três indicadores de salão');
 const roomY=await Promise.all([0,1,2].map(i=>roomTiles.nth(i).evaluate(el=>Math.round(el.getBoundingClientRect().top))));
 assert.equal(new Set(roomY).size,1,'Indicadores do salão devem compartilhar uma linha no desktop');
 const statusReadable=await page.locator('.table-card .mantine-Badge-label').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1);
 assert.ok(statusReadable,'Etiqueta Livre/Ocupada não pode ser truncada nos cartões');
 await shot('p2-02-mapa-salao');
 await page.locator('.table-card').filter({hasText:'Mesa Paridade QA'}).click();
 await page.getByRole('heading',{name:'Gerenciar mesa'}).waitFor();
 const add=panel('Adicionar produtos');
 await add.locator('select').selectOption(product.id);
 await add.getByRole('button',{name:'Adicionar à comanda'}).click();
 await page.getByText('Hamburguer Paridade QA').first().waitFor();
 await page.getByRole('button',{name:'Confirmar e enviar à cozinha'}).click();
 await page.getByRole('button',{name:'Salvar divisão'}).click();
 await page.getByText('Alocação completa: Sim').waitFor();
 await shot('03-comanda-confirmada-e-divisao');
 await clickNav('Cozinha (KDS)');
 await page.getByRole('heading',{name:'Painel KDS'}).waitFor();
 const kitchenTicket=page.locator('.kds-ticket').filter({hasText:'Hamburguer Paridade QA'});
 await kitchenTicket.first().waitFor();
 await shot('p2-03-kds-novos');
 await kitchenTicket.getByRole('button',{name:'Iniciar preparo'}).click();
 await kitchenTicket.getByRole('button',{name:'Marcar como pronto'}).waitFor();
 await shot('p2-04-kds-preparo');
 await kitchenTicket.getByRole('button',{name:'Marcar como pronto'}).click();
 await kitchenTicket.getByRole('button',{name:'Entregar'}).waitFor();
 await shot('p2-05-kds-prontos');
 await kitchenTicket.getByRole('button',{name:'Entregar'}).click();
 await kitchenTicket.waitFor({state:'hidden'});
 await clickNav('Mesas e comandas');
 await page.locator('.table-card').filter({hasText:'Mesa Paridade QA'}).click();
 await page.getByRole('heading',{name:'Gerenciar mesa'}).waitFor();
 await page.getByRole('button',{name:'Finalizar venda'}).click();
 await page.getByRole('dialog',{name:'Finalizar venda'}).waitFor();
 await page.getByRole('button',{name:'Confirmar recebimento'}).click();
 await page.getByText('Venda concluída!',{exact:true}).waitFor();
 await clickNav('Cozinha (KDS)');
 await page.getByRole('heading',{name:'Painel KDS'}).waitFor();
 await shot('04-cozinha-kds');

 await clickNav('Delivery');
 await page.getByRole('heading',{name:'Delivery e cardápio digital'}).waitFor();
 await page.getByRole('button',{name:'Habilitar cardápio'}).click();
 await page.getByText('Habilitada').waitFor();
 const request=await remote('/api/public/delivery/requests',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({clientRequestId:crypto.randomUUID(),customerName:'Cliente Paridade QA',phone:'16988887777',address:'Rua de Teste 400, Centro',items:[{productId:product.id,quantity:1}]})
 });
 assert.equal(request.status,202);
 await page.getByRole('button',{name:'Atualizar'}).click();
 await page.getByText('Cliente Paridade QA').first().waitFor();
 await page.getByRole('button',{name:'Aceitar'}).click();
 await shot('05-delivery-aceito');

 await clickNav('Unidades');
 await page.getByRole('heading',{name:'Unidades',exact:true}).waitFor();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Exportar resumo JSON'}).click()]);
 const document=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
 assert.equal(document.documentType,'PDV_NEXUS_UNIT_SUMMARY');
 await shot('06-unidades-exportacao');
 await clickNav('Integrações');
 await page.getByRole('heading',{name:'Diagnósticos de periféricos'}).waitFor();
 await shot('07-hardware');

 await clickNav('Gestão geral');
 await page.getByRole('heading',{name:'Gestão e relatórios'}).waitFor();
 await page.getByRole('heading',{name:'Receita e CMV'}).waitFor();
 const metrics=page.locator('.nexus-overview-kpis > .mantine-Paper-root');
 assert.equal(await metrics.count(),4);
 const metricsY=await Promise.all([0,1,2,3].map(i=>metrics.nth(i).evaluate(el=>Math.round(el.getBoundingClientRect().top))));
 assert.equal(new Set(metricsY).size,1,'Quatro KPIs de gestão devem compartilhar linha no desktop');

 await page.locator('.nexus-overview .nexus-management-table').first().waitFor();
 await shot('p3-00-gestao-geral');
 await clickNav('Financeiro');
 await page.getByRole('heading',{name:'Financeiro',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Evolução de receita e CMV'}).waitFor();
 await page.locator('.nexus-financial-chart svg').first().waitFor();
 assert.ok(await page.locator('.nexus-management-table').count()>=3,'Painel financeiro requer DataTable para métodos, dias e sessões');
 await shot('p3-01-financeiro-graficos');
 await clickNav('Relatórios');
 await page.getByRole('heading',{name:'Relatórios financeiros'}).waitFor();
 await shot('p3-02-relatorios-graficos');
 await clickNav('Estoque');
 await page.getByRole('heading',{name:'Estoque, fornecedores e compras'}).waitFor();
 await page.locator('.nexus-management-table').first().waitFor();
 await shot('p3-03-estoque-datatable');
 await page.setViewportSize({width:390,height:844});
 await page.locator('.sidebar').waitFor({state:'hidden'});
 const navHidden=await page.locator('.sidebar').isVisible();
 assert.equal(navHidden,false,'Menu deve iniciar recolhido no celular, sem sobrepor formulários');
 await shot('p4-01-gestao-mobile');
 const stockHeading=page.getByRole('heading',{name:'Estoque, fornecedores e compras'});
 const headingWrapped=await stockHeading.evaluate(el=>el.scrollWidth<=el.clientWidth+1);
 assert.ok(headingWrapped,'Título de estoque deve quebrar sem corte horizontal em 390px');
 const addStockButton=page.getByPlaceholder('Novo ingrediente').locator('..').getByRole('button',{name:'Adicionar ingrediente'});
 await addStockButton.scrollIntoViewIfNeeded();
 const addStockBounds=await addStockButton.boundingBox();
 assert.ok(addStockBounds&&addStockBounds.x>=0&&addStockBounds.x+addStockBounds.width<=390,
  'Ação de ingrediente deve ser totalmente acessível em 390px: '+JSON.stringify(addStockBounds));
 await page.getByRole('button',{name:'Abrir ou fechar o menu'}).click();
 await page.locator('.sidebar .nav-item').first().waitFor({state:'visible'});
 await shot('p4-02-menu-mobile-aberto');
 await page.getByRole('button',{name:'Abrir ou fechar o menu'}).click();
 await page.locator('.sidebar').waitFor({state:'hidden'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+3);
 assert.equal(overflow,false,'Gestão mobile não deve provocar overflow horizontal na página inteira');
 await page.setViewportSize({width:1440,height:940});

 assert.deepEqual(errors,[]);
 console.log('REACT PARITY E2E PASS: catalog, stock, salon, waiter, table, split, KDS stage transitions, payment, delivery, units, hardware, management charts and DataTables.');
}catch(error){
 console.error('REACT PARITY E2E FAIL',error);process.exitCode=1;
 if(page&&!page.isClosed())await shot('ERROR').catch(()=>{});
}finally{
 if(context){const recording=page?.video();await context.close();if(recording)await recording.saveAs(path.join(output,'videos','parity-journey.webm')).catch(()=>{});}
 if(browser)await browser.close();
 await app.close();
 fs.rmSync(tmp,{recursive:true,force:true});
}
