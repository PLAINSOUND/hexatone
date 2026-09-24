/** Runtime-only identity for native MIDI ports. Browser IDs describe devices,
 * not connection objects: reconnect/permission recovery can replace an object
 * without changing its ID. Weak keys do not retain disconnected ports and these
 * tokens must never be persisted as user settings.
 */
export function createOutputPortIdentity() {
  const identities = new WeakMap();
  let next = 0;
  return port => {
    if (!port) return null;
    if (!identities.has(port)) identities.set(port, ++next);
    return identities.get(port);
  };
}
