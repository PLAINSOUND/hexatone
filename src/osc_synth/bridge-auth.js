/** Session-only pairing secrets: excluded from settings, presets and URLs. */
const listeners = new Set();
const keyFor = url => {
  const parsed = new URL(url);
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error('Use a WebSocket bridge URL without credentials or query parameters');
  if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1';
  return `hexatone_bridge_token:${parsed.origin}`;
};
export function getBridgeToken(url) {
  try { return sessionStorage.getItem(keyFor(url)) || ''; } catch { return ''; }
}
export function setBridgeToken(url, value) {
  const key = keyFor(url);
  const token = value.trim();
  if (token && !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('Paste the pairing token printed by osc-bridge');
  if ((sessionStorage.getItem(key) || "") === token) return;
  if (token) sessionStorage.setItem(key, token);
  else sessionStorage.removeItem(key);
  for (const listener of listeners) listener(key);
}
export function bridgeProtocols(url) {
  const token = getBridgeToken(url);
  return token ? ['hexatone-osc', `hexatone-token.${token}`] : ['hexatone-osc'];
}
export function subscribeBridgeToken(url, listener) {
  const key = keyFor(url);
  const onChange = changed => { if (changed === key) listener(); };
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
