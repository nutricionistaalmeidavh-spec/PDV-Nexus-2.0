/** Windows RAW spooler backend for installed USB or network thermal printer queues.
 * Uses only the built-in Windows PowerShell and Winspool API. No SaaS/native npm package.
 * Spooler acknowledgement is NOT proof that paper was physically printed.
 */
import {spawn} from 'node:child_process';
export const validatePrinterQueueName=name=>
  typeof name==='string'&&name.trim()===name&&/^[^\\/:*?"<>|\x00-\x1f]{1,90}$/.test(name);
const source=String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class NexusRawSpool {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public class DOC_INFO_1 {
  [MarshalAs(UnmanagedType.LPWStr)] public string pDocName="PDV Nexus - Recibo nao fiscal";
  [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile=null;
  [MarshalAs(UnmanagedType.LPWStr)] public string pDataType="RAW";
 }
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
 [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern bool ClosePrinter(IntPtr handle);
 [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOC_INFO_1 info);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
 [DllImport("winspool.drv", SetLastError=true)]
 public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int length, out int written);
 public static void Print(string name, byte[] data) {
  IntPtr handle=IntPtr.Zero;
  if(!OpenPrinter(name,out handle,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
  bool started=false, page=false;
  try {
   if(StartDocPrinter(handle,1,new DOC_INFO_1())==0)throw new Win32Exception(Marshal.GetLastWin32Error());
   started=true;
   if(!StartPagePrinter(handle))throw new Win32Exception(Marshal.GetLastWin32Error());
   page=true;
   int written;
   if(!WritePrinter(handle,data,data.Length,out written)||written!=data.Length)
    throw new Win32Exception(Marshal.GetLastWin32Error(),"RAW printer write incomplete");
  } finally {
   if(page)EndPagePrinter(handle);
   if(started)EndDocPrinter(handle);
   ClosePrinter(handle);
  }
 }
}
`;
const script=String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
${source}
'@
$json=[Console]::In.ReadToEnd() | ConvertFrom-Json
[NexusRawSpool]::Print([string]$json.printer,[Convert]::FromBase64String([string]$json.bytes))
`;
export async function transmitWindowsRaw(printerName,bytes){
 if(!validatePrinterQueueName(printerName))throw new Error('Nome da fila Windows inválido');
 if(process.platform!=='win32')throw new Error('Spooler RAW disponível apenas no Windows');
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>65536)throw new Error('Recibo inválido');
 const encoded=Buffer.from(script,'utf16le').toString('base64');
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{
   windowsHide:true,stdio:['pipe','ignore','pipe']
  });
  let stderr='',finished=false;
  const settle=error=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();settle(new Error('Tempo de impressão Windows excedido'));},12000);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1000);});
  child.on('error',settle);
  child.on('close',code=>settle(code===0?null:new Error('Fila de impressão Windows recusou o recibo: '+stderr.slice(0,300))));
  child.stdin.on('error',()=>{}); // avoid unhandled EPIPE when a queue fails early
  child.stdin.end(JSON.stringify({printer:printerName,bytes:bytes.toString('base64')}));
 });
}
