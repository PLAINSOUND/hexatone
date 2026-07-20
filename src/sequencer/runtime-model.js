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
import { normalizeBarMarkers, normalizeTempoMarkers, deriveTempoTransitionCueMap, deriveTerminalBarlinePosition } from "./transport.js";
import { deriveSequenceCueGroupsFromEvents, deriveSequenceEvents } from "./trigger-groups.js";

let nextRuntimeInstanceId = 1;

export function buildSequenceRuntimeModel({
  snapshots = [],
  displaySnapshots = null,
  playbackSnapshots = null,
  bars = [],
  tempi = [],
  repeats = [],
  playbackRepeats = null,
  sequenceLegato = true,
  source = "runtime",
} = {}) {
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
  const effectivePlaybackRepeats = Array.isArray(playbackRepeats)
    ? playbackRepeats
    : repeats;

  const sortedBars = measureSequenceRuntimeStep(
    "normalize-bars",
    () => normalizeBarMarkers(bars),
    entryMeta,
  );
  const sortedTempi = measureSequenceRuntimeStep(
    "normalize-tempi",
    () => (Array.isArray(tempi) ? normalizeTempoMarkers(tempi) : []),
    entryMeta,
  );
  const sequenceEvents = measureSequenceRuntimeStep(
    "derive-sequence-events",
    () => deriveSequenceEvents(renderedSnapshots, sortedBars, sortedTempi, repeats),
    entryMeta,
  );
  const playbackSequenceEvents = measureSequenceRuntimeStep(
    "derive-playback-sequence-events",
    () => (
      playbackRenderedSnapshots === renderedSnapshots
        && effectivePlaybackRepeats === repeats
        ? sequenceEvents
        : deriveSequenceEvents(playbackRenderedSnapshots, sortedBars, sortedTempi, effectivePlaybackRepeats)
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
  const playbackSequenceCueGroups = measureSequenceRuntimeStep(
    "derive-playback-sequence-cues",
    () => (
      playbackSequenceEvents === sequenceEvents
        ? sequenceCueGroups
        : deriveSequenceCueGroupsFromEvents(playbackSequenceEvents)
    ),
    {
      ...entryMeta,
      eventCount: playbackSequenceEvents.length,
      cueCount: sequenceCueGroups.length,
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
  const playbackTimeline = measureSequenceRuntimeStep(
    "build-playback-timeline",
    () => buildPlaybackTimeline({
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
  const timedCueTriggers = measureSequenceRuntimeStep(
    "derive-timed-cue-triggers",
    () => deriveTimedCueTriggers(playbackTimeline, { legato: sequenceLegato }),
    {
      ...entryMeta,
      cueCount: playbackSequenceCueGroups.length,
      burstCount: timedPlaybackBursts.length,
    },
  );
  const timedCueTriggerBySourceIndex = measureSequenceRuntimeStep(
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
