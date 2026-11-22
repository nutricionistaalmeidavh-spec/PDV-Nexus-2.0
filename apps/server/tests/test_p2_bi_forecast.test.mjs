import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastProductSeries,recommendReplenishment} from '../src/management-intelligence.mjs';

test('P2: previsão de demanda considera sazonalidade semanal e exige histórico mínimo',()=>{
 const history=[];
 const base=new Date('2026-09-01T12:00:00.000Z');
 for(let i=0;i<56;i++){
  const day=new Date(base.getTime()+i*86400000).toISOString().slice(0,10);
  history.push({day,quantity:new Date(day+'T12:00:00Z').getUTCDay()===1?10:2});
 }
 const prediction=forecastProductSeries(history,'2026-10-27',7,56);
 assert.equal(prediction.status,'READY');
 assert.equal(prediction.days.length,7);
 const monday=prediction.days.find(x=>new Date(x.day+'T12:00:00Z').getUTCDay()===1);
 assert.ok(monday.expectedUnits>=8,'segundas têm demanda mais alta');
 assert.ok(prediction.days.every(x=>Number.isSafeInteger(x.expectedUnits)&&x.expectedUnits>=0));
 const sparse=forecastProductSeries([{day:'2026-10-26',quantity:8}],'2026-10-27',7,56);
 assert.equal(sparse.status,'INSUFFICIENT_HISTORY');
 assert.equal(sparse.expectedUnits,null,'não inventar previsão com um único dia');
});

test('P2: sugestão de reposição ignora lote vencido, respeita estoque mínimo e jamais compra automaticamente',()=>{
 const out=recommendReplenishment({onHandMilli:25000,lowStockMilli:10000,bookValueCents:10000,
  batches:[{remainingMilli:15000,expiryDate:'2026-11-01'}],
  dailySales:[{day:'2026-11-12',quantityMilli:5000},{day:'2026-11-15',quantityMilli:5000}]},
  {today:'2026-11-22',lookbackDays:14,leadDays:3,safetyDays:2});
 assert.equal(out.usableMilli,10000);
 assert.equal(out.expiredMilli,15000);
 assert.ok(out.recommendedMilli>=0);
 assert.equal(out.automaticPurchase,false);
 const withoutHistory=recommendReplenishment({onHandMilli:0,lowStockMilli:9000,bookValueCents:0,batches:[],dailySales:[]},
  {today:'2026-11-22',lookbackDays:28,leadDays:3,safetyDays:2});
 assert.equal(withoutHistory.recommendedMilli,9000,'mínimo manual continua valendo');
 assert.equal(withoutHistory.demandConfidence,'INSUFFICIENT_HISTORY');
});

test('P2: previsão rejeita datas futuras e intervalos inválidos',()=>{
 assert.throws(()=>forecastProductSeries([],'2026-02-30',7,56),/Data|data|inválid/);
 assert.throws(()=>forecastProductSeries([],'2026-11-22',31,56),/Horizonte|horizonte|inválid/);
});
