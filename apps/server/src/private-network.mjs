/** Canonical LAN/peer/printing address policy. Never accepts public or unspecified hosts. */
import net from 'node:net';
export const isLocalLanHostname=host=>typeof host==='string'&&
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.local$/i.test(host);
export function isPrivateIpv4(ip){
 if(net.isIP(ip)!==4)return false;
 const octets=ip.split('.').map(Number);
 return octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)
  ||(octets[0]===192&&octets[1]===168)||(octets[0]===127);
}
export function isPrivatePeerHost(host){
 return isLocalLanHostname(host)||(isPrivateIpv4(host)&&!host.startsWith('127.'));
}
