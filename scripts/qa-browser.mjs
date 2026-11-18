/** Browser QA against a real local SQLite host. Produces screenshots, never publishes a release. */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../apps/server/src/server.mjs';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-browser-qa-'));
const screenshots=path.resolve('artifacts/qa');
fs.mkdirSync(screenshots,{recursive:true});
const app=createApp({dataPath:path.join(folder,'qa.sqlite')});
const origin=await app.listen({port:0});
let browser,page;
const screenshot=async name=>{if(page&&!page.isClosed())await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage:true}).catch(()=>{});};
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true,locale:'pt-BR'});
  page=await context.newPage();
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.locator('#operator-login-form').waitFor();
  await page.locator('#operator-login-form input[name=username]').fill('admin');
  await page.locator('#operator-login-form input[name=password]').fill('senhaMuitoForte-2026');
  await page.locator('#operator-login-form button').click();
  await page.locator('#operator-login-form').waitFor({state:'detached'});
  await page.locator('#product-grid').waitFor();
  await screenshot('01-caixa-autenticado');

  await page.locator('[data-view="products"]').click();
  await page.locator('#category-form input[name=name]').fill('Lanches');
  await page.locator('#category-form button').click();
  await page.locator('#categories-list').getByText('Lanches').waitFor();
  await page.locator('#product-form input[name=name]').fill('X-QA');
  await page.locator('#product-form input[name=price]').fill('15.90');
  await page.locator('#product-category').selectOption({label:'Lanches'});
  await page.locator('#product-form button[type=submit]').click();
  await page.locator('#product-list').getByText('X-QA').waitFor();
  await screenshot('02-cardapio-com-categoria');

  await page.locator('[data-view="cash"]').click();
  await page.locator('#cash-open-form button').click();
  await page.waitForFunction(()=>document.querySelector('#cash-summary')?.textContent.includes('aberto'));
  await page.locator('[data-view="pos"]').click();
  await page.locator('#product-grid button').filter({hasText:'X-QA'}).click();
  await page.waitForFunction(()=>document.querySelector('#cart-total')?.textContent.includes('15,90'));
  await page.locator('#confirm-order').click();
  await page.waitForFunction(()=>document.querySelector('#pay-order')?.disabled===false);
  await screenshot('03-pedido-confirmado');
  await page.locator('#pay-order').click();
  await page.locator('#payment-dialog').waitFor({state:'visible'});
  await page.locator('#payment-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#order-status')?.textContent==='Fechado');
  await screenshot('04-venda-finalizada');
  await page.locator('[data-view="history"]').click();
  await page.locator('#history-list').getByText('CLOSED').waitFor();

  await page.locator('[data-view="fiscal"]').click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-form button[formaction="/api/exports/sales.csv"]').click()]);
  const csv=fs.readFileSync(await download.path(),'utf8');
  assert.match(csv,/1590/);
  assert.match(csv,/X-QA/);
  await screenshot('05-exportador-nao-fiscal');

  await page.goto(origin+'/restaurant.html',{waitUntil:'domcontentloaded'});
  await page.locator('#tables-grid').waitFor();
  await page.locator('#new-table-form input[name=label]').fill('Mesa QA');
  await page.locator('#new-table-form button').click();
  await page.getByRole('button',{name:/Mesa QA/}).click();
  await page.waitForFunction(()=>document.querySelector('#selected-title')?.textContent.includes('Mesa QA'));
  await page.locator('#add-item-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#comanda-lines')?.textContent.includes('X-QA'));
  await page.locator('#confirm-comanda').click();
  await page.waitForFunction(()=>document.querySelector('#selected-status')?.textContent==='OPEN');
  await screenshot('06-comanda-enviada');

  page=await context.newPage();
  await page.goto(origin+'/kitchen.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#kitchen-board')?.textContent.includes('Mesa QA'),{timeout:12000});
  await screenshot('07-kds-recebimento');
  assert.match(await page.locator('#kitchen-board').innerText(),/X-QA/);
  console.log('Browser E2E PASS: login, categoria, produto, caixa, pedido, pagamento, export, comanda e KDS');
} catch(e){
  await screenshot('erro-qa');
  console.error('Browser QA failed:',e);
  process.exitCode=1;
} finally {
  if(browser)await browser.close();
  await app.close();
  fs.rmSync(folder,{recursive:true,force:true});
}
