import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import useAudioRecovery, { needsInitialAudioStart } from "./use-audio-recovery.js";
import { setLatencyMeasurementEnabled } from "../audio/runtime-diagnostics.js";

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

afterEach(() => { cleanup(); setLatencyMeasurementEnabled(false); vi.useRealTimers(); });

it("offers activation for a remembered SoundFont before its engine joins", () => {
  const key = "fluidsynth_last_soundfont_source";
  localStorage.setItem(key, JSON.stringify({ name: "Organ.sf2", url: "" }));
  try {
    expect(needsInitialAudioStart(null, { output_fluidsynth: true })).toBe(true);
    expect(needsInitialAudioStart(null, { output_fluidsynth: false })).toBe(false);
  } finally { localStorage.removeItem(key); }
});

it("installs latency probes only while enabled and cleans them up", () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  try {
    harness();
    const baseline = vi.getTimerCount();
    expect(add.mock.calls.some(([type]) => type === "touchmove")).toBe(false);
    setLatencyMeasurementEnabled(true);
    expect(vi.getTimerCount()).toBe(baseline + 1);
    expect(add.mock.calls.some(([type]) => type === "touchmove")).toBe(true);
    setLatencyMeasurementEnabled(false);
    expect(vi.getTimerCount()).toBe(baseline);
    expect(remove.mock.calls.some(([type]) => type === "touchmove")).toBe(true);
    setLatencyMeasurementEnabled(true);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    setLatencyMeasurementEnabled(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally { add.mockRestore(); remove.mockRestore(); }
});

it("coalesces Retry taps during startup into one serialized fresh attempt", async () => {
  let finish;
  const initialise = Object.assign(vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ errors: [] }), { needed: () => true });
  const synthRef = { current: null };
  const initialiseRef = { current: initialise };
  const keysRef = { current: null };
  let recovery;
  function Harness() {
    recovery = useAudioRecovery(synthRef, keysRef, {}, initialiseRef);
    return <span data-testid="status">{recovery.status}</span>;
  }
  render(<Harness />);
  let first;
  await act(async () => { first = recovery.restore(); });
  await act(async () => { await recovery.restore(); await recovery.restore(); });
  expect(initialise).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("status").textContent).toContain("Retry requested");
  await act(async () => { finish({ errors: [] }); await first; });
  expect(initialise).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId("status").textContent).toContain("Audio engines restored");
});

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

it("cycles loaded audio without invoking startup, preparation or rebuild callbacks", async () => {
  vi.useFakeTimers();
  const context = { state: "running", get currentTime() { return Date.now() / 1000; },
    suspend: vi.fn(async () => {}), resume: vi.fn(async () => {}) };
  const synth = { audioBackend: "fluidsynth", usesSharedAudioContext: true,
    getAudioContext: () => context, ensureAwake: vi.fn(), forceAudioRebuild: vi.fn(),
    clearRecoveryEvents: vi.fn(async () => {}), muteForRecovery: vi.fn(), fadeAfterRecovery: vi.fn() };
  const synthRef = { current: synth };
  const keysRef = { current: { releaseActiveBrowserNotes: vi.fn(), rejoinRecoveredAudio: vi.fn() } };
  const initialise = Object.assign(vi.fn(), { needed: () => true });
  const initialiseRef = { current: initialise };
  let recovery;
  function Harness() {
    recovery = useAudioRecovery(synthRef, keysRef, {}, initialiseRef);
    return <span data-testid="cycle-status">{recovery.status}</span>;
  }
  render(<Harness />);
  let work;
  act(() => { work = recovery.cycleContexts(); });
  expect(context.suspend).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); await work; });
  expect(context.resume).toHaveBeenCalledOnce();
  expect(initialise).not.toHaveBeenCalled();
  expect(synth.ensureAwake).not.toHaveBeenCalled();
  expect(synth.forceAudioRebuild).not.toHaveBeenCalled();
  expect(keysRef.current.releaseActiveBrowserNotes).toHaveBeenCalledOnce();
  expect(keysRef.current.rejoinRecoveredAudio).toHaveBeenCalledWith(["fluidsynth"]);
  expect(screen.getByTestId("cycle-status").textContent).toContain("restored by suspend/resume");
});

