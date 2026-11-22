/** Small SSE parser; no third-party dependencies or persistent client database.
 * Emits complete events only after the blank-line delimiter.
 */
export function createSseEventParser(onEvent){
 let buffer='',event='message',data=[];
 return chunk=>{
  buffer+=String(chunk);
  if(buffer.length>65536)throw Error('Stream de eventos excedeu o limite');
  for(;;){
   const end=buffer.indexOf('\n');
   if(end===-1)break;
   const line=buffer.slice(0,end).replace(/\r$/,'');
   buffer=buffer.slice(end+1);
   if(line===''){
    if(data.length||event!=='message')onEvent({event,data:data.join('\n')});
    event='message';data=[];continue;
   }
   if(line.startsWith(':'))continue;
   const separator=line.indexOf(':');
   const field=separator===-1?line:line.slice(0,separator);
   let value=separator===-1?'':line.slice(separator+1);
   if(value.startsWith(' '))value=value.slice(1);
   if(field==='event')event=value||'message';
   else if(field==='data')data.push(value);
  }
 };
}
