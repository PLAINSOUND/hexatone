import { createPlaybackPresentation } from "./playback-presentation.js";

it.each(["manual", "timed"])("owns %s highlights/readouts and rejects presentation after disposal", (mode) => {
  const row = document.createElement("div");
  const note = document.createElement("div");
  const fields = {};
  let defaults = { bar: 0, snapshot: 0, cue: 0 };
  const scroll = vi.fn();
  const presentation = createPlaybackPresentation({
    sequenceCueGroups: [{ snapshotIndex: 0 }], snapshots: [{ id: "s" }],
    sequenceEvents: [], sortedBars: [], terminalBarlinePosition: 2,
    resolveSnapshotRow: id => id === "s" ? row : null,
    resolveEventRow: id => id === "note" ? note : null,
    isAutoScrollEnabled: () => false,
    prepareSnapshotRow: scroll, scrollSnapshotRow: scroll, scrollSnapshotRows: scroll,
    setTransportField: (field, value) => { fields[field] = value; },
    getReadoutDefaults: () => defaults,
  });
  presentation.present(0, null, { soundingAfter: [{ eventId: "note" }, { eventId: "note" }] }, { mode });
  expect(row.classList.contains(`sequencer-item--${mode}-playing`)).toBe(true);
  expect(note.classList.contains(`sequencer-event-row--${mode}-sounding`)).toBe(true);
  expect(fields).toMatchObject({ snapshot: 0, cue: 0 });
  expect(scroll).not.toHaveBeenCalled();
  defaults = { bar: 2, snapshot: 3, cue: 4 };
  presentation.readout.clear();
  expect(fields).toEqual(defaults);
  presentation.dispose();
  presentation.dispose();
  expect(row.className).toBe("");
  expect(note.className).toBe("");
  presentation.present(0, null, { soundingAfter: [{ eventId: "note" }] });
  expect(row.className).toBe("");
  expect(fields).toEqual(defaults);
});
