import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, beforeEach, vi } from "vitest";
import SequenceLibrary, { loadUserSequences, normalizeSequenceRecord } from "./sequence-library.jsx";

describe("SequenceLibrary", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists and reloads bar time signatures through saved sequences", () => {
    const onLoadSequence = vi.fn();

    render(
      <SequenceLibrary
        snapshots={[{ id: 10, notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] }]}
        bars={[
          { id: 1, position: 1, numerator: 3, denominator: 8 },
          { id: 2, position: 2, numerator: 5, denominator: 4 },
        ]}
        tempi={[]}
        snapshotLabelMode="labels"
        autoCreateBars
        activeSequenceName="Meter Test"
        activeSequenceDescription=""
        onLoadSequence={onLoadSequence}
      />,
    );

    fireEvent.click(screen.getByText("Save current sequence"));

    const stored = loadUserSequences();
    expect(stored).toHaveLength(1);
    expect(stored[0].bars).toEqual([
      { id: 1, position: 1, numerator: 3, denominator: 8 },
      { id: 2, position: 2, numerator: 5, denominator: 4 },
    ]);

    fireEvent.change(screen.getByRole("combobox"), {
      currentTarget: { value: "Meter Test" },
      target: { value: "Meter Test" },
    });
    fireEvent.click(screen.getByText("Open without saving"));

    expect(onLoadSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        bars: [
          { id: 1, position: 1, numerator: 3, denominator: 8 },
          { id: 2, position: 2, numerator: 5, denominator: 4 },
        ],
      }),
    );
  });

  it("loads a selected sequence immediately when the current workspace is empty", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      {
        type: "hexatone-sequence",
        version: 3,
        name: "Empty Load",
        description: "",
        snapshotLabelMode: "labels",
        autoCreateBars: true,
        transport: { unit: "sequence", anchorSeconds: 0 },
        tempi: [],
        snapshots: [{ id: 10, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      },
    ]));

    const onLoadSequence = vi.fn();

    render(
      <SequenceLibrary
        snapshots={[]}
        bars={[]}
        tempi={[]}
        snapshotLabelMode="labels"
        autoCreateBars
        activeSequenceName=""
        activeSequenceDescription=""
        onLoadSequence={onLoadSequence}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      currentTarget: { value: "Empty Load" },
      target: { value: "Empty Load" },
    });

    expect(screen.queryByText("Save current sequence?")).toBeNull();
    expect(onLoadSequence).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Empty Load" }),
    );
  });

  it("prompts before loading when the current workspace already has snapshots", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      {
        type: "hexatone-sequence",
        version: 3,
        name: "Prompt Load",
        description: "",
        snapshotLabelMode: "labels",
        autoCreateBars: true,
        transport: { unit: "sequence", anchorSeconds: 0 },
        tempi: [],
        snapshots: [{ id: 10, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      },
    ]));

    const onLoadSequence = vi.fn();

    render(
      <SequenceLibrary
        snapshots={[{ id: 99, notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] }]}
        bars={[]}
        tempi={[]}
        snapshotLabelMode="labels"
        autoCreateBars
        activeSequenceName="Current"
        activeSequenceDescription=""
        onLoadSequence={onLoadSequence}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      currentTarget: { value: "Prompt Load" },
      target: { value: "Prompt Load" },
    });

    expect(screen.getByText("Save current sequence?")).toBeTruthy();
    expect(onLoadSequence).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Open without saving"));

    expect(screen.queryByText("Save current sequence?")).toBeNull();
    expect(onLoadSequence).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Prompt Load" }),
    );
  });

  it("prefers bars over legacy meters when both are present in imported records", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      {
        type: "hexatone-sequence",
        version: 3,
        name: "Legacy Clash",
        description: "",
        snapshotLabelMode: "labels",
        autoCreateBars: true,
        transport: { unit: "sequence", anchorSeconds: 0 },
        snapshots: [{ id: 10, notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] }],
        bars: [
          { id: 1, position: 1, numerator: 4, denominator: 4 },
          { id: 2, position: 2, numerator: 3, denominator: 2 },
        ],
        meters: [
          { id: "meter:default", position: 1, numerator: 4, denominator: 4, beatLength: 1, barLength: 4 },
          { id: "meter:2", position: 2, numerator: 4, denominator: 4, beatLength: 1, barLength: 4 },
        ],
      },
    ]));

    const onLoadSequence = vi.fn();

    render(
      <SequenceLibrary
        snapshots={[]}
        bars={[]}
        tempi={[]}
        snapshotLabelMode="labels"
        autoCreateBars
        activeSequenceName=""
        activeSequenceDescription=""
        onLoadSequence={onLoadSequence}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      currentTarget: { value: "Legacy Clash" },
      target: { value: "Legacy Clash" },
    });

    expect(onLoadSequence).toHaveBeenCalledWith(
      expect.objectContaining({
        bars: [
          { id: 1, position: 1, numerator: 4, denominator: 4 },
          { id: 2, position: 2, numerator: 3, denominator: 2 },
        ],
      }),
    );
  });

  it("normalizes raw localStorage sequence records on reload before selection", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      {
        type: "hexatone-sequence",
        version: 3,
        name: "Reload Test",
        description: "",
        snapshotLabelMode: "proportion",
        autoCreateBars: true,
        transport: { unit: "sequence", anchorSeconds: 0 },
        tempi: [
          { id: 1, position: 1, bpm: 58, beatNumerator: 1, beatDenominator: 4, beatLength: 1 },
        ],
        snapshots: [
          { id: 1, length: 1, description: "x", notes: [] },
          { id: 2, length: 1, description: "y", notes: [] },
        ],
        bars: [
          { id: 1, position: 1, numerator: 1, denominator: 1 },
          { id: 2, position: 2, numerator: 3, denominator: 2 },
        ],
        meters: [
          { id: "meter:default", position: 1, numerator: 4, denominator: 4, beatLength: 1, barLength: 4 },
          { id: "meter:2", position: 2, numerator: 4, denominator: 4, beatLength: 1, barLength: 4 },
        ],
      },
    ]));

    expect(loadUserSequences()).toEqual([
      normalizeSequenceRecord({
        type: "hexatone-sequence",
        version: 3,
        name: "Reload Test",
        description: "",
        snapshotLabelMode: "proportion",
        autoCreateBars: true,
        transport: { unit: "sequence", anchorSeconds: 0 },
        tempi: [
          { id: 1, position: 1, bpm: 58, beatNumerator: 1, beatDenominator: 4, beatLength: 1 },
        ],
        snapshots: [
          { id: 1, length: 1, description: "x", notes: [] },
          { id: 2, length: 1, description: "y", notes: [] },
        ],
        bars: [
          { id: 1, position: 1, numerator: 1, denominator: 1 },
          { id: 2, position: 2, numerator: 3, denominator: 2 },
        ],
        meters: [
          { id: "meter:default", position: 1, numerator: 4, denominator: 4, beatLength: 1, barLength: 4 },
          { id: "meter:2", position: 2, numerator: 4, denominator: 4, beatLength: 1, barLength: 4 },
        ],
      }),
    ]);
  });
});
