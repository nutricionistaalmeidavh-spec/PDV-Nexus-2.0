import test from 'node:test';
import assert from 'node:assert/strict';
import {isPrivateIpv4,isPrivatePeerHost,isLocalLanHostname} from '../src/private-network.mjs';

test('P2: RFC1918 e loopback são classificados de forma consistente para impressoras e peers',()=>{
 for(const ip of ['10.1.2.3','172.16.0.1','172.31.255.255','192.168.20.30']){
   assert.equal(isPrivateIpv4(ip),true);
   assert.equal(isPrivatePeerHost(ip),true);
 }
 assert.equal(isPrivateIpv4('127.0.0.1'),true);
 assert.equal(isPrivatePeerHost('127.0.0.1'),false);
 for(const ip of ['8.8.8.8','172.32.0.1','172.15.255.255','169.254.1.1','0.0.0.0','::1','999.168.0.1']){
   assert.equal(isPrivateIpv4(ip),false,ip);
   assert.equal(isPrivatePeerHost(ip),false,ip);
 }
 assert.equal(isPrivatePeerHost('kitchen.local'),true);
 assert.equal(isLocalLanHostname('kitchen.local'),true);
 assert.equal(isPrivatePeerHost('evil.example.org'),false);
});
