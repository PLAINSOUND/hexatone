import { createManualTransportActions, stopTimedTransportBefore } from "./transport-actions.js";

it.each([{ running: true }, { paused: true }, {}])(
  "stops only an owned timed transport before an action: %j",
  (state) => {
    const calls = [];
    stopTimedTransportBefore(() => calls.push("action"), state, (options) => {
      expect(options).toEqual({ restoreStartTarget: false });
      calls.push("stop");
    });
    expect(calls).toEqual(state.running || state.paused ? ["stop", "action"] : ["action"]);
  },
);

it.each(["cue", "snapshot"])("captures sounding %s before stop and deferred edit commit", (target) => {
  const calls = [];
  let activeCueIndex = 0;
  let pending;
  const { triggerManualTarget } = createManualTransportActions({
    timedTransportUiState: { running: true },
    getTimedTransportDisplay: () => ({ activeCueIndex }),
    sequenceCueGroups: [{ snapshotIndex: 4 }],
    onTimedTransportStop: () => { calls.push("stop"); activeCueIndex = -1; },
    runEditAwareTransportAction: (action) => { calls.push("queue"); pending = action; },
    onJumpSequenceCue: (index) => calls.push(["cue", index]),
    onJumpSequenceSnapshot: (index) => calls.push(["snapshot", index]),
  });
  triggerManualTarget(target, () => calls.push("fallback"));
  expect(calls).toEqual(["stop", "queue"]);
  pending();
  expect(calls[2]).toEqual([target, target === "cue" ? 0 : 4]);
});

it.each([
  [{ paused: true }, 0],
  [{}, 0],
  [{ running: true }, undefined],
  [{ running: true }, 99],
])("preserves manual fallback for state %j and cue %s", (state, activeCueIndex) => {
  const fallback = vi.fn();
  const jump = vi.fn();
  const actions = createManualTransportActions({
    timedTransportUiState: state,
    getTimedTransportDisplay: () => ({ activeCueIndex }),
    sequenceCueGroups: [{ snapshotIndex: 0 }],
    runEditAwareTransportAction: (action) => action(),
    onJumpSequenceCue: jump,
  });
  actions.triggerManualTarget("cue", fallback);
  expect(fallback).toHaveBeenCalledOnce();
  expect(jump).not.toHaveBeenCalled();
});
