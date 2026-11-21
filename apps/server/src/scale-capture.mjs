/** Serial weight capture: 2 consistent stable frames, no subscription or mandatory drivers. */
import {parseScaleSerial,validateSerialDevicePath} from './retail-hardware.mjs';
export function priceForWeight(pricePerKgCents,weightGrams){
 if(!Number.isSafeInteger(pricePerKgCents)||pricePerKgCents<0||
    !Number.isSafeInteger(weightGrams)||weightGrams<1||weightGrams>100000)
    throw new Error('Preço por kg ou peso em gramas inválido');
 const price=(BigInt(pricePerKgCents)*BigInt(weightGrams)+500n)/1000n;
 if(price>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Preço excede limite monetário');
 return Number(price);
}
export async function captureStableScale({devicePath,baudRate=9600,brand='generic',timeoutMs=5000}){
 if(!validateSerialDevicePath(devicePath)||![9600,19200,38400,57600,115200].includes(baudRate)||
    !['generic','toledo','filizola'].includes(brand))throw Error('Configuração serial inválida');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>10000)throw Error('Timeout inválido');
 let SerialPort;
 try{({SerialPort}=await import('serialport'));}
 catch{throw new Error('Driver opcional serialport ausente no host. Instale somente ao conectar balança.');}
 return new Promise((resolve,reject)=>{
  const port=new SerialPort({path:devicePath,baudRate,autoOpen:false});
  let finished=false,buffer='',last=null;
  const cleanup=(error,value)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   try{port.close(()=>{});}catch{}
   if(error)reject(error);else resolve(value);
  };
  const timer=setTimeout(()=>cleanup(Error('Leitura estável não recebida dentro do limite')),timeoutMs);
  port.on('error',e=>cleanup(e));
  port.on('data',data=>{
   if(finished)return;
   buffer+=Buffer.from(data).toString('latin1');
   if(buffer.length>4096)buffer=buffer.slice(-2048);
   let pos;
   while((pos=buffer.search(/[\r\n\x03]/))!==-1){
    const frame=buffer.slice(0,pos);buffer=buffer.slice(pos+1);
    if(!frame.trim())continue;
    try{
     const parsed=parseScaleSerial(frame,{brand});
     if(!parsed.stable||parsed.weightGrams<=0){last=null;continue;}
     if(last!==null&&Math.abs(last-parsed.weightGrams)<=2){
      cleanup(null,{brand,devicePath,weightGrams:parsed.weightGrams,stable:true,capturedAt:new Date().toISOString()});
      break;
     }
     last=parsed.weightGrams;
    }catch{last=null;}
   }
  });
  port.open(error=>{if(error)cleanup(error);});
 });
}
