import { afterEach, beforeEach, expect, it, vi } from "vitest";

let audio;
let Context;

beforeEach(async () => {
  vi.resetModules();

  Context = vi.fn(function () {
    this.state = "running";
  });

  vi.stubGlobal("window", { AudioContext: Context });

  audio = await import("./shared-context.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("creates one context and reuses it", () => {
  expect(audio.peekSharedAudioContext()).toBeNull();

  const context = audio.ensureSharedAudioContext();

  expect(audio.ensureSharedAudioContext()).toBe(context);
  expect(audio.sharedAudioContext).toBe(context);
  expect(Context).toHaveBeenCalledExactlyOnceWith({
    latencyHint: "interactive",
  });
});

it("replaces a closed context", () => {
  const previous = audio.ensureSharedAudioContext();
  previous.state = "closed";

  const replacement = audio.ensureSharedAudioContext();

  expect(replacement).not.toBe(previous);
  expect(Context).toHaveBeenCalledTimes(2);
});

it("discards the current context", () => {
  const previous = audio.ensureSharedAudioContext();

  expect(audio.discardSharedAudioContext(previous)).toBe(true);
  expect(audio.peekSharedAudioContext()).toBeNull();
  expect(audio.ensureSharedAudioContext()).not.toBe(previous);
});

it("does not let a stale caller discard a replacement", () => {
  const previous = audio.ensureSharedAudioContext();
  audio.discardSharedAudioContext(previous);

  const replacement = audio.ensureSharedAudioContext();

  expect(audio.discardSharedAudioContext(previous)).toBe(false);
  expect(audio.peekSharedAudioContext()).toBe(replacement);
});