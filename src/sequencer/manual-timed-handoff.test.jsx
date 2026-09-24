import { render, screen } from "@testing-library/preact";
import { fireEvent } from "../test-utils/dom-events.js";
import SequenceControls from "./sequence-controls.jsx";

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
  ["next sequence marker", "cue", 1],
  ["previous sequence marker", "cue", 1],
  ["next sequence step", "snapshot", 2],
  ["previous sequence step", "snapshot", 2],
  ["play current sequence position", "cue", 1],
])("%s retriggers the sounding timed position, not the start target", (label, kind, index) => {
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
      onTimedTransportStop={() => calls.push(["stop"])}
      onJumpSequenceCue={(value) => calls.push(["cue", value])}
      onJumpSequenceSnapshot={(value) => calls.push(["snapshot", value])}
      onStepSequence={() => calls.push(["unexpected step"])}
      onStepSequenceMarker={() => calls.push(["unexpected step"])}
    />,
  );
  fireEvent.click(screen.getByLabelText(label));
  expect(calls).toEqual([["stop"], [kind, index]]);
});
