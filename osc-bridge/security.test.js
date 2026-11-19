const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authorize, validateMessage } = require('./security.js');
const token = 'a'.repeat(64);
const request = (headers = {}) => ({ method: 'GET', headers: {
  host: '127.0.0.1:8089', origin: 'https://hexatone.plainsound.org',
  'sec-websocket-protocol': `hexatone-osc, hexatone-token.${token}`, ...headers } });
test('requires a loopback host, approved origin and matching pairing token', () => {
  assert.equal(authorize(request(), token), true);
  assert.equal(authorize(request({ origin: 'http://localhost:5173' }), token), true);
  for (const headers of [{ origin: 'https://untrusted.invalid' }, { origin: 'null' }, { origin: undefined },
    { host: 'attacker.invalid:8089' }, { 'sec-websocket-protocol': 'hexatone-osc' },
    { 'sec-websocket-protocol': `hexatone-osc, hexatone-token.${'b'.repeat(64)}` }])
    assert.equal(authorize(request(headers), token), false);
});
test('rejects malformed commands, unsafe destinations, OSC argument types and bundles', () => {
  const ports = new Set([57101]);
  const valid = { port: 57101, address: '/n_set', args: [{ type: 'i', value: 100 }, 'gate', 0] };
  assert.equal(validateMessage(valid, ports), valid);
  const group = { port: 57101, address: '/g_new', args: [193260926, 0, 0] };
  assert.equal(validateMessage(group, ports), group);
  for (const msg of [null, [], {}, { ...valid, port: 53 }, { ...valid, address: '/quit' },
    { ...valid, address: '/b_write' }, { ...valid, address: '/d_load' }, { ...valid, address: {} },
    { ...valid, args: [null] }, { ...valid, args: [Infinity] }, { ...valid, args: [{ type: 'i', value: 2 ** 32 }] },
    { ...valid, args: ['null\0byte'] }, { ...valid, messages: [valid], timetagUnixMs: Infinity },
    { ...valid, messages: Array(257).fill(valid), timetagUnixMs: Date.now() }]) {
    assert.throws(() => validateMessage(msg, ports));
  }
});
