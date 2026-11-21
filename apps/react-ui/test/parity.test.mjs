import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const host=readFileSync(new URL('../../server/src/server.mjs',import.meta.url),'utf8');
const business=readFileSync(new URL('../src/BusinessPanels.jsx',import.meta.url),'utf8');
test('React must contain no navigation back to the legacy interface',()=>{
  assert.doesNotMatch(app,/href="\/restaurant\.html"|href="\/\?view=|Interface operacional clássica|legacyView=/);
  assert.doesNotMatch(business,/href="\/\?view=/);
});
test('all modules previously delegated to the legacy UI have an active React implementation',()=>{
  for(const name of ['DeliveryPanel','UnitsPanel','AdvancedStockPanel','TableOrderPanel','CatalogToolsPanel','HardwareToolsPanel']){
    assert.match(app,new RegExp(name));
  }
});
test('host redirects the old admin entrypoint to the unified React UI',()=>{
  assert.match(host,/route==='\/'.*\/ui\//);
});
