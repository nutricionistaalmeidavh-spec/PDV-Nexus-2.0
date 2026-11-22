import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScaleSerial} from '../src/retail-hardware.mjs';

test('P3: decimal without unit is rejected instead of silently interpreting grams as kg',()=>{
 for(const frame of ['ST,125.5','US,125.5','125,50','ST,+0.750']){
  assert.throws(()=>parseScaleSerial(frame,{brand:'generic'}),/unidade|ambígu|kg|g\b/i,frame);
 }
});

test('P3: kg and grams explicit follow same integer-gram scale',()=>{
 assert.equal(parseScaleSerial('ST,+0.750 kg').weightGrams,750);
 assert.equal(parseScaleSerial('ST,750g').weightGrams,750);
 assert.equal(parseScaleSerial('ST,1,250kg').weightGrams,1250);
 assert.equal(parseScaleSerial('US,+0.750kg').stable,false);
});

test('P3: unitless integer grams remain supported, negative values rejected',()=>{
 assert.equal(parseScaleSerial('ST,750').weightGrams,750);
 assert.throws(()=>parseScaleSerial('ST,-1kg'),/inválido|negativo/i);
});
