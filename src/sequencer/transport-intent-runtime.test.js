import { describe, expect, it } from "vitest";
import {
  buildCommittedSequencePlaybackState,
  buildStoppedSequenceTransportState,
  buildTimedPlaybackUiResetState,
  resolvePendingCueTransportState,
  resolvePendingSnapshotTransportState,
  resolveWorkspaceMutationTransportState,
} from "./transport-intent-runtime.js";

describe("transport intent runtime", () => {
  it("builds stopped transport state with stable defaults", () => {
    expect(buildStoppedSequenceTransportState()).toEqual({
      playingSnapshotId: null,
      selectedSnapshotId: null,
      selectedSnapshotMarker: null,
      playhead: {
        barIndex: 0,
        stepIndex: -1,
        markerIndex: null,
        stopped: true,
      },
    });
  });

  it("arms an inserted or surviving snapshot at a workspace mutation point", () => {
    expect(
      resolveWorkspaceMutationTransportState({
        focus: {
          kind: "snapshot",
          snapshotIndex: 2,
          snapshotId: 30,
        },
        snapshots: [{ id: 10 }, { id: 20 }, { id: 30 }],
        bars: [{ position: 1 }, { position: 3 }],
      }),
    ).toEqual({
      pendingTransportSelection: {
        snapshotIndex: 2,
        cueIndex: null,
      },
      timedPlaybackUi: {
        clockSeconds: -Infinity,
        stepIndex: 2,
        markerIndex: null,
        barIndex: 1,
      },
      playingSnapshotId: null,
      selectedSnapshotId: 30,
      selectedSnapshotMarker: null,
      playhead: {
        barIndex: 1,
        stepIndex: 2,
        markerIndex: null,
        stopped: true,
      },
    });
  });

  it("shows sequence end when a deletion leaves nothing at its boundary", () => {
    expect(
      resolveWorkspaceMutationTransportState({
        focus: {
          kind: "end",
          snapshotIndex: 2,
        },
        snapshots: [{ id: 10 }, { id: 20 }],
      }),
    ).toEqual({
      pendingTransportSelection: {
        snapshotIndex: null,
        cueIndex: null,
      },
      timedPlaybackUi: {
        clockSeconds: -Infinity,
        stepIndex: 2,
        markerIndex: null,
        barIndex: 0,
      },
      playingSnapshotId: null,
      selectedSnapshotId: null,
      selectedSnapshotMarker: null,
      playhead: {
        barIndex: 0,
        stepIndex: 2,
        markerIndex: null,
        stopped: true,
      },
    });
  });

  it("builds timed playback reset state", () => {
    expect(
      buildTimedPlaybackUiResetState({
        barIndex: 3,
        stepIndex: 7,
        markerIndex: 9,
      }),
    ).toEqual({
      clockSeconds: -Infinity,
      stepIndex: 7,
      markerIndex: 9,
      barIndex: 3,
    });
  });

  it("builds committed playback state and clears pending intent", () => {
    expect(
      buildCommittedSequencePlaybackState({
        safeStepIndex: 2,
        safeMarkerIndex: 4,
        snapshot: { id: "s3" },
        cueGroup: { snapshotIndex: 2, time: 3.5 },
        normalizedNotes: [{ id: "n1" }],
        barIndex: 1,
        snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
      }),
    ).toEqual({
      pendingTransportSelection: {
        snapshotIndex: null,
        cueIndex: null,
      },
      playingSnapshotId: "s3",
      selectedSnapshotId: "s3",
      selectedSnapshotMarker: {
        snapshotId: "s3",
        time: 0.5,
      },
      playhead: {
        barIndex: 1,
        stepIndex: 2,
        markerIndex: 4,
        stopped: false,
      },
    });
  });

  it("keeps an empty snapshot as the current stopped transport position", () => {
    expect(
      buildCommittedSequencePlaybackState({
        safeStepIndex: 19,
        safeMarkerIndex: null,
        snapshot: { id: "empty-s20" },
        cueGroup: null,
        normalizedNotes: [],
        barIndex: 4,
        snapshots: [],
      }),
    ).toEqual({
      pendingTransportSelection: {
        snapshotIndex: null,
        cueIndex: null,
      },
      playingSnapshotId: null,
      selectedSnapshotId: "empty-s20",
      selectedSnapshotMarker: null,
      playhead: {
        barIndex: 4,
        stepIndex: 19,
        markerIndex: null,
        stopped: true,
      },
    });
  });

  it("resolves pending snapshot transport selection", () => {
    expect(
      resolvePendingSnapshotTransportState({
        targetIndex: 1,
        snapshots: [{ id: "s1" }, { id: "s2" }],
        sequenceCueGroups: [{ snapshotIndex: 0 }, { snapshotIndex: 1 }],
        barIndexForTime: () => 5,
      }),
    ).toEqual({
      pendingTransportSelection: {
        snapshotIndex: 1,
        cueIndex: 1,
      },
      playingSnapshotId: null,
      selectedSnapshotId: "s2",
      selectedSnapshotMarker: null,
      playhead: {
        barIndex: 5,
        stepIndex: 1,
        markerIndex: null,
        stopped: true,
      },
    });
  });

  it("resolves pending cue transport to the earliest expanded sounding snapshot", () => {
    expect(
      resolvePendingCueTransportState({
        targetCueIndex: 1,
        sequenceCueGroups: [
          { snapshotIndex: 0, time: 1 },
          { snapshotIndex: 2, time: 13.5 },
        ],
        sequenceEvents: [{ type: "note", cueIndex: 13, snapshotId: "s3", eventId: "e1" }],
        snapshots: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }],
        previewExpandedIds: new Set(["s1", "s3"]),
        barIndexForTime: () => 8,
      }),
    ).toEqual({
      pendingTransportSelection: {
        snapshotIndex: 0,
        cueIndex: 1,
      },
      playingSnapshotId: null,
      selectedSnapshotId: "s1",
      selectedSnapshotMarker: {
        snapshotId: "s1",
        time: 12.5,
      },
      playhead: {
        barIndex: 8,
        stepIndex: 0,
        markerIndex: 1,
        stopped: true,
      },
    });
  });
});
