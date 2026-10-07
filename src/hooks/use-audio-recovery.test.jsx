import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import useAudioRecovery from "./use-audio-recovery.js";

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
