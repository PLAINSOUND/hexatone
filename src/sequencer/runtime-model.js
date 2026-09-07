// This module centralizes the derived sequencer runtime model.
// App and Sequencer can both consume the same normalized bars/tempi, event
// list, cue groups, repeat sections, playback timeline, and timed triggers so
// structural edits do not fan out into duplicate rebuild trees.

import {
  appendPersistedSequenceRuntimeDiagnostic,
  isSequenceRuntimeDiagnosticsEnabled,
  measureSequenceRuntimeStep,
} from "../debug/sequence-runtime-diagnostics.js";
import { buildPlaybackTimeline } from "./playback-timeline.js";
import { deriveRepeatSections } from "./repeat-playback-runtime.js";
import { deriveTimedCueTriggers } from "./timed-cue-triggers.js";
import {
  normalizeBarMarkers,
  normalizeTempoMarkers,
  deriveTempoTransitionCueMap,
  deriveTerminalBarlinePosition,
} from "./transport.js";
import {
  deriveSequenceCueGroupsFromEvents,
  deriveSequenceEvents,
  deriveSequenceNotesByCueGroups,
} from "./trigger-groups.js";
import { normalizeSequenceLegatoMode } from "./legato.js";

let nextRuntimeInstanceId = 1;

export function buildSequenceRuntimeModel(
  {
    snapshots = [],
    displaySnapshots = null,
    playbackSnapshots = null,
    bars = [],
    tempi = [],
    repeats = [],
    playbackRepeats = null,
    sequenceLegato = "per-note",
    source = "runtime",
  } = {},
  { playbackModel = null } = {},
) {
  const buildStartMs = performance.now();
  const runtimeInstanceId = nextRuntimeInstanceId;
  nextRuntimeInstanceId += 1;
  const renderedSnapshots = Array.isArray(displaySnapshots) ? displaySnapshots : snapshots;
  const playbackRenderedSnapshots = Array.isArray(playbackSnapshots)
    ? playbackSnapshots
    : renderedSnapshots;
  const entryMeta = {
    source,
    snapshotCount: renderedSnapshots.length,
    playbackSnapshotCount: playbackRenderedSnapshots.length,
    barCount: Array.isArray(bars) ? bars.length : 0,
    tempoCount: Array.isArray(tempi) ? tempi.length : 0,
    repeatCount: Array.isArray(repeats) ? repeats.length : 0,
  };
  const effectivePlaybackRepeats = Array.isArray(playbackRepeats) ? playbackRepeats : repeats;
  const sequenceLegatoMode = normalizeSequenceLegatoMode(sequenceLegato);

  const sortedBars =
    playbackModel?.sortedBars ??
    measureSequenceRuntimeStep("normalize-bars", () => normalizeBarMarkers(bars), entryMeta);
  const sortedTempi =
    playbackModel?.sortedTempi ??
    measureSequenceRuntimeStep(
      "normalize-tempi",
      () => (Array.isArray(tempi) ? normalizeTempoMarkers(tempi) : []),
      entryMeta,
    );
  const sequenceEvents = measureSequenceRuntimeStep(
    "derive-sequence-events",
    () =>
      deriveSequenceEvents(renderedSnapshots, sortedBars, sortedTempi, repeats, {
        legatoMode: sequenceLegatoMode,
      }),
    entryMeta,
  );
  const playbackSequenceEvents =
    playbackModel?.playbackSequenceEvents ??
    measureSequenceRuntimeStep(
      "derive-playback-sequence-events",
      () =>
        playbackRenderedSnapshots === renderedSnapshots && effectivePlaybackRepeats === repeats
          ? sequenceEvents
          : deriveSequenceEvents(
              playbackRenderedSnapshots,
              sortedBars,
              sortedTempi,
              effectivePlaybackRepeats,
              { legatoMode: sequenceLegatoMode },
            ),
      {
        ...entryMeta,
        eventCount: sequenceEvents.length,
      },
    );
  const sequenceCueGroups = measureSequenceRuntimeStep(
    "derive-sequence-cues",
    () => deriveSequenceCueGroupsFromEvents(sequenceEvents),
    {
      ...entryMeta,
      eventCount: sequenceEvents.length,
    },
  );
  const playbackSequenceCueGroups =
    playbackModel?.playbackSequenceCueGroups ??
    measureSequenceRuntimeStep(
      "derive-playback-sequence-cues",
      () =>
        playbackSequenceEvents === sequenceEvents
          ? sequenceCueGroups
          : deriveSequenceCueGroupsFromEvents(playbackSequenceEvents),
      {
        ...entryMeta,
        eventCount: playbackSequenceEvents.length,
        cueCount: sequenceCueGroups.length,
      },
    );
  const playbackNotesByCueIndex =
    playbackModel?.playbackNotesByCueIndex ??
    measureSequenceRuntimeStep(
      "derive-playback-notes-by-cue",
      () => deriveSequenceNotesByCueGroups(playbackSequenceCueGroups),
      {
        ...entryMeta,
        eventCount: playbackSequenceEvents.length,
        cueCount: playbackSequenceCueGroups.length,
      },
    );
  const terminalBarlinePosition = measureSequenceRuntimeStep(
    "derive-terminal-barline",
    () => deriveTerminalBarlinePosition(renderedSnapshots, sortedBars),
    {
      ...entryMeta,
      cueCount: sequenceCueGroups.length,
    },
  );
  const tempoTransitionCueMap = measureSequenceRuntimeStep(
    "derive-tempo-transition-map",
    () => deriveTempoTransitionCueMap(sortedTempi, sortedBars, terminalBarlinePosition),
    {
      ...entryMeta,
      cueCount: sequenceCueGroups.length,
    },
  );
  const sequenceRepeatSections = measureSequenceRuntimeStep(
    "derive-repeat-sections",
    () => deriveRepeatSections(sequenceCueGroups, repeats),
    {
      ...entryMeta,
      cueCount: sequenceCueGroups.length,
    },
  );
  const playbackTimeline =
    playbackModel?.playbackTimeline ??
    measureSequenceRuntimeStep(
      "build-playback-timeline",
      () =>
        buildPlaybackTimeline({
          snapshots: playbackRenderedSnapshots,
          bars: sortedBars,
          tempi: sortedTempi,
          repeats: effectivePlaybackRepeats,
          sequenceEvents: playbackSequenceEvents,
          sequenceCueGroups: playbackSequenceCueGroups,
        }),
      {
        ...entryMeta,
        cueCount: playbackSequenceCueGroups.length,
        eventCount: playbackSequenceEvents.length,
      },
    );
  const timedPlaybackBursts = playbackTimeline.playbackBursts;
  const timedCueTriggers =
    playbackModel?.timedCueTriggers ??
    measureSequenceRuntimeStep(
      "derive-timed-cue-triggers",
      () => deriveTimedCueTriggers(playbackTimeline),
      {
        ...entryMeta,
        cueCount: playbackSequenceCueGroups.length,
        burstCount: timedPlaybackBursts.length,
      },
    );
  const timedCueTriggerBySourceIndex =
    playbackModel?.timedCueTriggerBySourceIndex ??
    measureSequenceRuntimeStep(
      "index-timed-cue-triggers",
      () => {
        const mapping = new Map();
        timedCueTriggers.forEach((trigger) => {
          const sourceCueIndex = Number(trigger?.cueIndex);
          if (!Number.isFinite(sourceCueIndex)) return;
          mapping.set(sourceCueIndex, trigger);
        });
        return mapping;
      },
      {
        ...entryMeta,
        cueCount: timedCueTriggers.length,
        burstCount: timedPlaybackBursts.length,
      },
    );

  const model = {
    runtimeInstanceId,
    renderedSnapshots,
    playbackRenderedSnapshots,
    sortedBars,
    sortedTempi,
    sequenceEvents,
    playbackSequenceEvents,
    sequenceCueGroups,
    playbackSequenceCueGroups,
    playbackNotesByCueIndex,
    terminalBarlinePosition,
    tempoTransitionCueMap,
    sequenceRepeatSections,
    playbackTimeline,
    timedPlaybackBursts,
    timedCueTriggers,
    timedCueTriggerBySourceIndex,
  };

  if (isSequenceRuntimeDiagnosticsEnabled()) {
    appendPersistedSequenceRuntimeDiagnostic({
      type: "build",
      step: "build-sequence-runtime-model",
      durationMs: performance.now() - buildStartMs,
      ...entryMeta,
      eventCount: sequenceEvents.length,
      cueCount: sequenceCueGroups.length,
      burstCount: timedPlaybackBursts.length,
      runtimeInstanceId,
      detail: source,
    });
  }

  return model;
}

// One bounded cache per consumer; only immutable playback inputs invalidate it.
export function createSequenceRuntimeModelBuilder() {
  let previousDependencies = null;
  let previousModel = null;
  return (options = {}) => {
    const dependencies = [
      options.playbackSnapshots ?? options.displaySnapshots ?? options.snapshots,
      options.bars,
      options.tempi,
      options.playbackRepeats ?? options.repeats,
      normalizeSequenceLegatoMode(options.sequenceLegato ?? "per-note"),
    ];
    const canReuse =
      previousDependencies &&
      dependencies.every((value, index) => Object.is(value, previousDependencies[index]));
    const model = buildSequenceRuntimeModel(options, {
      playbackModel: canReuse ? previousModel : null,
    });
    previousDependencies = dependencies;
    previousModel = model;
    return model;
  };
}
