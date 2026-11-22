/** Hard cap remote JSON before parsing. No cloud/runtime dependency. */
export async function readBoundedJson(response,{maxBytes=4*1024*1024}={}){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32*1024*1024)
   throw Error('Limite de leitura inválido');
 const size=Number(response.headers?.get?.('content-length'));
 if(Number.isFinite(size)&&size>maxBytes)throw Error('Resposta remota excede limite permitido');
 if(!response.body?.getReader){
   const value=await response.json();
   if(Buffer.byteLength(JSON.stringify(value),'utf8')>maxBytes)throw Error('Resposta remota excede limite permitido');
   return value;
 }
 const reader=response.body.getReader();
 const parts=[];
 let total=0;
 try{
   for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     total+=value.byteLength;
     if(total>maxBytes){
       await reader.cancel().catch(()=>{});
       throw Error('Resposta remota excede limite permitido');
     }
     parts.push(Buffer.from(value));
   }
 }finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(parts,total).toString('utf8'));}
 catch{throw Error('JSON remoto inválido');}
}
