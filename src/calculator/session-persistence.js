export const CALCULATOR_WORKSPACE_STORAGE_KEY = "hexatone_calculator_workspace";

export function loadCalculatorWorkspace(workspaceKey, storage = globalThis.sessionStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(CALCULATOR_WORKSPACE_STORAGE_KEY) || "null");
    if (!parsed || parsed.version !== 1) return null;
    const state = parsed.workspaces?.[workspaceKey];
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}

export function saveCalculatorWorkspace(workspaceKey, state, storage = globalThis.sessionStorage) {
  if (!workspaceKey || !state || typeof state !== "object") return;
  try {
    const current = JSON.parse(storage?.getItem(CALCULATOR_WORKSPACE_STORAGE_KEY) || "null");
    const workspaces =
      current?.version === 1 && current.workspaces && typeof current.workspaces === "object"
        ? current.workspaces
        : {};
    storage?.setItem(
      CALCULATOR_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        workspaces: {
          ...workspaces,
          [workspaceKey]: state,
        },
      }),
    );
  } catch {
    // An unavailable/full session store must not interrupt calculation.
  }
}
