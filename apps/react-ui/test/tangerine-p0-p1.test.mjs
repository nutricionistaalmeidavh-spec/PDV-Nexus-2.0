import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../src/',import.meta.url);
const tokens=()=>readFileSync(new URL('design-tokens.css',root),'utf8');
const css=()=>readFileSync(new URL('theme.css',root),'utf8');
const app=()=>readFileSync(new URL('App.jsx',root),'utf8');
const hex=(css,key)=>{
 const value=css.match(new RegExp('--'+key+'\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;'));
 assert.ok(value,'Token semântico ausente: '+key);
 return value[1];
};
const luminance=color=>{
 const rgb=color.match(/[a-fA-F0-9]{2}/g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
};
const ratio=(a,b)=>{
 const x=luminance(a),y=luminance(b);
 return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
};

test('P0: tokens Tangerine tem papéis semânticos, estados e acessibilidade AA',()=>{
 const design=tokens();
 for(const role of ['canvas','surface','surface-soft','text','text-muted','primary','on-primary','primary-hover','accent','border','focus','success','danger','warning']){
   assert.match(design,new RegExp('--'+role+'\\s*:'),'token '+role);
 }
 assert.equal(hex(design,'canvas').toUpperCase(),'#FFF9F4');
 assert.equal(hex(design,'primary').toUpperCase(),'#C2410C');
 assert.ok(ratio(hex(design,'primary'),hex(design,'on-primary'))>=4.5,'botão primário deve passar contraste AA');
 assert.ok(ratio(hex(design,'text'),hex(design,'surface'))>=7,'corpo com contraste AAA');
 assert.match(design,/prefers-reduced-motion/,'respeitar preferência por movimento reduzido');
});

test('P0: CSS usa tokens e remove dependência cromática da identidade roxa',()=>{
 const content=css();
 assert.doesNotMatch(content,/--purple|--violet|--purpleDark|--purplePale/);
 assert.doesNotMatch(content,/#(?:6e20e4|4710b9|6820e9|812cff|8b31fc|5c11cc)/i);
 assert.match(content,/var\(--primary\)/);
 assert.match(content,/var\(--canvas\)/);
 assert.match(content,/\.btn\.primary/);
 assert.match(content,/\.topbar/);
});

test('P1: venda mantém seletores e ações do caixa e apresenta busca e comanda melhoradas',()=>{
 const source=app();
 for(const part of ['sale-toolbar','catalog-results','aria-pressed={category===c.id}','sale-summary-head','sale-order-summary','sale-cart-count']){
   assert.ok(source.includes(part),'Controle de PDV ausente: '+part);
 }
 for(const selector of ['product-card','order-lines','order-foot','payment-columns','pay-choice','Confirmar recebimento','Finalizar venda (F10)','Buscar por nome ou código (F3)']){
   assert.ok(source.includes(selector),'Contrato funcional do caixa perdido: '+selector);
 }
 assert.match(source,/aria-label="Categorias de produtos"/);
 assert.match(source,/aria-label="Formas de pagamento"/);
 assert.match(source,/Comprovante não fiscal/);
});
