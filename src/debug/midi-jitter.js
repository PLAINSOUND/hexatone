import { debugEnabled } from "./logging.js";

const INPUT_PREFIX = "[midijitter:in]";
const OUTPUT_PREFIX = "[midijitter:out]";

let nextSeq = 1;
let currentInputContext = null;
const lastInputAtByKind = new Map();
const lastOutputAtByKind = new Map();

function formatDelta(delta) {
  return Number.isFinite(delta) ? `${delta.toFixed(3)}ms` : "n/a";
}

function readDetail(details, key) {
  const value = details?.[key];
  return value == null ? "-" : String(value);
}

export function midiJitterEnabled() {
  return debugEnabled("midijitter");
}

export function withMidiJitterInput(kind, details, fn) {
  if (!midiJitterEnabled()) return fn();
  const now = performance.now();
  const lastAt = lastInputAtByKind.get(kind);
  const seq = nextSeq++;
  const context = {
    seq,
    kind,
    at: now,
    details: details ?? {},
  };
  lastInputAtByKind.set(kind, now);
  // eslint-disable-next-line no-console
  console.log(
    `${INPUT_PREFIX} seq=${seq} kind=${kind} channel=${readDetail(details, "channel")} note=${readDetail(details, "note")} cc=${readDetail(details, "cc")} value=${readDetail(details, "value")} browserΔ=${formatDelta(lastAt == null ? NaN : now - lastAt)}`,
  );
  const previous = currentInputContext;
  currentInputContext = context;
  try {
    return fn();
  } finally {
    currentInputContext = previous;
  }
}

export function traceMidiOutput(kind, details = {}) {
  if (!midiJitterEnabled()) return;
  const now = performance.now();
  const lastAt = lastOutputAtByKind.get(kind);
  lastOutputAtByKind.set(kind, now);
  const source = currentInputContext;
  const inputDelta = source ? now - source.at : NaN;
  // eslint-disable-next-line no-console
  console.log(
    `${OUTPUT_PREFIX} kind=${kind} family=${readDetail(details, "family")} channel=${readDetail(details, "channel")} note=${readDetail(details, "note")} carrier=${readDetail(details, "carrier")} value=${readDetail(details, "value")} sourceSeq=${source?.seq ?? "-"} sourceKind=${source?.kind ?? "-"} inputΔ=${formatDelta(inputDelta)} outputΔ=${formatDelta(lastAt == null ? NaN : now - lastAt)}`,
  );
}

