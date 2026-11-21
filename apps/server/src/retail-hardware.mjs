/** EAN-13 and optional serial-scale adapters. No hardware or cloud required for decoding. */
const digits=value=>typeof value==='string'&&/^\d+$/.test(value);
export function encodeEan13(payload){
  if(!digits(payload)||payload.length!==12)throw new Error('EAN-13 exige 12 dígitos');
  let sum=0;
  for(let i=0;i<12;i++)sum+=Number(payload[i])*(i%2?3:1);
  return payload+String((10-sum%10)%10);
}
export function decodeEan13(code){
  return {valid:digits(code)&&code.length===13&&encodeEan13(code.slice(0,12))===code,code};
}
export function decodeScaleLabel(code,{mode='weight'}={}){
  if(!decodeEan13(code).valid||!/^2\d/.test(code))throw new Error('Etiqueta EAN-13 de balança inválida');
  const plu=code.slice(2,7),value=Number(code.slice(7,12));
  if(mode==='weight')return {plu,weightGrams:value};
  if(mode==='price')return {plu,priceCents:value};
  throw new Error('Modo de etiqueta inválido');
}
/** Returns grams, not money or inventory milli-units. Must confirm stable reading before selling. */
export function parseScaleSerial(raw,{brand='generic'}={}){
  if(typeof raw!=='string'||raw.length>256||!['generic','toledo','filizola'].includes(brand))throw new Error('Quadro de balança inválido');
  const frame=raw.replace(/^[\x02\s]+|[\x03\r\n\s]+$/g,'').replace(',','.');
  let stable=!/^(?:US|UNSTABLE)[,:]/i.test(frame);
  if(/^(?:ST|US)[,:]/i.test(frame))stable=/^ST[,:]/i.test(frame);
  let weightGrams;
  if(brand==='toledo'&&raw.length>20&&/^\d{6}$/.test(raw.substring(2,8))){
    const divisor=(raw.charCodeAt(8)&8)?100:1000;
    weightGrams=Math.round(Number(raw.substring(2,8))*1000/divisor);
  }else{
    const match=frame.match(/([+-]?\d+(?:\.\d+)?)(?:\s*(kg|g))?/i);
    if(!match)throw new Error('Peso ausente ou quadro serial não reconhecido');
    const n=Number(match[1]);
    // Filizola responses without a unit commonly encode thousandths of kg.
    if(match[2]?.toLowerCase()==='g')weightGrams=Math.round(n);
    else if(match[2]?.toLowerCase()==='kg'||match[1].includes('.'))weightGrams=Math.round(n*1000);
    else weightGrams=Math.round(n);
  }
  if(!Number.isSafeInteger(weightGrams)||weightGrams<0)throw new Error('Peso inválido ou negativo');
  return {brand,weightGrams,stable,raw};
}
export function validateSerialDevicePath(devicePath){
  if(typeof devicePath!=='string')return false;
  return /^COM(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-6])$/i.test(devicePath)
    || /^\/dev\/(?:ttyUSB\d{1,3}|ttyACM\d{1,3}|ttyS\d{1,3})$/.test(devicePath);
}
/** USB virtual COM / RS232 only. Requires serialport installed explicitly by the operator. */
export async function transmitSerial(devicePath,baudRate,bytes){
  if(!validateSerialDevicePath(devicePath)||![9600,19200,38400,57600,115200].includes(baudRate))
    throw new Error('Dispositivo serial ou velocidade inválidos');
  let SerialPort;
  try {({SerialPort}=await import('serialport'));}
  catch {throw new Error('Driver serial opcional ausente: instale serialport no host para usar USB-serial/COM');}
  const port=new SerialPort({path:devicePath,baudRate,autoOpen:false});
  await new Promise((resolve,reject)=>{
    let settled=false;
    const done=(error)=>{if(settled)return;settled=true;clearTimeout(timeout);if(error)reject(error);else resolve();};
    const timeout=setTimeout(()=>{port.close(()=>{});done(new Error('Tempo de impressão serial excedido'));},5000);
    port.open(error=>{
      if(error)return done(error);
      port.write(bytes,error=>{
        if(error)return port.close(()=>done(error));
        port.drain(error=>port.close(closeError=>done(error||closeError)));
      });
    });
    port.on('error',done);
  });
}
