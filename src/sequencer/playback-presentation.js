/** Owns one mounted generation of highlight, readout and autoscroll presenters.
 * Sequencer supplies its current model and live DOM resolvers. Audio dispatch,
 * frame coalescing and deferred App state are deliberately owned elsewhere.
 */
import { absolutePositionToBarBeat } from "./transport.js";
import {
  createTimedPlaybackAutoscrollPresenter,
  createTimedPlaybackHighlightPresenter,
  createTimedTransportReadoutPresenter,
  deriveTimedPageFollowPosition,
} from "./timed-playback-visual-presenter.js";

export function createPlaybackPresentation({
  sequenceCueGroups, snapshots, sequenceEvents, sortedBars, terminalBarlinePosition,
  resolveSnapshotRow, resolveEventRow, isAutoScrollEnabled,
  prepareSnapshotRow, scrollSnapshotRow, scrollSnapshotRows,
  setTransportField, getReadoutDefaults,
}) {
  let disposed = false;
  const highlight = createTimedPlaybackHighlightPresenter({ resolveSnapshotRow, resolveEventRow });
  const autoscroll = createTimedPlaybackAutoscrollPresenter({
    isEnabled: isAutoScrollEnabled, resolveSnapshotRow, resolveEventRow,
    prepareSnapshotRow, scrollSnapshotRow, scrollSnapshotRows,
  });
  const readout = createTimedTransportReadoutPresenter({
    presentTransportPosition: (position) => {
      setTransportField("bar", position?.barIndex);
      setTransportField("snapshot", position?.snapshotIndex);
      setTransportField("cue", position?.cueIndex);
    },
    clearTransportPosition: () => {
      const defaults = getReadoutDefaults();
      setTransportField("bar", defaults.bar);
      setTransportField("snapshot", defaults.snapshot);
      setTransportField("cue", defaults.cue);
    },
  });
  const present = (cueIndex, trigger, burst, options = {}) => {
    if (disposed) return;
    const cueGroup = sequenceCueGroups[cueIndex] ?? null;
    const snapshotIndex = cueGroup?.snapshotIndex ?? null;
    const snapshotId = cueGroup == null ? null : (snapshots[snapshotIndex]?.id ?? null);
    const soundingAfter = Array.isArray(burst?.soundingAfter) ? burst.soundingAfter : [];
    const soundingEventIds = new Set(
      soundingAfter.map(note => note?.eventId).filter(eventId => eventId != null),
    );
    const sequenceTime = Number(burst?.sequenceTime ?? trigger?.sequenceTime);
    const barBeat = Number.isFinite(sequenceTime)
      ? absolutePositionToBarBeat(sequenceTime, sortedBars, 1, 9, terminalBarlinePosition)
      : null;
    highlight.present({ snapshotId, soundingEventIds: [...soundingEventIds], mode: options.mode ?? "timed" });
    readout.present({
      barIndex: Number.isFinite(barBeat?.barNumber) ? barBeat.barNumber - 1 : null,
      snapshotIndex, cueIndex,
    });
    if (options.autoScroll === false) return;
    if (!isAutoScrollEnabled()) {
      autoscroll.cancel();
      return;
    }
    // Newly attacked rows lead page turns; otherwise use the current snapshot,
    // never a sustained old note as the scroll target.
    const position = deriveTimedPageFollowPosition({
      burst, sequenceEvents, snapshots,
      fallbackSnapshotIndex: snapshotIndex, fallbackSnapshotId: snapshotId,
    });
    if (position != null) autoscroll.enqueue(position);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    highlight.dispose();
    autoscroll.dispose();
    readout.dispose();
  };
  return { highlight, autoscroll, readout, present, dispose };
}
