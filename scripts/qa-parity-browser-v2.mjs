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
fs.mkdirSync(path.join(output,'traces'),{recursive:true});
const app=createApp({dataPath:path.join(tmp,'parity.sqlite')});
let browser,context,page,origin,mobileContext,mobilePage;
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
 await context.tracing.start({screenshots:true,snapshots:true,sources:true});
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
 await clickNav('Mesas e comandas');
 await page.getByPlaceholder('Ex.: Mesa 13').fill('Mesa Paridade QA');
 await page.getByRole('button',{name:/Nova mesa/}).click();
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

 // P4: capture every visible screen, not only the happy-path sample.
 const manifest={commit:process.env.GITHUB_SHA||'local',ui:'/ui/?embedded=1',desktop:[],mobile:[],errors:[]};
 const desktopTabs=await page.locator('.sidebar .nav-item').allTextContents();
 assert.ok(desktopTabs.length>=20,'A interface operacional deve expor todos os módulos previstos');
 for(let i=0;i<desktopTabs.length;i++){
   const title=desktopTabs[i].trim();
   await page.locator('.sidebar .nav-item').nth(i).click();
   await page.waitForFunction(index=>document.querySelectorAll('.sidebar .nav-item')[index]?.classList.contains('active'),i);
   const name='all-desktop-'+String(i+1).padStart(2,'0');
   await shot(name);
   manifest.desktop.push({index:i+1,view:title,file:'parity-'+name+'.png'});
 }
 // Gravação mobile independente, usando somente o cookie HTTP-only da sessão de teste.
 mobileContext=await browser.newContext({
   storageState:await context.storageState(),
   viewport:{width:390,height:844},locale:'pt-BR',
   recordVideo:{dir:path.join(tmp,'recorded-mobile'),size:{width:390,height:844}}
 });
 await mobileContext.tracing.start({screenshots:true,snapshots:true,sources:true});
 mobilePage=await mobileContext.newPage();
 mobilePage.on('pageerror',e=>errors.push('mobile: '+e.message));
 await mobilePage.goto(origin+'/ui/?embedded=1');
 await mobilePage.getByRole('button',{name:'Abrir ou fechar o menu'}).waitFor();
 await mobilePage.locator('.sidebar').waitFor({state:'hidden'});
 await mobilePage.getByRole('button',{name:'Abrir ou fechar o menu'}).click();
 await mobilePage.locator('.sidebar .nav-item').first().waitFor();
 const mobileTabs=await mobilePage.locator('.sidebar .nav-item').allTextContents();
 assert.deepEqual(mobileTabs,desktopTabs,'Paridade de módulos desktop/mobile');
 for(let i=0;i<mobileTabs.length;i++){
   if(i>0)await mobilePage.getByRole('button',{name:'Abrir ou fechar o menu'}).click();
   await mobilePage.locator('.sidebar .nav-item').nth(i).click();
   await mobilePage.locator('.sidebar').waitFor({state:'hidden'});
   await mobilePage.waitForFunction(index=>document.querySelectorAll('.sidebar .nav-item')[index]?.classList.contains('active'),i);
   const metrics=await mobilePage.evaluate(()=>({
     viewport:document.documentElement.clientWidth,
     documentWidth:document.documentElement.scrollWidth
   }));
   assert.ok(metrics.documentWidth<=metrics.viewport+4,
     'Rolagem horizontal indevida em '+mobileTabs[i]+' '+JSON.stringify(metrics));
   const name='all-mobile-'+String(i+1).padStart(2,'0');
   await mobilePage.screenshot({path:path.join(output,'parity-'+name+'.png'),fullPage:true,animations:'disabled'});
   manifest.mobile.push({index:i+1,view:mobileTabs[i].trim(),file:'parity-'+name+'.png',metrics});
 }
 manifest.errors=errors.slice();
 fs.writeFileSync(path.join(output,'journey-manifest.json'),JSON.stringify(manifest,null,2)+'\\n');
 assert.deepEqual(errors,[]);
 console.log('P4 VISUAL INVENTORY PASS:',manifest.desktop.length,'desktop screens;',manifest.mobile.length,'mobile screens');
 console.log('REACT PARITY E2E PASS: catalog, modifiers, stock, recipe, cash, table, split, payment, KDS, delivery, units, hardware, redirects.');
}catch(error){
 console.error('REACT PARITY E2E FAIL',error);process.exitCode=1;
 if(page&&!page.isClosed())await shot('ERROR').catch(()=>{});
}finally{
 if(mobileContext){
  await mobileContext.tracing.stop(process.exitCode?{path:path.join(output,'traces','mobile-failure.zip')}:{ }).catch(e=>console.error('Mobile trace:',e));
  const mobileVideo=mobilePage?.video();await mobileContext.close();
  if(mobileVideo)await mobileVideo.saveAs(path.join(output,'videos','mobile-all-screens.webm')).catch(()=>{});
 }
 if(context){
  await context.tracing.stop(process.exitCode?{path:path.join(output,'traces','desktop-failure.zip')}:{ }).catch(e=>console.error('Desktop trace:',e));
  const recording=page?.video();await context.close();
  if(recording)await recording.saveAs(path.join(output,'videos','parity-journey.webm')).catch(()=>{});
 }
 if(browser)await browser.close();
 await app.close();
 fs.rmSync(tmp,{recursive:true,force:true});
}
