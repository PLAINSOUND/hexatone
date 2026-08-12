import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSequencerLifecycleStartContext,
  bufferSequencerCrashDiagnostics,
  createSequencerCrashDiagnostics,
  flushPersistedSequencerCrashDiagnostics,
  getActiveSequencerDiagnosticTransaction,
  loadPersistedSequencerCrashDiagnostics,
  pushSequencerCrashDiagnostic,
  readSequencerDiagnosticMemory,
  runWithSequencerDiagnosticTransaction,
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

  it("preserves transaction, lifecycle, and heap context", () => {
    const next = pushSequencerCrashDiagnostic(createSequencerCrashDiagnostics(), {
      type: "sequencer-post-commit-frame",
      context: {
        source: "sequencer",
        transactionId: "event-note-move:1",
        commitKind: "event-note-move",
        commitToFrameMs: 18.25,
        heapUsedBytes: 1234,
        previousCleanExit: false,
        wasDiscarded: false,
      },
    });

    expect(next.entries[0].context).toMatchObject({
      transactionId: "event-note-move:1",
      commitKind: "event-note-move",
      commitToFrameMs: 18.25,
      heapUsedBytes: 1234,
      previousCleanExit: false,
      wasDiscarded: false,
    });
  });

  it("describes an unclean previous lifecycle and available heap metrics", () => {
    const performanceObject = {
      now: () => 250,
      getEntriesByType: () => [{ type: "reload" }],
      memory: {
        usedJSHeapSize: 100,
        totalJSHeapSize: 200,
        jsHeapSizeLimit: 1000,
      },
    };
    const context = buildSequencerLifecycleStartContext({
      previousMarker: {
        pageId: "page:old",
        cleanExit: false,
        lastHeartbeatAt: 900,
        lastMemory: { heapUsedBytes: 800, heapTotalBytes: 900 },
        peakHeapUsedBytes: 850,
      },
      pageId: "page:new",
      now: 1000,
      performanceObject,
      documentObject: { wasDiscarded: false, visibilityState: "visible" },
    });

    expect(context).toMatchObject({
      pageId: "page:new",
      previousPageId: "page:old",
      previousLifecyclePresent: true,
      previousCleanExit: false,
      navigationType: "reload",
      wasDiscarded: false,
      uptimeMs: 250,
      timeSincePreviousHeartbeatMs: 100,
      previousHeartbeatHeapUsedBytes: 800,
      previousHeartbeatHeapTotalBytes: 900,
      previousPeakHeapUsedBytes: 850,
      heapUsedBytes: 100,
      heapTotalBytes: 200,
      heapLimitBytes: 1000,
    });
    expect(readSequencerDiagnosticMemory({})).toEqual({});
  });

  it("scopes transaction context to synchronous workspace callbacks", () => {
    const transaction = { transactionId: "event-note-move:1", commitKind: "event-note-move" };

    expect(getActiveSequencerDiagnosticTransaction()).toBeNull();
    runWithSequencerDiagnosticTransaction(transaction, () => {
      expect(getActiveSequencerDiagnosticTransaction()).toBe(transaction);
    });
    expect(getActiveSequencerDiagnosticTransaction()).toBeNull();
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
    let diagnostics = pushSequencerCrashDiagnostic(createSequencerCrashDiagnostics(10), {
      type: "sequencer-autoscroll-requested",
    });
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
