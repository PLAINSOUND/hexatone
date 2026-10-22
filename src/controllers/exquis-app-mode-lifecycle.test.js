import { afterEach, expect, it, vi } from "vitest";
import { createExquisModeGate } from "../input/exquis-mode-gate.js";
import { createExquisAppModeLifecycle } from "./exquis-app-mode-lifecycle.js";

afterEach(() => vi.useRealTimers());
const press = gate => gate.message({ data: [0x90, 60, 100] });
const release = gate => gate.message({ data: [0x80, 60, 0] });

it("gates lifecycle-level entry and exit without any UI settings dispatcher", async () => {
  vi.useFakeTimers();
  const gate = createExquisModeGate(), exit = vi.fn();
  const create = vi.fn(() => ({ exit }));
  const loadDriver = vi.fn(async () => ({ module: true }));
  const lifecycle = createExquisAppModeLifecycle({ gate, loadDriver, onDriverChange: vi.fn() });
  press(gate);
  lifecycle.request(create);
  await vi.advanceTimersByTimeAsync(500);
  expect(loadDriver).not.toHaveBeenCalled();
  release(gate);
  await vi.advanceTimersByTimeAsync(119);
  expect(create).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(create).toHaveBeenCalledWith({ module: true }, []);
  press(gate);
  lifecycle.request(null); // e.g. restored settings, not a checkbox callback
  expect(exit).not.toHaveBeenCalled();
  release(gate);
  await vi.advanceTimersByTimeAsync(119);
  expect(exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(exit).toHaveBeenCalledOnce();
  lifecycle.dispose();
});

it("rechecks physical state after lazy loading, then supersedes obsolete requests", async () => {
  vi.useFakeTimers();
  let resolve;
  const loading = new Promise(done => { resolve = done; });
  const gate = createExquisModeGate(), create = vi.fn(() => ({ exit: vi.fn() }));
  const lifecycle = createExquisAppModeLifecycle({ gate, loadDriver: () => loading, onDriverChange: vi.fn() });
  lifecycle.request(create);
  await vi.advanceTimersByTimeAsync(0);
  press(gate);
  resolve({});
  await vi.advanceTimersByTimeAsync(0);
  expect(create).not.toHaveBeenCalled();
  lifecycle.request(null);
  release(gate);
  await vi.advanceTimersByTimeAsync(120);
  expect(create).not.toHaveBeenCalled();
  lifecycle.request(create);
  await vi.advanceTimersByTimeAsync(0);
  expect(create).toHaveBeenCalledOnce();
  lifecycle.dispose();
});

it("cancels delayed entry on disposal and never revives a driver after unmount", async () => {
  vi.useFakeTimers();
  let resolve;
  const gate = createExquisModeGate(), create = vi.fn();
  const lifecycle = createExquisAppModeLifecycle({ gate,
    loadDriver: () => new Promise(done => { resolve = done; }), onDriverChange: vi.fn() });
  lifecycle.request(create);
  await vi.advanceTimersByTimeAsync(0);
  lifecycle.dispose();
  resolve({});
  await vi.runAllTimersAsync();
  expect(create).not.toHaveBeenCalled();
});
