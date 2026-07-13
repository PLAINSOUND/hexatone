import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SequenceLibrary, { loadUserSequences, normalizeSequenceRecord } from "./sequence-library.jsx";
import { findPresetSequenceByName } from "./preset-sequences/index.js";

function SequenceLibraryHarness({
  initialSnapshots = [],
  initialBars = [],
  initialRepeats = [],
  initialTempi = [],
  initialSource = "",
  initialBuiltInName = "",
  initialName = "",
  initialSavedName = "",
  initialDescription = "",
  snapshotLabelMode = "labels",
  autoCreateBars = true,
  onLoadSpy = vi.fn(),
}) {
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [bars, setBars] = useState(initialBars);
  const [repeats, setRepeats] = useState(initialRepeats);
  const [tempi, setTempi] = useState(initialTempi);
  const [source, setSource] = useState(initialSource);
  const [builtInName, setBuiltInName] = useState(initialBuiltInName);
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialSavedName);
  const [description, setDescription] = useState(initialDescription);

  return (
    <SequenceLibrary
      snapshots={snapshots}
      bars={bars}
      repeats={repeats}
      tempi={tempi}
      snapshotLabelMode={snapshotLabelMode}
      autoCreateBars={autoCreateBars}
      activeSequenceSource={source}
      activeSequenceBuiltInName={builtInName}
      activeSequenceName={name}
      activeSequenceSavedName={savedName}
      activeSequenceDescription={description}
      onLoadSequence={(sequence, options = {}) => {
        onLoadSpy(sequence, options);
        setSnapshots(sequence.snapshots ?? []);
        setBars(sequence.bars ?? []);
        setRepeats(sequence.repeats ?? []);
        setTempi(sequence.tempi ?? []);
        setSource(options?.source ?? "user");
        setBuiltInName(options?.source === "builtin" ? (sequence.name ?? "") : "");
        setName(sequence.name ?? "");
        setSavedName(options?.source === "user" ? (sequence.name ?? "") : "");
        setDescription(sequence.description ?? "");
      }}
      onClearSequence={() => {
        setSnapshots([]);
        setBars([]);
        setRepeats([]);
        setTempi([]);
        setSource("");
        setBuiltInName("");
        setName("");
        setSavedName("");
        setDescription("");
      }}
      onSequenceSaved={(nextName) => {
        const trimmed = String(nextName ?? "").trim();
        setSource("user");
        setBuiltInName("");
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
      expect.objectContaining({ source: "user" }),
    );
  });

  it("reloads the selected built-in sequence from the packaged library", () => {
    const onLoadSpy = vi.fn();

    render(
      <SequenceLibraryHarness
        initialSource="builtin"
        initialBuiltInName="FALL"
        initialName="FALL"
        initialSnapshots={[{ id: 999, notes: [{ id: "stale", midicents: 69, start: 0, end: 1 }] }]}
        onLoadSpy={onLoadSpy}
      />,
    );

    const refreshButtons = document.querySelectorAll(".preset-refresh-btn");
    fireEvent.click(refreshButtons[0]);

    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "FALL" }),
      expect.objectContaining({ source: "builtin" }),
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

    expect(screen.getByRole("combobox", { name: "User sequences" }).value).toBe("__draft__");
    expect(screen.getByRole("option", { name: "Unsaved sequence" })).toBeTruthy();
    expect(screen.getByText("Save current sequence and overwrite")).toBeTruthy();
  });

  it("saves a copy under a unique name", () => {
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
        initialName="FALL"
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.click(screen.getByText("Save as copy"));

    expect(loadUserSequences().map((sequence) => sequence.name)).toEqual(["FALL", "FALL 2"]);
    expect(screen.getByRole("combobox", { name: "User sequences" }).value).toBe("FALL 2");
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

    fireEvent.change(screen.getByRole("combobox", { name: "User sequences" }), {
      currentTarget: { value: "Empty Load" },
      target: { value: "Empty Load" },
    });

    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Empty Load" }),
      expect.objectContaining({ source: "user" }),
    );
    expect(screen.getByRole("combobox", { name: "User sequences" }).value).toBe("Empty Load");
  });

  it("does not show a user draft when only default transport scaffolding is present", () => {
    render(
      <SequenceLibraryHarness
        initialBars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
        initialTempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Built-in sequences" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "User sequences" })).toBeNull();
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
      expect(onLoadSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: "FALL 2" }),
        expect.objectContaining({ source: "user" }),
      );
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

    fireEvent.change(screen.getByRole("combobox", { name: "User sequences" }), {
      currentTarget: { value: "Prompt Load" },
      target: { value: "Prompt Load" },
    });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Prompt Load" }),
      expect.objectContaining({ source: "user" }),
    );
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
    expect(screen.getByRole("combobox", { name: "Built-in sequences" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "User sequences" })).toBeNull();
    expect(screen.queryByText("Save current sequence")).toBeNull();
    expect(screen.queryByText("Save current sequence and overwrite")).toBeNull();
  });

  it("loads a built-in sequence and keeps the user menu clear", () => {
    const onLoadSpy = vi.fn();

    render(<SequenceLibraryHarness onLoadSpy={onLoadSpy} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Built-in sequences" }), {
      currentTarget: { value: "FALL" },
      target: { value: "FALL" },
    });

    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "FALL" }),
      expect.objectContaining({ source: "builtin" }),
    );
    expect(screen.getByRole("combobox", { name: "Built-in sequences" }).value).toBe("FALL");
    expect(screen.queryByRole("combobox", { name: "User sequences" })).toBeNull();
  });

  it("clears the built-in selection after saving into the user library", () => {
    render(
      <SequenceLibraryHarness
        initialSource="builtin"
        initialBuiltInName="FALL"
        initialSnapshots={[{ id: 1, notes: [] }]}
        initialName="FALL"
      />,
    );

    fireEvent.click(screen.getByText("Save current sequence in user library"));

    expect(screen.getByRole("combobox", { name: "Built-in sequences" }).value).toBe("");
    expect(screen.getByRole("combobox", { name: "User sequences" }).value).toBe("FALL");
  });

  it("uses the user-library save label for built-in sequences", () => {
    const builtIn = findPresetSequenceByName("FALL");

    render(
      <SequenceLibraryHarness
        initialSource="builtin"
        initialBuiltInName="FALL"
        initialSnapshots={builtIn?.snapshots ?? []}
        initialBars={builtIn?.bars ?? []}
        initialRepeats={builtIn?.repeats ?? []}
        initialTempi={builtIn?.tempi ?? []}
        initialName="FALL"
      />,
    );

    expect(screen.getByText("Save current sequence in user library")).toBeTruthy();
  });

  it("does not show overwrite messaging when a built-in sequence shares a name with a clean saved user sequence", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "FALL",
        snapshots: [{ id: 1, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      }),
    ]));

    render(
      <SequenceLibraryHarness
        initialSource="builtin"
        initialBuiltInName="FALL"
        initialSnapshots={[{ id: 1, notes: [] }]}
        initialName="FALL"
      />,
    );

    expect(screen.getByText("Save current sequence in user library")).toBeTruthy();
    expect(screen.queryByText("Save current sequence and overwrite")).toBeNull();
  });

  it("does not warn when switching from a clean saved user sequence to a built-in sequence with the same name", () => {
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "FALL",
        snapshots: [{ id: 1, notes: [] }],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
      }),
    ]));

    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;
    const onLoadSpy = vi.fn();

    render(
      <SequenceLibraryHarness
        initialSource="user"
        initialSnapshots={[{ id: 1, notes: [] }]}
        initialName="FALL"
        initialSavedName="FALL"
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Built-in sequences" }), {
      currentTarget: { value: "FALL" },
      target: { value: "FALL" },
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "FALL" }),
      expect.objectContaining({ source: "builtin" }),
    );
  });

  it("does not warn when switching from a clean built-in sequence to a user sequence with the same name but different data", () => {
    const builtIn = findPresetSequenceByName("FALL");
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      normalizeSequenceRecord({
        name: "FALL",
        snapshots: [
          { id: 10, notes: [{ id: "u", midicents: 70, start: 0, end: 1 }] },
        ],
        bars: [{ id: 1, position: 1, numerator: 3, denominator: 2 }],
      }),
    ]));

    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;
    const onLoadSpy = vi.fn();

    render(
      <SequenceLibraryHarness
        initialSource="builtin"
        initialBuiltInName="FALL"
        initialSnapshots={builtIn?.snapshots ?? []}
        initialBars={builtIn?.bars ?? []}
        initialRepeats={builtIn?.repeats ?? []}
        initialTempi={builtIn?.tempi ?? []}
        initialName="FALL"
        initialDescription={builtIn?.description ?? ""}
        snapshotLabelMode={builtIn?.snapshotLabelMode ?? "labels"}
        autoCreateBars={builtIn?.autoCreateBars ?? true}
        onLoadSpy={onLoadSpy}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "User sequences" }), {
      currentTarget: { value: "FALL" },
      target: { value: "FALL" },
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onLoadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "FALL" }),
      expect.objectContaining({ source: "user" }),
    );
  });
});
