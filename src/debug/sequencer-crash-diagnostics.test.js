import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bufferSequencerCrashDiagnostics,
  createSequencerCrashDiagnostics,
  flushPersistedSequencerCrashDiagnostics,
  loadPersistedSequencerCrashDiagnostics,
  pushSequencerCrashDiagnostic,
} from "./sequencer-crash-diagnostics.js";

afterEach(() => {
  flushPersistedSequencerCrashDiagnostics();
  vi.useRealTimers();
});

describe("sequencer crash diagnostics", () => {
  it("preserves stable note ids in persisted context", () => {
    const next = pushSequencerCrashDiagnostic(createSequencerCrashDiagnostics(), {
      type: "event-bar-relative-commit",
      context: {
        source: "sequencer",
        snapshotId: "99",
        noteId: "__seq__:69:0:1",
        resolvedNoteId: "__seq__:69:0:1",
        noteKey: "__seq__:69:0:1",
        kind: "release",
        draftKey: "99:99:__seq__:69:0:1:release",
      },
    });

    expect(next.lastContext).toMatchObject({
      noteId: "__seq__:69:0:1",
      resolvedNoteId: "__seq__:69:0:1",
      noteKey: "__seq__:69:0:1",
    });
    expect(next.entries[0].context).toMatchObject({
      noteId: "__seq__:69:0:1",
      resolvedNoteId: "__seq__:69:0:1",
    });
  });

  it("omits empty context fields from persisted entries", () => {
    const next = pushSequencerCrashDiagnostic(createSequencerCrashDiagnostics(), {
      type: "sequencer-autoscroll-requested",
      context: {
        source: "sequencer",
        scrollTop: 120,
        targetTop: 240,
        autoScrollEnabled: true,
      },
    });

    expect(next.entries[0].context).toEqual({
      source: "sequencer",
      scrollTop: 120,
      targetTop: 240,
      autoScrollEnabled: true,
    });
  });

  it("batches crash-context persistence and writes only the latest state", () => {
    vi.useFakeTimers();
    const storage = {
      values: new Map(),
      writes: 0,
      getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
      },
      setItem(key, value) {
        this.writes += 1;
        this.values.set(key, value);
      },
    };
    let diagnostics = pushSequencerCrashDiagnostic(
      createSequencerCrashDiagnostics(10),
      { type: "sequencer-autoscroll-requested" },
    );
    bufferSequencerCrashDiagnostics(diagnostics, storage);
    diagnostics = pushSequencerCrashDiagnostic(diagnostics, {
      type: "sequencer-autoscroll-applied",
    });
    bufferSequencerCrashDiagnostics(diagnostics, storage);

    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1999);
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.writes).toBe(1);
    expect(loadPersistedSequencerCrashDiagnostics(storage)?.state).toEqual(diagnostics);
  });
});
