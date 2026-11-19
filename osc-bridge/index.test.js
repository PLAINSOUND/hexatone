/** Real loopback WebSocket/UDP tests; never forward to a running synth. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createSocket } = require('node:dgram');
const { WebSocket } = require('ws');
const { createOscBridge } = require('./index.js');
const { decodeOscMessage } = require('./diagnostics.js');
const token = 'a'.repeat(64);
let bridge, receiver, url, port;
before(async () => {
  receiver = createSocket('udp4'); receiver.bind(0, '127.0.0.1');
  await once(receiver, 'listening'); port = receiver.address().port;
  bridge = createOscBridge({ port: 0, token, allowedPorts: [port] });
  bridge.listen(); await once(bridge.server, 'listening');
  assert.equal(bridge.server.address().address, '127.0.0.1');
  url = `ws://127.0.0.1:${bridge.server.address().port}`;
});
after(async () => { await bridge?.close(); receiver?.close(); });
function connect({ origin = 'https://hexatone.plainsound.org', secret = token, suffix = '' } = {}) {
  return new WebSocket(url + suffix, ['hexatone-osc', `hexatone-token.${secret}`], { origin });
}
async function open(options) { const ws = connect(options); await once(ws, 'open'); return ws; }
test('rejects unauthorized upgrades before accepting any OSC', async () => {
  for (const options of [{ origin: 'https://untrusted.invalid' }, { secret: 'b'.repeat(64) }, { suffix: '?token=ignored' }]) {
    const ws = connect(options);
    const [error] = await once(ws, 'error');
    assert.match(error.message, /403/);
  }
});
test('forwards authenticated OSC to the allowed loopback destination', async () => {
  const ws = await open();
  const received = once(receiver, 'message');
  ws.send(JSON.stringify({ port, address: '/n_set', args: [{ type: 'i', value: 100 }, 'gate', 0] }));
  const [packet] = await received;
  assert.deepEqual(decodeOscMessage(packet), { address: '/n_set', args: [100, 'gate', 0] });
  ws.close(); await once(ws, 'close');
});
test('invalid JSON structures close only their connection and leave the bridge usable', async () => {
  for (const data of ['null', '{"address":{},"args":[]}', '{', JSON.stringify({ port, address: '/quit', args: [] })]) {
    const ws = await open(); const closed = once(ws, 'close'); ws.send(data);
    const [code] = await closed; assert.equal(code, 1008);
  }
  const ws = await open(); ws.close(); await once(ws, 'close');
});
test('oversized messages are bounded by the WebSocket parser', async () => {
  const ws = await open(); const closed = once(ws, 'close');
  ws.send('x'.repeat(128 * 1024 + 1));
  const [code] = await closed; assert.equal(code, 1009);
  const next = await open(); next.close(); await once(next, 'close');
});
