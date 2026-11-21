/** E2E P0-P2: React production build, host real SQLite, restart, mobile and legacy parity. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../apps/server/src/server.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-react-e2e-'));
const database=path.join(temp,'nexus.db');
const screenshots=path.resolve('artifacts/qa');
fs.mkdirSync(screenshots,{recursive:true});
let app,browser,origin,page;
async function start(){app=createApp({dataPath:database});origin=await app.listen({port:0});}
async function snap(label){if(page&&!page.isClosed())await page.screenshot({path:path.join(screenshots,label+'.png'),fullPage:true}).catch(()=>{});}
async function clickNav(text){await page.locator('.sidebar .nav-item').filter({hasText:text}).click();}
async function cookieLogin(username,password){
 const r=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
 assert.equal(r.status,200,'Login após reiniciar deve funcionar');
 return r.headers.get('set-cookie')?.split(';')[0];
}
try {
 await start();
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:940},locale:'pt-BR'});
 page=await ctx.newPage();
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 await page.goto(origin+'/ui/?embedded=1');
 await page.locator('.authcard').waitFor();
 await page.locator('.authcard input').nth(0).fill('admin');
 await page.locator('.authcard input').nth(1).fill('senhaMuitoForte-2026');
 await page.locator('.authcard button[type=submit]').click();
 await page.locator('.sidebar .nav-item').first().waitFor();
 await clickNav('Produtos e cardápio');
 await page.locator('.product-form input').nth(0).fill('X-QA-React');
 await page.locator('.product-form input').nth(1).fill('25,00');
 await page.locator('.product-form button.btn.primary').click();
 await page.locator('.product-list').getByText('X-QA-React').waitFor();
 await snap('react-01-cardapio');
 await clickNav('Controle de caixa');
 await page.locator('.cash-main input').fill('100,00');
 await page.getByRole('button',{name:'Abrir caixa'}).click();
 await page.getByText('Caixa aberto',{exact:true}).waitFor();
 await snap('react-02-caixa');
 await clickNav('Nova venda');
 await page.locator('.product-card').filter({hasText:'X-QA-React'}).click();
 await page.getByRole('dialog',{name:'Personalizar produto'}).waitFor();
 await page.getByRole('button',{name:/Adicionar ao pedido/}).click();
 await page.locator('.order-lines').getByText('X-QA-React').waitFor();
 await page.getByRole('button',{name:'Confirmar pedido'}).click();
 await page.getByRole('button',{name:/Finalizar venda/}).waitFor();
 await page.getByRole('button',{name:/Finalizar venda/}).click();
 await page.getByRole('dialog',{name:'Finalizar venda'}).waitFor();
 await page.getByRole('button',{name:'Confirmar recebimento'}).click();
 await page.getByText('Venda concluída!',{exact:true}).waitFor();
 await snap('react-03-venda-gravada');
 assert.deepEqual(errs,[],'Erros no console de execução');
 // Conferir venda fechada no banco canônico antes da reinicialização.
 let cookie=(await ctx.cookies(origin)).find(c=>c.name)?.name;
 const state=await page.evaluate(async()=>{const r=await fetch('/api/orders');return r.json();});
 const closed=state.orders.filter(o=>o.status==='CLOSED');
 assert.equal(closed.length,1,'Não duplicar fechamento');
 const closedId=closed[0].id;
 await page.reload();await clickNav('Pedidos');await page.getByText('#'+closedId.slice(-8)).waitFor();
 await snap('react-04-pedidos-persistidos');
 // P0-P3: telas React agora consultam o mesmo host em vez de mostrar apenas prévias.
 await clickNav('Estoque');
 await page.getByRole('heading',{name:'Estoque, fornecedores e compras'}).waitFor();
 await page.getByText('Valor contábil do estoque').waitFor();
 await snap('react-05-estoque-canonico');
 await clickNav('Financeiro');
 await page.getByRole('heading',{name:'Financeiro',exact:true}).waitFor();
 await page.getByText('Receita líquida').waitFor();
 await snap('react-06-financeiro-canonico');
 await clickNav('Relatórios');
 await page.getByRole('heading',{name:'Relatórios financeiros'}).waitFor();
 await snap('react-07-relatorios-canonicos');
 await clickNav('Backup e atualizações');
 await page.getByRole('heading',{name:'Backup e atualizações'}).waitFor();
 await page.getByRole('button',{name:'Criar backup agora'}).click();
 await page.getByText('Backup SQLite validado:',{exact:false}).waitFor();
 await snap('react-08-manutencao');
 await clickNav('Estoque');
 await page.getByRole('heading',{name:'Lotes, fichas técnicas e movimentações'}).waitFor();
 await snap('react-09-estoque-avancado');
 // Teste mobile da interface React.
 await page.setViewportSize({width:390,height:844});
 await page.goto(origin+'/ui/?embedded=1');await page.getByRole('heading',{name:'Nova venda'}).waitFor();
 await snap('react-10-mobile');
 // Com o host indisponível, Electron bloqueia prévia e recebimentos.
 const offline=await browser.newContext({viewport:{width:1200,height:800}});
 const offPage=await offline.newPage();
 await offPage.route('**/api/auth/status',r=>r.abort('failed'));
 await offPage.goto(origin+'/ui/?embedded=1');
 await offPage.getByText('Caixa indisponível').waitFor();
 assert.equal(await offPage.getByText('Prévia visual:',{exact:false}).count(),0);
 await offline.close();
 await ctx.close();
 await app.close();app=null;
 await start();
 const cookieValue=await cookieLogin('admin','senhaMuitoForte-2026');
 const result=await fetch(origin+'/api/orders',{headers:{cookie:cookieValue}});
 assert.equal(result.status,200);
 const snapshot=await result.json();
 assert.ok(snapshot.orders.some(o=>o.id===closedId&&o.status==='CLOSED'),'Venda deve sobreviver ao reinício');
 console.log('PASS React: build+login+catálogo+caixa+venda+comprovante+pedidos+estoque/financeiro/relatorios React+backup+mobile+offline+restart');
} catch(e){
 await snap('react-ERRO');console.error('React browser QA failed',e);process.exitCode=1;
} finally {
 if(browser)await browser.close();
 if(app)await app.close();
 fs.rmSync(temp,{recursive:true,force:true});
}
