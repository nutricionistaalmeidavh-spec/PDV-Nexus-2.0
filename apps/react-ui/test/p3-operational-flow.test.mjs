import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSseEventParser} from '../src/kitchenEvents.mjs';

test('P3: SSE fragments, comments and multi-line fields trigger one event, not duplicate orders',()=>{
 const events=[];
 const parse=createSseEventParser(e=>events.push(e));
 parse(': ping\n\nevent: cha');
 parse('nged\ndata: {"id":"1"}\n\n');
 parse('event: ready\ndata: {}\n\n');
 assert.deepEqual(events.map(e=>e.event),['changed','ready']);
 assert.equal(events[0].data,'{"id":"1"}');
});

test('P3: SSE accepts CRLF and fields across chunks, ignores empty heartbeats',()=>{
 const events=[];
 const parse=createSseEventParser(e=>events.push(e));
 parse('event: changed\r\ndata: {"ticket":"a"}\r\n\r');
 parse('\nevent: changed\ndata: {"ticket":"b"}\n\n');
 assert.equal(events.length,2);
 assert.equal(events[1].data,'{"ticket":"b"}');
});

test('P3: React uses authenticated KDS event stream and fallback polling, not fixed 8-second polling',()=>{
 const source=readFileSync(new URL('../src/useOperations.jsx',import.meta.url),'utf8');
 assert.match(source,/\/api\/kitchen\/events/);
 assert.match(source,/AbortController/);
 assert.match(source,/Bearer/);
 assert.match(source,/setInterval/);
 assert.doesNotMatch(source,/,8000\)/);
});

test('P3: Electron-facing UI uses real dialogs instead of unsupported window.prompt',()=>{
 const files=['../src/App.jsx','../src/CatalogToolsPanel.jsx'];
 for(const file of files)assert.doesNotMatch(readFileSync(new URL(file,import.meta.url),'utf8'),/window\.prompt/,file);
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 assert.match(app,/OperationDialog/);
 const catalog=readFileSync(new URL('../src/CatalogToolsPanel.jsx',import.meta.url),'utf8');
 assert.match(catalog,/opened=\{Boolean\(editing\)\}/);
});
