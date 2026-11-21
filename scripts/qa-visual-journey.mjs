/** Visual inventory of the PDV Nexus 2.0 UI: screenshots + Playwright WebM recordings.
 * Uses an isolated SQLite database. It does not publish or contact paid services.
 */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../apps/server/src/server.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-nexus-visual-qa-'));
const output=path.resolve('artifacts/qa');
const videos=path.join(output,'videos');
fs.mkdirSync(videos,{recursive:true});
const app=createApp({dataPath:path.join(temp,'isolated-qa.sqlite')});
const files=[];
const errors=[];
let browser,desktop,phone,desktopContext,phoneContext;
let origin;
let passed=false;

const slug=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
async function snap(page,name){
  const filename=name+'.png';
  await page.screenshot({path:path.join(output,filename),fullPage:true,animations:'disabled'});
  files.push({screen:name,filename});
}
async function signIn(page){
  await page.locator('.authcard input').first().fill('admin');
  await page.locator('.authcard input').nth(1).fill('senhaMuitoForte-2026');
  await page.locator('.authcard button[type=submit]').click();
  await page.locator('.sidebar .nav-item').first().waitFor();
}
function track(page,scope){
  page.on('pageerror',error=>errors.push({scope,message:error.message}));
}
try {
  origin=await app.listen({port:0});
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  desktopContext=await browser.newContext({
    viewport:{width:1440,height:900},locale:'pt-BR',acceptDownloads:true,
    recordVideo:{dir:path.join(temp,'desktop-raw'),size:{width:1440,height:900}}
  });
  desktop=await desktopContext.newPage();
  track(desktop,'desktop');
  await desktop.goto(origin+'/ui/?embedded=1',{waitUntil:'domcontentloaded'});
  await desktop.locator('.authcard').waitFor();
  await snap(desktop,'jornada-00-login-react');
  await signIn(desktop);
  const count=await desktop.locator('.sidebar .nav-item').count();
  assert.ok(count>=15,'React navigation has unexpectedly lost modules');
  for(let i=0;i<count;i++){
    const item=desktop.locator('.sidebar .nav-item').nth(i);
    const label=(await item.innerText()).trim();
    await item.click();
    await desktop.locator('.sidebar .nav-item').nth(i).waitFor();
    assert.match(await desktop.locator('.sidebar .nav-item').nth(i).getAttribute('class'),/active/);
    await desktop.waitForLoadState('networkidle',{timeout:2000}).catch(()=>{});
    await snap(desktop,'jornada-react-'+String(i+1).padStart(2,'0')+'-'+slug(label));
  }
  await desktop.goto(origin,{waitUntil:'domcontentloaded'});
  const classicLogin=desktop.locator('#operator-login-form');
  if(await classicLogin.isVisible()){
    await classicLogin.locator('input[name=username]').fill('admin');
    await classicLogin.locator('input[name=password]').fill('senhaMuitoForte-2026');
    await classicLogin.locator('button').click();
    await classicLogin.waitFor({state:'detached'});
  }
  const classic=desktop.locator('.sidebar button[data-view]');
  const classicCount=await classic.count();
  assert.ok(classicCount>=10,'Classic interface has unexpectedly lost modules');
  for(let i=0;i<classicCount;i++){
    const item=desktop.locator('.sidebar button[data-view]').nth(i);
    const view=await item.getAttribute('data-view');
    await item.click();
    await desktop.locator('#view-'+view+'.visible').waitFor();
    await desktop.waitForLoadState('networkidle',{timeout:2000}).catch(()=>{});
    await snap(desktop,'jornada-classico-'+String(i+1).padStart(2,'0')+'-'+slug(view));
  }
  for(const [name,url,selector] of [
    ['restaurante-mesas','/restaurant.html','#tables-grid'],
    ['cozinha-kds','/kitchen.html','#kitchen-board'],
    ['cardapio-publico','/menu.html','body']
  ]){
    await desktop.goto(origin+url,{waitUntil:'domcontentloaded'});
    await desktop.locator(selector).waitFor();
    await snap(desktop,'jornada-'+name);
  }
  phoneContext=await browser.newContext({
    viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1,locale:'pt-BR',
    recordVideo:{dir:path.join(temp,'phone-raw'),size:{width:390,height:844}}
  });
  phone=await phoneContext.newPage();
  track(phone,'mobile');
  await phone.goto(origin+'/ui/?embedded=1',{waitUntil:'domcontentloaded'});
  await phone.locator('.authcard').waitFor();
  await snap(phone,'jornada-mobile-01-login');
  await signIn(phone);
  await snap(phone,'jornada-mobile-02-nova-venda');
  await phone.goto(origin+'/menu.html',{waitUntil:'domcontentloaded'});
  await snap(phone,'jornada-mobile-03-cardapio');
  assert.deepEqual(errors,[],'No JavaScript page exceptions expected');
  passed=true;
  console.log('VISUAL JOURNEY PASS: '+count+' React screens, '+classicCount+' classic screens, restaurant/KDS/menu and mobile.');
} catch(error){
  errors.push({scope:'runner',message:String(error?.stack||error)});
  if(desktop&&!desktop.isClosed())await desktop.screenshot({path:path.join(output,'jornada-ERRO-desktop.png'),fullPage:true}).catch(()=>{});
  if(phone&&!phone.isClosed())await phone.screenshot({path:path.join(output,'jornada-ERRO-mobile.png'),fullPage:true}).catch(()=>{});
  console.error('VISUAL JOURNEY FAILED:',error);
  process.exitCode=1;
} finally {
  const save=async(ctx,page,name)=>{
    if(!ctx)return;
    const recording=page?.video();
    await ctx.close();
    if(recording){
      try {await recording.saveAs(path.join(videos,name));}
      catch(e){errors.push({scope:name,message:'Failed saving video: '+e.message});process.exitCode=1;}
    }
  };
  await save(phoneContext,phone,'jornada-mobile.webm');
  await save(desktopContext,desktop,'jornada-desktop.webm');
  fs.writeFileSync(path.join(output,'jornada-manifest.json'),JSON.stringify({
    generatedAt:new Date().toISOString(),success:passed&&!process.exitCode,
    isolatedDatabase:true,screenshots:files,recordings:['videos/jornada-desktop.webm','videos/jornada-mobile.webm'],errors
  },null,2));
  if(browser)await browser.close();
  await app.close();
  fs.rmSync(temp,{recursive:true,force:true});
}
