import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress } from '../src/lib/network.js';

test('로컬 및 사설 IPv4 주소를 식별한다', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.20.0.1','192.168.0.1','169.254.0.1']) assert.equal(isPrivateAddress(address), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('로컬 및 사설 IPv6 주소를 식별한다', () => {
  for (const address of ['::1','fc00::1','fd00::1','fe80::1']) assert.equal(isPrivateAddress(address), true);
  assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
});
