import { describe, expect, it } from "vitest";
import {
  createSequencerCrashDiagnostics,
  pushSequencerCrashDiagnostic,
} from "./sequencer-crash-diagnostics.js";

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
});
