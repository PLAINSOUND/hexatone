import { createTimedPlaybackHighlightPresenter } from "./timed-playback-visual-presenter.js";

it("switches manual and timed styles on the same rows and preserves the mode on refresh", () => {
  const snapshot = document.createElement("div");
  const event = document.createElement("div");
  const presenter = createTimedPlaybackHighlightPresenter({
    resolveSnapshotRow: () => snapshot,
    resolveEventRow: () => event,
  });
  const position = { snapshotId: 1, soundingEventIds: ["a"] };
  presenter.present(position);
  expect(snapshot.className).toBe("sequencer-item--timed-playing");
  presenter.present({ ...position, mode: "manual" });
  expect(snapshot.className).toBe("sequencer-item--manual-playing");
  expect(event.className).toBe("sequencer-event-row--manual-sounding");
  snapshot.className = "";
  presenter.refresh();
  expect(snapshot.className).toBe("sequencer-item--manual-playing");
  presenter.present(position);
  expect(snapshot.className).toBe("sequencer-item--timed-playing");
  expect(event.className).toBe("sequencer-event-row--timed-sounding");
  presenter.dispose();
  expect(snapshot.className).toBe("");
  expect(event.className).toBe("");
});
