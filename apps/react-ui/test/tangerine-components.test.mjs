import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(file)=>readFileSync(new URL(file,import.meta.url),'utf8');
const app=read('../src/App.jsx');
const pos=read('../src/PosExperience.jsx');
const theme=read('../src/NexusTheme.jsx');
const styles=read('../src/nexus-pos.css');
const legacy=read('../src/theme.css');
const entry=read('../src/main.jsx');
const pkg=JSON.parse(read('../package.json'));

function luminance(hex){
 const rgb=hex.match(/.{2}/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
}
function contrast(a,b){
 const l=[luminance(a),luminance(b)].sort((x,y)=>x-y);
 return (l[1]+.05)/(l[0]+.05);
}

test('P0: Mantine theme and Lucide are real, pinned, MIT/ISC local components',()=>{
 assert.equal(pkg.dependencies['@mantine/core'],'9.8.2');
 assert.equal(pkg.dependencies['@mantine/hooks'],'9.8.2');
 assert.equal(pkg.dependencies['@mantine/notifications'],'9.8.2');
 assert.equal(pkg.dependencies['lucide-react'],'1.77.0');
 assert.match(entry,/import '@mantine\/core\/styles\.css'/);
 assert.match(entry,/NexusTheme/);
 assert.match(theme,/MantineProvider/);
 assert.match(theme,/Notifications/);
 assert.match(app,/AppShell\.Header/);
 assert.match(app,/AppShell\.Navbar/);
 assert.match(app,/NavLink component="button"/);
 assert.match(app,/from 'lucide-react'/);
 assert.doesNotMatch(app,/Interface operacional clássica/);
});

test('P0: primary orange with white label meets WCAG AA normal text',()=>{
 assert.ok(contrast('C2410C','FFFFFF')>=4.5);
 assert.match(theme,/#C2410C/);
 assert.match(styles,/\.mantine-AppShell-header\.topbar/);
 assert.match(styles,/\.mantine-AppShell-navbar\.sidebar/);
 assert.match(styles,/@media\(max-width:767px\)/);
 assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
 assert.doesNotMatch(legacy,/--purple|--violet|--purpleDark|--purplePale/);
});

test('P1: POS production flow stays on canonical API props, accessibility and desktop controls',()=>{
 for(const name of ['PosSale','PosPaymentModal','PosProductModal']){
  assert.match(pos,new RegExp('export function '+name+'\\('));
 }
 for(const value of [
  'product-card','order-lines','order-foot','sale-order-summary','sale-toolbar',
  'Categorias de produtos','aria-pressed={category===c.id}','Buscar por nome ou código (F3)',
  'Finalizar venda (F10)','Confirmar recebimento','paymentDraft(','onPay(payments)',
  'onConfirm','onCancel','onNew','onChoose(p)','Comprovante não fiscal'
 ]) assert.ok(pos.includes(value),'P1 contract missing: '+value);
 assert.match(pos,/NumberInput/);
 assert.match(pos,/SegmentedControl/);
 assert.match(pos,/ScrollArea/);
 assert.match(pos,/SimpleGrid/);
 assert.match(pos,/from '@mantine\/core'/);
 assert.match(app,/PosSale as Sale/);
});

test('P1: cashier does not call payment APIs or duplicate domain state',()=>{
 const sale=pos.slice(pos.indexOf('export function PosSale('));
 assert.doesNotMatch(sale,/fetch\s*\(|request\s*\(|\baxios\b|localStorage|indexedDB/);
 assert.match(sale,/const total=sumOrder\(order\)/);
 assert.match(pos,/paymentDraft\(total,method/);
 assert.match(pos,/parseMoney\(tendered\)/);
});
