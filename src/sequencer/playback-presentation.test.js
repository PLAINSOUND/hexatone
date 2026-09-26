import { createPlaybackPresentation } from "./playback-presentation.js";

it("tears down queued scrolling before replacing a mounted presentation", () => {
  const frames = [];
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const row = document.createElement("div");
  const scroll = vi.fn();
  const fields = vi.fn();
  const options = {
    sequenceCueGroups: [{ snapshotIndex: 0 }], snapshots: [{ id: "s" }],
    sequenceEvents: [], sortedBars: [], terminalBarlinePosition: 2,
    resolveSnapshotRow: () => row, resolveEventRow: () => null,
    isAutoScrollEnabled: () => true,
    prepareSnapshotRow: vi.fn(), scrollSnapshotRows: scroll,
    setTransportField: fields, getReadoutDefaults: () => ({}),
  };
  const old = createPlaybackPresentation(options);
  let current;
  try {
    old.present(0, null, {});
    expect(frames).toHaveLength(1);
    old.dispose();
    expect(cancel).toHaveBeenCalledWith(1);
    current = createPlaybackPresentation(options);
    current.present(0, null, {}, { mode: "manual" });
    fields.mockClear();
    // Simulate delivery despite cancellation, then an obsolete cue callback.
    frames[0]();
    old.present(0, null, {});
    expect(scroll).not.toHaveBeenCalled();
    expect(fields).not.toHaveBeenCalled();
    expect(row.classList.contains("sequencer-item--manual-playing")).toBe(true);
    frames[1]();
    expect(scroll).toHaveBeenCalledExactlyOnceWith([row]);
  } finally {
    old.dispose();
    current?.dispose();
    raf.mockRestore();
    cancel.mockRestore();
  }
});

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
