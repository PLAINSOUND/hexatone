/** Bridge trust boundary: validate before encoding or forwarding any UDP. */
const { timingSafeEqual } = require('node:crypto');
const PROTOCOL = 'hexatone-osc';
const MAX_PAYLOAD = 128 * 1024;
const DEFAULT_ORIGINS = ['https://hexatone.plainsound.org', 'https://plainsound.github.io'];
const COMMANDS = new Set(['/s_new', '/n_set', '/n_free', '/g_new', '/g_freeAll', '/status', '/hex/jitter']);
const loopback = hostname => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

function authorize(req, token, origins = DEFAULT_ORIGINS) {
  try {
    const host = new URL(`http://${req.headers.host}`);
    const origin = new URL(req.headers.origin);
    if (req.method !== 'GET' || !loopback(host.hostname) ||
        origin.origin !== req.headers.origin ||
        !(origins.includes(origin.origin) ||
          (['http:', 'https:'].includes(origin.protocol) && loopback(origin.hostname)))) return false;
    const protocols = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
    if (!protocols.includes(PROTOCOL)) return false;
    const supplied = protocols.filter(s => s.startsWith('hexatone-token.'));
    if (supplied.length !== 1) return false;
    const expected = Buffer.from(`hexatone-token.${token}`);
    const actual = Buffer.from(supplied[0]);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

function validateMessage(msg, ports) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('Expected a message object');
  const port = msg.port ?? 57100;
  if (!Number.isInteger(port) || !ports.has(port)) throw new Error('Destination port is not allowed');
  if (msg.diagnostic != null) {
    if (!['start', 'sample', 'stop'].includes(msg.diagnostic)) throw new Error('Unknown diagnostic command');
    return msg;
  }
  const messages = msg.messages == null ? [msg] : msg.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > 256) throw new Error('Invalid bundle size');
  if (msg.messages != null && (!Number.isFinite(msg.timetagUnixMs) ||
      msg.timetagUnixMs < 0 || msg.timetagUnixMs > Date.now() + 24 * 60 * 60 * 1000))
    throw new Error('Invalid bundle time');
  for (const message of messages) {
    if (!message || !COMMANDS.has(message.address) || !Array.isArray(message.args) || message.args.length > 2048)
      throw new Error('Invalid OSC command');
    // Jitter instrumentation has one fixed destination; do not hide it in bundles.
    if (message.address === '/hex/jitter' && msg.messages != null) throw new Error('Jitter cannot be bundled');
    for (const arg of message.args) {
      const typed = arg != null && typeof arg === 'object';
      if (typed && (!['i', 'f', 's'].includes(arg.type) || !Object.hasOwn(arg, 'value')))
        throw new Error('Invalid OSC argument type');
      const value = typed ? arg.value : arg;
      if (typeof value === 'string') {
        if ((typed && arg.type !== 's') || value.includes('\0') || Buffer.byteLength(value) > 4096)
          throw new Error('Invalid OSC string');
      } else if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38 ||
          (typed && arg.type === 's') || (typed && arg.type === 'i' &&
            (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)))
        throw new Error('Invalid OSC number');
    }
  }
  return msg;
}
module.exports = { PROTOCOL, MAX_PAYLOAD, DEFAULT_ORIGINS, authorize, validateMessage };
