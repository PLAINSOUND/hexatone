// Fixed defaults until controller bindings are exposed in the Keybindings tab.
export const EXQUIS_BEND_BYPASS_CC = 32;

export function exquisBendBypassControl(cc, value) {
  return cc === EXQUIS_BEND_BYPASS_CC ? value >= 64 : null;
}
