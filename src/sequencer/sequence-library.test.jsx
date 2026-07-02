import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SequenceLibrary, { loadUserSequences, normalizeSequenceRecord } from "./sequence-library.jsx";

function SequenceLibraryHarness({
  initialSnapshots = [],
  initialBars = [],
  initialTempi = [],
  initialName = "",
  initialSavedName = "",
  initialDescription = "",
  snapshotLabelMode = "labels",
  autoCreateBars = true,
  onLoadSpy = vi.fn(),
}) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [bars, setBars] = useState(initialBars);
  const [tempi, setTempi] = useState(initialTempi);
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialSavedName);
  const [description, setDescription] = useState(initialDescription);

  return (
    <SequenceLibrary
      snapshots={snapshots}
      bars={bars}
      tempi={tempi}
      snapshotLabelMode={snapshotLabelMode}
      autoCreateBars={autoCreateBars}
      activeSequenceName={name}
      activeSequenceSavedName={savedName}
      activeSequenceDescription={description}
      onLoadSequence={(sequence) => {
        onLoadSpy(sequence);
        setSnapshots(sequence.snapshots ?? []);
        setBars(sequence.bars ?? []);
        setTempi(sequence.tempi ?? []);
        setName(sequence.name ?? "");
        setSavedName(sequence.name ?? "");
        setDescription(sequence.description ?? "");
      }}
      onClearSequence={() => {
        setSnapshots([]);
        setBars([]);
        setTempi([]);
        setName("");
        setSavedName("");
        setDescription("");
      }}
      onSequenceSaved={(nextName) => {
        const trimmed = String(nextName ?? "").trim();
        setName(trimmed);
        setSavedName(trimmed);
      }}
    />
  );
}

describe("SequenceLibrary", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.confirm = vi.fn(() => true);
  });

  it("persists and reloads bar time signatures through saved sequences", () => {
    const onLoadSpy = vi.fn();

    render(
      <SequenceLibraryHarness
        initialSnapshots={[{ id: 10, notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] }]}
        initialBars={[
          { id: 1, position: 1, numerator: 3, denominator: 8 },
          { id: 2, position: 2, numerator: 5, denominator: 4 },
        ]}
        initialName="Meter Test"
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.click(screen.getByText("Save current sequence"));

    const stored = loadUserSequences();
    expect(stored).toHaveLength(1);
    expect(stored[0].bars).toEqual([
      { id: 1, position: 1, numerator: 3, denominator: 8 },
      { id: 2, position: 2, numerator: 5, denominator: 4 },
    ]);

    fireEvent.click(document.querySelector(".preset-refresh-btn"));
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bars: [
          { id: 1, position: 1, numerator: 3, denominator: 8 },
          { id: 2, position: 2, numerator: 5, denominator: 4 },
        ],
      }),
    );
  });

  it("shows an unsaved draft in the menu and prompts overwrite on name collision", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "FALL",
        snapshots: [{ id: 1, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      }),
    ]));

    render(
      <SequenceLibraryHarness
        initialSnapshots={[{ id: 99, notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] }]}
        initialBars={[{ id: 1, position: 1, numerator: 3, denominator: 2 }]}
        initialName="FALL"
      />,
    );

    expect(screen.getByRole("combobox").value).toBe("__draft__");
    expect(screen.getByRole("option", { name: "Unsaved sequence" })).toBeTruthy();
    expect(screen.getByText("Save current sequence and overwrite")).toBeTruthy();
  });

  it("loads a selected saved sequence immediately when the workspace is empty", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "Empty Load",
        snapshots: [{ id: 10, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      }),
    ]));

    const onLoadSpy = vi.fn();

    render(<SequenceLibraryHarness onLoadSpy={onLoadSpy} />);

    fireEvent.change(screen.getByRole("combobox"), {
      currentTarget: { value: "Empty Load" },
      target: { value: "Empty Load" },
    });

    expect(onLoadSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Empty Load" }));
    expect(screen.getByRole("combobox").value).toBe("Empty Load");
  });

  it("does not show an unsaved draft when only default transport scaffolding is present", () => {
    render(
      <SequenceLibraryHarness
        initialBars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
        initialTempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("option", { name: "Unsaved sequence" })).toBeNull();
    expect(screen.queryByText("Save current sequence")).toBeNull();
  });

  it("imports duplicate names with a numeric suffix without stashing the current draft", async () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "FALL",
        snapshots: [{ id: 1, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      }),
    ]));

    const onLoadSpy = vi.fn();

    render(
      <SequenceLibraryHarness
        initialSnapshots={[{ id: 99, notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] }]}
        initialBars={[{ id: 1, position: 1, numerator: 3, denominator: 2 }]}
        initialName="Current Working State"
        onLoadSpy={onLoadSpy}
      />,
    );

    const fileInput = document.querySelector('input[type="file"]');
    const file = new File(
      [JSON.stringify({
        type: "hexatone-sequence",
        version: 3,
        name: "FALL",
        description: "",
        snapshotLabelMode: "labels",
        autoCreateBars: true,
        transport: { unit: "sequence", anchorSeconds: 0 },
        tempi: [],
        snapshots: [{ id: 10, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 5, denominator: 4 }],
      })],
      "FALL.json",
      { type: "application/json" },
    );

    fireEvent.change(fileInput, {
      currentTarget: { files: [file] },
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onLoadSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "FALL 2" }));
    });
    expect(loadUserSequences().map((sequence) => sequence.name)).toEqual(["FALL", "FALL 2"]);
  });

  it("uses a single discard confirmation when loading another saved sequence from a dirty workspace", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "Prompt Load",
        snapshots: [{ id: 10, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      }),
    ]));

    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;
    const onLoadSpy = vi.fn();

    render(
      <SequenceLibraryHarness
        initialSnapshots={[{ id: 99, notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] }]}
        initialName="Current"
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      currentTarget: { value: "Prompt Load" },
      target: { value: "Prompt Load" },
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onLoadSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Prompt Load" }));
    expect(loadUserSequences().map((sequence) => sequence.name)).toEqual(["Prompt Load"]);
  });

  it("deletes the active saved sequence and clears the workspace", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "FALL",
        snapshots: [{ id: 1, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      }),
    ]));

    render(
      <SequenceLibraryHarness
        initialSnapshots={[{ id: 1, notes: [] }]}
        initialBars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
        initialName="FALL"
        initialSavedName="FALL"
      />,
    );

    fireEvent.click(screen.getByText("Delete"));

    expect(loadUserSequences()).toEqual([]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Save current sequence")).toBeNull();
    expect(screen.queryByText("Save current sequence and overwrite")).toBeNull();
  });
});
