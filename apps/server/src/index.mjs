import { createApp } from './server.mjs';
const app=createApp({dataPath:process.env.PDV_DATA_PATH,operationMode:process.env.PDV_OPERATION_MODE??'demo'});
const origin=await app.listen({port:Number(process.env.PDV_PORT??3434)});
console.log(`PDV Nexus 2.0 (DEMONSTRACAO NAO FISCAL): ${origin}`);
const stop=async()=>{await app.close();process.exit(0);};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
