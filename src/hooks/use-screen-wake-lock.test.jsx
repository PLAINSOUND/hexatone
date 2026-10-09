import { render, act } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import useScreenWakeLock from "./use-screen-wake-lock.js";

afterEach(() => {
  localStorage.removeItem("hexatone_keep_screen_awake");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("persists enabled and disabled preferences across remounts independently of Restore on reload", () => {
  let enabled;
  let toggle;
  function Harness() { [enabled, toggle] = useScreenWakeLock(() => false); return null; }
  let view = render(<Harness />);
  expect(enabled).toBe(false);
  act(() => toggle(true));
  view.unmount();
  view = render(<Harness />);
  expect(enabled).toBe(true);
  act(() => toggle(false));
  view.unmount();
  view = render(<Harness />);
  expect(enabled).toBe(false);
  view.unmount();
});

it("keeps active playback awake, releases on stop, and reacquires after system release", async () => {
  vi.useFakeTimers();
  localStorage.setItem("hexatone_keep_screen_awake", "true");
  let playing = true;
  let systemRelease;
  const release = vi.fn(async () => {});
  const request = vi.fn(async () => ({ release, addEventListener: (_, cb) => { systemRelease = cb; } }));
  vi.stubGlobal("navigator", { wakeLock: { request } });
  function Harness() { useScreenWakeLock(() => playing); return null; }
  const view = render(<Harness />);
  await act(async () => {});
  expect(request).toHaveBeenCalledWith("screen");
  systemRelease();
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(request).toHaveBeenCalledTimes(2);
  playing = false;
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(release).toHaveBeenCalledOnce();
  view.unmount();
});

it("releases a late request after disabling the preference", async () => {
  localStorage.setItem("hexatone_keep_screen_awake", "true");
  let resolve;
  let toggle;
  const release = vi.fn(async () => {});
  const request = vi.fn(() => new Promise(done => { resolve = done; }));
  vi.stubGlobal("navigator", { wakeLock: { request } });
  function Harness() { [, toggle] = useScreenWakeLock(() => true); return null; }
  const view = render(<Harness />);
  await act(async () => {});
  act(() => toggle(false));
  await act(async () => { resolve({ release }); });
  expect(release).toHaveBeenCalledOnce();
  expect(localStorage.getItem("hexatone_keep_screen_awake")).toBe("false");
  view.unmount();
});
