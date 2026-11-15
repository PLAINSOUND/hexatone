import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: { state: "running", currentTime: 1, sampleRate: 48000,
  audioWorklet: { addModule: vi.fn(async () => {}) } }, messages: [] }));
vi.mock("./dsf-processor.js?worker&url", () => ({ default: "processor.js" }));
vi.mock("../audio/shared-context.js", () => ({ ensureSharedAudioContext: () => mocks.context }));
vi.mock("../audio/recovery-gate.js", () => ({ createRecoveryGate: () => ({ node: {}, disconnect: vi.fn() }) }));
vi.mock("../audio/runtime-diagnostics.js", () => ({ recordTouchAudio: vi.fn() }));
import { createDsfSynth } from "./index.js";
beforeEach(() => {
  mocks.messages.length = 0;
  vi.stubGlobal("AudioWorkletNode", class {
    constructor() { this.port = { postMessage: data => mocks.messages.push(data), close() {} }; }
    connect() {} disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());
it("forwards high resolution pressure, timbre, foot and release velocity per voice", async () => {
  const synth = await createDsfSynth();
  const note = synth.makeHex(null, 0);
  note.pressure(64, 8128);
  note.cc74(32, 4064);
  note.noteOn();
  expect(mocks.messages.at(-1)).toMatchObject({ command: "start", pressure: 0.5, timbre: 0.25 });
  note.aftertouch(127);
  expect(mocks.messages.at(-1)).toMatchObject({ command: "expression", pressure: 1 });
  note.expression(127);
  expect(mocks.messages.at(-1)).toMatchObject({ command: "expression", timbre: 1 });
  note.noteOff(110);
  expect(mocks.messages.at(-1)).toMatchObject({ command: "stop", velocity: 110 });
  const count = mocks.messages.length;
  note.aftertouch(0);
  expect(mocks.messages).toHaveLength(count);
});
it("uses normalized snapshot expression and the existing 1..2 onset modulation convention", async () => {
  const synth = await createDsfSynth();
  synth.setMod(1.5);
  const note = synth.makeHex(null, 0);
  note.prepareNormalizedSnapshotPressure(0.75);
  note.noteOn();
  expect(mocks.messages.at(-1)).toMatchObject({ command: "start", pressure: 0.75, timbre: 0.5 });
  note.applyNormalizedSnapshotTimbre(0.8);
  expect(mocks.messages.at(-1)).toMatchObject({ command: "expression", timbre: 0.8 });
});
it("broadcasts wheel and foot timbre to held voices and remembers it for new notes", async () => {
  const synth = await createDsfSynth();
  const first = synth.makeHex(null, 0), second = synth.makeHex(null, 1200);
  first.noteOn(); second.noteOn();
  first.modwheel(127);
  expect(mocks.messages.slice(-2)).toEqual([
    expect.objectContaining({ command: "expression", id: 1, timbre: 1 }),
    expect.objectContaining({ command: "expression", id: 2, timbre: 1 }),
  ]);
  first.expression(0);
  expect(mocks.messages.slice(-2).every(event => event.timbre === 0)).toBe(true);
  first.modwheel(127);
  synth.makeHex(null, 2400).noteOn();
  expect(mocks.messages.at(-1)).toMatchObject({ command: "start", timbre: 1 });
});