it.each([false, true])("only preemptively mutes mobile audio when hidden (mobile=$mobile)", async (mobile) => {
  const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(mobile ? "iPhone" : "Windows NT");
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const mute = vi.fn();
  const context = { state: "running", currentTime: 1 };
  const synth = { audioBackend: "supersonic", getAudioContext: () => context,
    getDiagnostics: () => ({ audioContext: context }), muteForRecovery: mute, allSoundOff: vi.fn() };
  function Harness() {
    const recovery = useAudioRecovery({ current: synth }, { current: null }, {});
    return <span data-testid="status">{recovery.status}</span>;
  }
  try {
    render(<Harness />);
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(mute).toHaveBeenCalledTimes(mobile ? 1 : 0);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    if (!mobile) {
      expect(screen.getByTestId("status").textContent).toBe("");
      hidden.mockReturnValue(true);
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      context.state = "suspended";
      hidden.mockReturnValue(false);
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(screen.getByTestId("status").textContent).toContain("Audio paused while away");
    }
  } finally { cleanup(); ua.mockRestore(); hidden.mockRestore(); }
});

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
  expect(screen.getByTestId("status").textContent).toContain("needs attention");
});
it("checks installed engines for interruption while another engine loads", async () => {
  const test = harness();
  test.lifecycle.current.loading = true;
  test.audio().state = "interrupted";
  await test.tick();
  expect(screen.getByTestId("status").textContent).toContain("needs attention");
  test.lifecycle.current.loading = false;
  await test.tick();
  expect(screen.getByTestId("status").textContent).toContain("needs attention");
});

it("restarts only FluidSynth on its existing context without startup or context cycling", async () => {
  const context = { state: "running", currentTime: 1, suspend: vi.fn(), resume: vi.fn() };
  const synth = { audioBackend: "fluidsynth", getAudioContext: () => context,
    forceAudioRebuild: vi.fn(async () => true), clearRecoveryEvents: vi.fn(async () => {}),
    fadeAfterRecovery: vi.fn(), muteForRecovery: vi.fn(), allSoundOff: vi.fn() };
  const other = { audioBackend: "supersonic", forceAudioRebuild: vi.fn() };
  const keys = { releaseActiveBrowserNotes: vi.fn(), rejoinRecoveredAudio: vi.fn() };
  const initialise = vi.fn();
  let recovery;
  const synthRef = { current: { childSynths: () => [synth, other] } };
  function Harness() {
    recovery = useAudioRecovery(synthRef, { current: keys }, {}, { current: initialise });
    return null;
  }
  render(<Harness />);
  await act(async () => { await recovery.restartFluidSynthWorklet(); });
  expect(synth.forceAudioRebuild).toHaveBeenCalledWith({ sharedContext: context });
  expect(context.suspend).not.toHaveBeenCalled();
  expect(context.resume).not.toHaveBeenCalled();
  expect(other.forceAudioRebuild).not.toHaveBeenCalled();
  expect(initialise).not.toHaveBeenCalled();
  expect(keys.releaseActiveBrowserNotes).toHaveBeenCalledOnce();
  expect(keys.rejoinRecoveredAudio).toHaveBeenCalledWith(["fluidsynth"]);
  expect(synth.clearRecoveryEvents).toHaveBeenCalledOnce();
  expect(synth.fadeAfterRecovery).toHaveBeenCalledOnce();
  synth.forceAudioRebuild.mockRejectedValueOnce(new Error("Restart failed"));
  await act(async () => { await expect(recovery.restartFluidSynthWorklet()).rejects.toThrow("Restart failed"); });
  expect(synth.forceAudioRebuild).toHaveBeenCalledTimes(2);
  expect(context.resume).not.toHaveBeenCalled();
});
