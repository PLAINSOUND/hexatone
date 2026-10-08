import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import useAudioRecovery, { needsInitialAudioStart } from "./use-audio-recovery.js";

it("checks enabled engine readiness rather than whether a gesture occurred", () => {
  const settings = { output_sample: true, output_osc: true, osc_local: true, output_fluidsynth: true };
  const sample = { family: "sample", getAudioContext: () => ({ state: "running" }) };
  const sonic = { audioBackend: "supersonic", getAudioContext: () => ({ state: "suspended" }) };
  const synth = { childSynths: () => [sample, sonic] };
  expect(needsInitialAudioStart(synth, settings)).toBe(true);
  sonic.getAudioContext = () => ({ state: "running" });
  expect(needsInitialAudioStart(synth, settings)).toBe(false);
  expect(needsInitialAudioStart(null, { output_fluidsynth: true })).toBe(false);
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

function harness() {
  vi.useFakeTimers();
  let audio = { state: "suspended", currentTime: 0 };
  const lifecycle = { current: { loading: false } };
  const synth = { audioBackend: "supersonic", getAudioContext: () => audio,
    getDiagnostics: () => ({ audioContext: { ...audio } }) };
  const synthRef = { current: synth };
  const keysRef = { current: null };
  const initialiseRef = { current: Object.assign(() => {}, { needed: () => false }) };
  function Harness() {
    const recovery = useAudioRecovery(synthRef, keysRef, {}, initialiseRef, lifecycle);
    return <span data-testid="status">{recovery.status}</span>;
  }
  render(<Harness />);
  return { lifecycle, audio: () => audio, replace: (next) => { audio = next; },
    tick: () => act(async () => { await vi.advanceTimersByTimeAsync(2000); }) };
}

it("prepares first startup without rebuilding the freshly initialised engines", async () => {
  const rebuild = vi.fn();
  const initialise = Object.assign(vi.fn(async () => ({ errors: [] })), { needed: () => true });
  const synthRef = { current: { audioBackend: "supersonic", forceAudioRebuild: rebuild } };
  let recovery;
  function Harness() {
    recovery = useAudioRecovery(synthRef, { current: null }, {}, { current: initialise });
    return <span data-testid="status">{recovery.status}</span>;
  }
  render(<Harness />);
  await act(async () => { await recovery.restore(); });
  expect(initialise).toHaveBeenCalledOnce();
  expect(rebuild).not.toHaveBeenCalled();
  expect(screen.getByTestId("status").textContent).toContain("Audio engines restored");
});

it("does not report a normally suspended initial engine as interrupted", async () => {
  const test = harness();
  await test.tick();
  await test.tick();
  expect(screen.getByTestId("status").textContent).toBe("");
});
it("does not compare a new engine clock with the previous engine", async () => {
  const test = harness();
  test.audio().state = "running";
  test.audio().currentTime = 1;
  await test.tick();
  test.replace({ state: "running", currentTime: 1 });
  await test.tick();
  expect(screen.getByTestId("status").textContent).toBe("");
  await test.tick();
  expect(screen.getByTestId("status").textContent).toContain("Restore Audio");
});
it("suppresses checks while engines load, then reports an actual interruption", async () => {
  const test = harness();
  test.lifecycle.current.loading = true;
  test.audio().state = "interrupted";
  await test.tick();
  expect(screen.getByTestId("status").textContent).toBe("");
  test.lifecycle.current.loading = false;
  await test.tick();
  expect(screen.getByTestId("status").textContent).toContain("Restore Audio");
});
