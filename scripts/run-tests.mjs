import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import path from 'node:path';
const targets={core:'packages/core/test',api:'apps/server/tests'};
const folder=targets[process.argv[2]];
if(!folder){console.error('Uso: node scripts/run-tests.mjs core|api');process.exit(2);}
const files=readdirSync(folder).filter(f=>f.endsWith('.test.mjs')||f.endsWith('.test.ts')).sort().map(f=>path.join(folder,f));
if(!files.length){console.error(`Nenhum teste encontrado em ${folder}`);process.exit(2);}
const result=spawnSync(process.execPath,['--experimental-strip-types','--test',...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
