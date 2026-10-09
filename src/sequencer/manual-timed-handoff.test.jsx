import { render, screen } from "@testing-library/preact";
import { fireEvent } from "../test-utils/dom-events.js";
import SequenceControls from "./sequence-controls.jsx";

it("disables backward stepping at the prepared first snapshot and cue", () => {
  const step = vi.fn();
  render(<SequenceControls snapshots={[{ id: 1, notes: [] }]}
    renderedSnapshots={[]} sortedBars={[]} sequenceCueGroups={[]}
    playhead={{ stepIndex: -1, stopped: true }}
    impliedPendingSnapshotIndex="0" impliedPendingCueIndex="0"
    onStepSequence={step} onStepSequenceMarker={step} />);
  for (const label of ["previous sequence step", "previous sequence marker"]) {
    expect(screen.getByLabelText(label).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(label));
  }
  expect(step).not.toHaveBeenCalled();
});

it.each(["start", "end"])("timed %s navigation stops before a deferred edit commit", (target) => {
  const calls = [];
  let pending;
  render(
    <SequenceControls
      snapshots={[{ id: 1, notes: [] }]}
      renderedSnapshots={[{ id: 1, notes: [] }]}
      sortedBars={[]}
      sequenceCueGroups={[]}
      playhead={{ stepIndex: 0 }}
      timedTransportUiState={{ running: true }}
      runTransportAction={(action) => { calls.push("queue"); pending = action; }}
      onTimedTransportStop={(options) => {
        expect(options).toEqual({ restoreStartTarget: false });
        calls.push("stop");
      }}
      onResetSequencePlayhead={() => calls.push("start")}
      onJumpSequenceEnd={() => calls.push("end")}
    />,
  );
  fireEvent.click(screen.getByLabelText(`move timed transport to ${target}`));
  expect(calls).toEqual(["stop", "queue"]);
  pending();
  expect(calls).toEqual(["stop", "queue", target]);
});

it.each([
  ["next sequence marker", "cue", 2],
  ["previous sequence marker", "cue", 0],
  ["next sequence step", "snapshot", 3],
  ["previous sequence step", "snapshot", 1],
  ["play current sequence position", "cue", 1],
])("%s hands off relative to the sounding timed position, not the start target", (label, kind, index) => {
  const calls = [];
  const snapshots = [0, 1, 2].map((id) => ({ id, notes: [] }));
  render(
    <SequenceControls
      snapshots={snapshots}
      renderedSnapshots={snapshots}
      sortedBars={[]}
      sequenceCueGroups={[{ snapshotIndex: 0 }, { snapshotIndex: 2 }]}
      playhead={{ markerIndex: 0, stepIndex: 0 }}
      snapshotSelectValue="0"
      cueSelectValue="0"
      timedTransportUiState={{ running: true }}
      getTimedTransportDisplay={() => ({ activeCueIndex: 1, clock: "00:00:10", barBeat: "3:1" })}
      runTransportAction={(action) => action()}
      onTimedTransportStop={(options) => {
        expect(options).toEqual(kind === "cue" && label !== "play current sequence position"
          ? { restoreStartTarget: false, preserveSoundingNotes: true }
          : { restoreStartTarget: false });
        calls.push(["stop"]);
      }}
      onJumpSequenceCue={(value) => calls.push(["cue", value])}
      onJumpSequenceSnapshot={(value) => calls.push(["snapshot", value])}
      onStepSequence={() => calls.push(["unexpected step"])}
      onStepSequenceMarker={() => calls.push(["unexpected step"])}
    />,
  );
  fireEvent.click(screen.getByLabelText(label));
  expect(calls).toEqual([["stop"], [kind, index]]);
});
