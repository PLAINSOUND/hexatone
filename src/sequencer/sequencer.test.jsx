import { useState } from "preact/hooks";
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import Sequencer from "./sequencer.jsx";
import { loadUserSequences } from "./sequence-library.jsx";
import { normalizeBarMarkers, normalizeTempoMarkers } from "./transport.js";

describe("Sequencer", () => {
  it("renders snapshots as auto-numbered rows and expands derived event groups", () => {
    const onSelectSnapshot = vi.fn();
    const onSelectMarker = vi.fn();
    const onUpdateSnapshot = vi.fn();
    const onResetSnapshotDescription = vi.fn();
    const onPlaySnapshot = vi.fn();
    const onStopSnapshot = vi.fn();
    const onSelectSequenceBar = vi.fn();
    const onStepSequence = vi.fn();
    const onStepSequenceMarker = vi.fn();
    const onPlaySequence = vi.fn();
    const onPlayCue = vi.fn();
    const onResetSequencePlayhead = vi.fn();

    const { container } = render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A, F",
            notes: [
              {
                id: "a",
                midicents: 81,
                displayLabel: "A",
                start: 0,
                end: 1,
                attackVelocity: 90,
                releaseVelocity: 40,
                pressure: 61,
                timbre: 80,
              },
              {
                id: "b",
                midicents: 76,
                displayLabel: "F",
                start: 0.5,
                end: 1,
                attackVelocity: 80,
                releaseVelocity: 30,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 99, position: 2 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={10}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={onSelectSnapshot}
        onSelectMarker={onSelectMarker}
        onPlaySnapshot={onPlaySnapshot}
        onStopSnapshot={onStopSnapshot}
        onSelectSequenceBar={onSelectSequenceBar}
        onStepSequence={onStepSequence}
        onStepSequenceMarker={onStepSequenceMarker}
        onPlaySequence={onPlaySequence}
        onPlayCue={onPlayCue}
        onResetSequencePlayhead={onResetSequencePlayhead}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={onResetSnapshotDescription}
      />,
    );

    expect(screen.getByLabelText("snapshot 1 description").value).toBe("A, F");
    expect(screen.getByText("PLAY FROM")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("next sequence marker"));
    expect(onStepSequenceMarker).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText("move sequence playhead to start"));
    expect(onResetSequencePlayhead).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("play current sequence position"));
    expect(onPlaySequence).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("stop sequence playback"));
    expect(onStopSnapshot).toHaveBeenCalledWith();
    expect(screen.getByLabelText("Snapshot Labels").value).toBe("labels");
    fireEvent.click(screen.getByLabelText("snapshot 1 description"));
    expect(onSelectSnapshot).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getByLabelText("play snapshot 1"));
    expect(onPlaySnapshot).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getByLabelText("stop snapshot 1"));
    expect(onStopSnapshot).toHaveBeenCalledWith(10);

    const eventTimes = [...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value);
    expect(eventTimes).toEqual(["1.000000", "1.000000", "1.500000", "2.000000", "2.000000", "2.000000"]);
    const cueNumbers = [...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent);
    expect(cueNumbers).toEqual(["1", "2", "3"]);
    expect(screen.getByText("Position")).not.toBeNull();
    expect(screen.getByLabelText("bar 1 position").value).toBe("1.000000");
    expect(screen.getByLabelText("bar 2 position").value).toBe("2.000000");
    expect(screen.getAllByText("MIDI¢").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("show expression controls")).not.toBeNull();
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 release midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).toBe("880.0");
    expect(screen.getAllByLabelText("snapshot 1 release frequency")[0].value).toBe("880.0");
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    expect(screen.getAllByText("F").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("snapshot 1 attack bar")[0].value).toBe("1");
    expect(screen.getAllByLabelText("snapshot 1 attack beat")[0].value).toBe("1");
    expect(screen.getAllByLabelText("snapshot 1 attack beat fraction numerator")[0].value).toBe("0");
    expect(screen.getAllByLabelText("snapshot 1 attack beat fraction denominator")[0].value).toBe("1");
    expect(screen.getByLabelText("bar 1 beats per bar").value).toBe("4");
    expect(screen.getByLabelText("bar 1 beat unit").value).toBe("4");
    expect(screen.getAllByText("on")).toHaveLength(2);
    expect(screen.getAllByText("off")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("play cue 1"));
    expect(onPlayCue).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByLabelText("show expression controls"));
    expect(screen.getByLabelText("show bar-relative timing")).not.toBeNull();

    /*fireEvent.click(screen.getByText("2 notes"));
    expect(container.querySelector(".sequencer-events-grid")).toBeNull();*/

    fireEvent.click(screen.getByText("2 notes"));

    fireEvent.click(container.querySelectorAll(".sequencer-event-row")[1]);
    expect(onSelectMarker).toHaveBeenCalledWith(10, 0.5);

    fireEvent.blur(screen.getAllByLabelText("snapshot 1 attack position")[0], {
      currentTarget: { value: "1.250" },
      target: { value: "1.250" },
    });
    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, {
      notes: [
        expect.objectContaining({ id: "a", start: 0.25, end: 1 }),
        expect.objectContaining({ id: "b", start: 0.5, end: 1 }),
      ],
    });

    fireEvent.blur(screen.getAllByLabelText("snapshot 1 release position")[0], {
      currentTarget: { value: "2.250" },
      target: { value: "2.250" },
    });
    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, {
      notes: [
        expect.objectContaining({ id: "a", start: 0, end: 1.25 }),
        expect.objectContaining({ id: "b", start: 0.5, end: 1 }),
      ],
    });

    fireEvent.input(screen.getByLabelText("snapshot 1 description"), {
      currentTarget: { value: "Edited" },
      target: { value: "Edited" },
    });
    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, { description: "Edited" });

    fireEvent.click(screen.getByLabelText("reset snapshot 1 description"));
    expect(onResetSnapshotDescription).toHaveBeenCalledWith(10);
  });

  it("commits a focused position edit before cue stepping", () => {
    const onUpdateSnapshot = vi.fn();
    const onStepSequenceMarker = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              {
                id: "a",
                midicents: 81,
                start: 0,
                end: 1,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={onStepSequenceMarker}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    const attackPosition = screen.getByLabelText("snapshot 1 attack position");
    attackPosition.focus();
    expect(document.activeElement).toBe(attackPosition);
    attackPosition.value = "1.250";

    fireEvent.click(screen.getByLabelText("next sequence marker"));

    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, {
      notes: [expect.objectContaining({ id: "a", start: 0.25, end: 1 })],
    });
    expect(onStepSequenceMarker).toHaveBeenCalledWith(1);
  });

  it("commits bar-relative timing edits back into absolute event positions", () => {
    const onUpdateSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              {
                id: "a",
                midicents: 81,
                start: 0,
                end: 1,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 2, numerator: 4, denominator: 4 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    const beatInput = screen.getByLabelText("snapshot 1 attack beat");
    const numInput = screen.getByLabelText("snapshot 1 attack beat fraction numerator");
    const denInput = screen.getByLabelText("snapshot 1 attack beat fraction denominator");
    fireEvent.input(beatInput, { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.input(numInput, { currentTarget: { value: "1" }, target: { value: "1" } });
    fireEvent.input(denInput, { currentTarget: { value: "4" }, target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("commit snapshot 1 attack bar-relative timing"));

    expect(onUpdateSnapshot).toHaveBeenLastCalledWith(10, {
      notes: [expect.objectContaining({ id: "a", start: 0.3125, end: 1 })],
    });
  });

  it("commits edited bar time signatures through onUpdateBar", () => {
    const onUpdateBar = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 81, start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={onUpdateBar}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    const numeratorInput = screen.getByLabelText("bar 1 beats per bar");
    const denominatorInput = screen.getByLabelText("bar 1 beat unit");

    numeratorInput.value = "3";
    fireEvent.blur(numeratorInput);
    denominatorInput.value = "8";
    fireEvent.blur(denominatorInput);

    expect(onUpdateBar).toHaveBeenCalledWith(1, { numerator: 3 });
    expect(onUpdateBar).toHaveBeenCalledWith(1, { denominator: 8 });
  });

  it("rerenders bar time signatures when a loaded sequence reuses the same bar ids", () => {
    const props = {
      snapshots: [
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [{ id: "a", midicents: 81, start: 0, end: 1 }],
        },
      ],
      snapshotLabelMode: "labels",
      selectedSnapshotId: 10,
      selectedMarker: null,
      playingSnapshotId: null,
      playhead: { barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true },
      onTakeSnapshot: vi.fn(),
      onSetSnapshotLabelMode: vi.fn(),
      onSelectSnapshot: vi.fn(),
      onSelectMarker: vi.fn(),
      onPlaySnapshot: vi.fn(),
      onStopSnapshot: vi.fn(),
      onSelectSequenceBar: vi.fn(),
      onStepSequence: vi.fn(),
      onStepSequenceMarker: vi.fn(),
      onPlaySequence: vi.fn(),
      onPlayCue: vi.fn(),
      onResetSequencePlayhead: vi.fn(),
      onAddBar: vi.fn(),
      onAddBarsBeforeSnapshots: vi.fn(),
      onDeleteBar: vi.fn(),
      onUpdateBar: vi.fn(),
      onMoveBar: vi.fn(),
      onDeleteSnapshot: vi.fn(),
      onMoveSnapshot: vi.fn(),
      onUpdateSnapshot: vi.fn(),
      onResetSnapshotDescription: vi.fn(),
    };

    const { rerender } = render(
      <Sequencer
        {...props}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
      />,
    );

    expect(screen.getByLabelText("bar 1 beats per bar").value).toBe("4");
    expect(screen.getByLabelText("bar 1 beat unit").value).toBe("4");

    rerender(
      <Sequencer
        {...props}
        bars={[{ id: 1, position: 1, numerator: 3, denominator: 8 }]}
      />,
    );

    expect(screen.getByLabelText("bar 1 beats per bar").value).toBe("3");
    expect(screen.getByLabelText("bar 1 beat unit").value).toBe("8");
  });

  it("saves edited bar time signatures from the interface without requiring a separate blur step", () => {
    localStorage.clear();

    const Harness = () => {
      const [bars, setBars] = useState([{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 2, numerator: 4, denominator: 4 }]);
      return (
        <Sequencer
          snapshots={[
            {
              id: 10,
              length: 1,
              description: "A",
              notes: [{ id: "a", midicents: 81, start: 0, end: 1 }],
            },
          ]}
          bars={bars}
          tempi={[]}
          snapshotLabelMode="labels"
          selectedSnapshotId={10}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onLoadSequence={vi.fn()}
          onSequenceNameChange={vi.fn()}
          onSequenceDescriptionChange={vi.fn()}
          onSequenceLegatoChange={vi.fn()}
          onSequenceAutoCreateBarsChange={vi.fn()}
          onSetSnapshotLabelMode={vi.fn()}
          onSelectSnapshot={vi.fn()}
          onSelectMarker={vi.fn()}
          onPlaySnapshot={vi.fn()}
          onStopSnapshot={vi.fn()}
          onSelectSequenceBar={vi.fn()}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onResetSequencePlayhead={vi.fn()}
          onAddBar={vi.fn()}
          onAddTempo={vi.fn()}
          onAddBarsBeforeSnapshots={vi.fn()}
          onDeleteBar={vi.fn()}
          onDeleteTempo={vi.fn()}
          onUpdateBar={(id, updates) => {
            setBars((prev) => prev.map((bar) => (bar.id === id ? { ...bar, ...updates } : bar)));
          }}
          onUpdateTempo={vi.fn()}
          onMoveBar={vi.fn()}
          onDeleteSnapshot={vi.fn()}
          onMoveSnapshot={vi.fn()}
          onDuplicateSnapshot={vi.fn()}
          onUpdateSnapshot={vi.fn()}
          onResetSnapshotDescription={vi.fn()}
          activeSequenceName="Meter Test"
          activeSequenceDescription=""
          sequenceLegato
          sequenceAutoCreateBars
        />
      );
    };

    render(<Harness />);

    const bar2Numerator = screen.getByLabelText("bar 2 beats per bar");
    const bar2Denominator = screen.getByLabelText("bar 2 beat unit");
    fireEvent.input(bar2Numerator, { currentTarget: { value: "3" }, target: { value: "3" } });
    fireEvent.input(bar2Denominator, { currentTarget: { value: "2" }, target: { value: "2" } });

    fireEvent.click(screen.getByText("Save current sequence"));

    expect(loadUserSequences()[0].bars).toEqual([
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 3, denominator: 2 },
    ]);
  });

  it("renders imported bar signatures correctly after selecting a stored sequence from a fresh state", () => {
    localStorage.clear();
    localStorage.setItem("hexatone_user_sequences", JSON.stringify([
      {
        type: "hexatone-sequence",
        version: 3,
        name: "FALL",
        description: "",
        snapshotLabelMode: "proportion",
        autoCreateBars: true,
        transport: { unit: "sequence", anchorSeconds: 0 },
        tempi: [
          { id: 1, position: 1, bpm: 58, beatNumerator: 1, beatDenominator: 4, beatLength: 1 },
        ],
        snapshots: [
          { id: 1, length: 1, description: "a", notes: [] },
          { id: 2, length: 1, description: "b", notes: [] },
          { id: 3, length: 1, description: "c", notes: [] },
          { id: 4, length: 1, description: "d", notes: [] },
          { id: 5, length: 1, description: "e", notes: [] },
        ],
        bars: [
          { id: 1, position: 1, numerator: 1, denominator: 1 },
          { id: 2, position: 2, numerator: 3, denominator: 2 },
          { id: 4, position: 4, numerator: 9, denominator: 8 },
          { id: 5, position: 5, numerator: 9, denominator: 8 },
          { id: 6, position: 6, numerator: 3, denominator: 2 },
        ],
      },
    ]));

    const Harness = () => {
      const [snapshots, setSnapshots] = useState([]);
      const [bars, setBars] = useState(normalizeBarMarkers([{ id: 1, position: 1 }]));
      const [tempi, setTempi] = useState(normalizeTempoMarkers([{ id: 1, position: 1, bpm: 60, beatLength: 1 }]));
      const [snapshotLabelMode, setSnapshotLabelMode] = useState("labels");
      const [activeSequenceName, setActiveSequenceName] = useState("");
      const [activeSequenceDescription, setActiveSequenceDescription] = useState("");

      return (
        <Sequencer
          snapshots={snapshots}
          bars={bars}
          tempi={tempi}
          snapshotLabelMode={snapshotLabelMode}
          activeSequenceName={activeSequenceName}
          activeSequenceDescription={activeSequenceDescription}
          sequenceLegato
          sequenceAutoCreateBars
          selectedSnapshotId={null}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onLoadSequence={(sequence) => {
            setSnapshots(sequence.snapshots ?? []);
            setBars(normalizeBarMarkers(sequence.bars ?? []));
            setTempi(normalizeTempoMarkers(sequence.tempi ?? []));
            setSnapshotLabelMode(String(sequence?.snapshotLabelMode ?? "proportion"));
            setActiveSequenceName(String(sequence?.name ?? ""));
            setActiveSequenceDescription(String(sequence?.description ?? ""));
          }}
          onSequenceNameChange={setActiveSequenceName}
          onSequenceDescriptionChange={setActiveSequenceDescription}
          onSequenceLegatoChange={vi.fn()}
          onSequenceAutoCreateBarsChange={vi.fn()}
          onSetSnapshotLabelMode={setSnapshotLabelMode}
          onSelectSnapshot={vi.fn()}
          onSelectMarker={vi.fn()}
          onPlaySnapshot={vi.fn()}
          onStopSnapshot={vi.fn()}
          onSelectSequenceBar={vi.fn()}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onResetSequencePlayhead={vi.fn()}
          onAddBar={vi.fn()}
          onAddTempo={vi.fn()}
          onAddBarsBeforeSnapshots={vi.fn()}
          onDeleteBar={vi.fn()}
          onDeleteTempo={vi.fn()}
          onUpdateBar={vi.fn()}
          onUpdateTempo={vi.fn()}
          onMoveBar={vi.fn()}
          onDeleteSnapshot={vi.fn()}
          onMoveSnapshot={vi.fn()}
          onDuplicateSnapshot={vi.fn()}
          onUpdateSnapshot={vi.fn()}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    render(<Harness />);

    fireEvent.change(screen.getAllByRole("combobox")[0], {
      currentTarget: { value: "FALL" },
      target: { value: "FALL" },
    });

    expect(screen.getByLabelText("bar 1 beats per bar").value).toBe("1");
    expect(screen.getByLabelText("bar 1 beat unit").value).toBe("1");
    expect(screen.getByLabelText("bar 2 beats per bar").value).toBe("3");
    expect(screen.getByLabelText("bar 2 beat unit").value).toBe("2");
  });

  it("resets the fractional offset when the user changes beat", () => {
    const onUpdateSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              {
                id: "a",
                midicents: 81,
                start: 0,
                end: 1,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 2, numerator: 4, denominator: 4 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    const beatInput = screen.getByLabelText("snapshot 1 attack beat");
    const numInput = screen.getByLabelText("snapshot 1 attack beat fraction numerator");
    const denInput = screen.getByLabelText("snapshot 1 attack beat fraction denominator");

    fireEvent.input(numInput, { currentTarget: { value: "1" }, target: { value: "1" } });
    fireEvent.input(denInput, { currentTarget: { value: "1" }, target: { value: "1" } });
    fireEvent.input(beatInput, { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("commit snapshot 1 attack bar-relative timing"));

    expect(onUpdateSnapshot).toHaveBeenLastCalledWith(10, {
      notes: [expect.objectContaining({ id: "a", start: 0.25, end: 1 })],
    });
  });

  it("resets beat and fraction to the start of the selected bar", () => {
    const onUpdateSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              {
                id: "a",
                midicents: 81,
                start: 0,
                end: 1,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 2, numerator: 4, denominator: 4 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    const barInput = screen.getByLabelText("snapshot 1 attack bar");
    const beatInput = screen.getByLabelText("snapshot 1 attack beat");
    const numInput = screen.getByLabelText("snapshot 1 attack beat fraction numerator");
    const denInput = screen.getByLabelText("snapshot 1 attack beat fraction denominator");

    fireEvent.input(beatInput, { currentTarget: { value: "3" }, target: { value: "3" } });
    fireEvent.input(numInput, { currentTarget: { value: "1" }, target: { value: "1" } });
    fireEvent.input(denInput, { currentTarget: { value: "4" }, target: { value: "4" } });
    fireEvent.input(barInput, { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("commit snapshot 1 attack bar-relative timing"));

    expect(onUpdateSnapshot).toHaveBeenLastCalledWith(10, {
      notes: [expect.objectContaining({ id: "a", start: 1, end: 1 })],
    });
  });

  it("holds bar-relative edits in a draft until the user explicitly commits them", () => {
    const onUpdateSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              {
                id: "a",
                midicents: 81,
                start: 0,
                end: 1,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 2, numerator: 3, denominator: 2 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    const attackBar = screen.getByLabelText("snapshot 1 attack bar");
    const attackBeat = screen.getByLabelText("snapshot 1 attack beat");
    const attackNum = screen.getByLabelText("snapshot 1 attack beat fraction numerator");
    const attackDen = screen.getByLabelText("snapshot 1 attack beat fraction denominator");

    fireEvent.focus(attackBar);
    fireEvent.input(attackBar, { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.input(attackBeat, { currentTarget: { value: "3" }, target: { value: "3" } });
    fireEvent.input(attackNum, { currentTarget: { value: "0" }, target: { value: "0" } });
    fireEvent.input(attackDen, { currentTarget: { value: "1" }, target: { value: "1" } });

    expect(onUpdateSnapshot).not.toHaveBeenCalled();
    expect(attackBar.value).toBe("2");
    expect(attackBeat.value).toBe("3");

    fireEvent.click(screen.getByLabelText("cancel snapshot 1 attack bar-relative timing"));
    expect(onUpdateSnapshot).not.toHaveBeenCalled();
    expect(screen.getByLabelText("snapshot 1 attack bar").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 attack beat").value).toBe("1");

    fireEvent.focus(screen.getByLabelText("snapshot 1 attack bar"));
    fireEvent.input(screen.getByLabelText("snapshot 1 attack bar"), { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.input(screen.getByLabelText("snapshot 1 attack beat"), { currentTarget: { value: "3" }, target: { value: "3" } });

    fireEvent.click(screen.getByLabelText("commit snapshot 1 attack bar-relative timing"));
    expect(onUpdateSnapshot).toHaveBeenLastCalledWith(10, {
      notes: [expect.objectContaining({ id: "a", start: 1.666667, end: 1.666667, startFractionDenominator: 1 })],
    });
  });

  it("keeps a bar-relative draft open within the same row and auto-commits when the user clicks another row", () => {
    const onUpdateSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 81, start: 0, end: 1 },
              { id: "b", midicents: 76, start: 0.5, end: 1 },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 2, numerator: 3, denominator: 2 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    fireEvent.input(screen.getAllByLabelText("snapshot 1 attack bar")[0], { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.input(screen.getAllByLabelText("snapshot 1 attack beat")[0], { currentTarget: { value: "3" }, target: { value: "3" } });

    fireEvent.mouseDown(screen.getAllByLabelText("snapshot 1 attack frequency")[0]);
    expect(onUpdateSnapshot).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getAllByLabelText("snapshot 1 release frequency")[0]);
    expect(onUpdateSnapshot).toHaveBeenLastCalledWith(10, {
      notes: [
        expect.objectContaining({ id: "a", start: 1.666667, end: 1.666667, startFractionDenominator: 1 }),
        expect.objectContaining({ id: "b" }),
      ],
    });
  });

  it("rerenders cue markers when a position edit creates a new cue", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A, F",
          notes: [
            { id: "a", midicents: 81, start: 0, end: 1 },
            { id: "b", midicents: 76, start: 0, end: 1 },
          ],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={10}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onSetSnapshotLabelMode={vi.fn()}
          onSelectSnapshot={vi.fn()}
          onSelectMarker={vi.fn()}
          onPlaySnapshot={vi.fn()}
          onStopSnapshot={vi.fn()}
          onSelectSequenceBar={vi.fn()}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onResetSequencePlayhead={vi.fn()}
          onAddBar={vi.fn()}
          onAddBarsBeforeSnapshots={vi.fn()}
          onDeleteBar={vi.fn()}
          onUpdateBar={vi.fn()}
          onMoveBar={vi.fn()}
          onDeleteSnapshot={vi.fn()}
          onMoveSnapshot={vi.fn()}
          onUpdateSnapshot={(id, updates) => {
            setSnapshots((prev) => prev.map((snapshot) => (
              snapshot.id === id ? { ...snapshot, ...updates } : snapshot
            )));
          }}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    const { container } = render(<Harness />);

    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2"]);

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack position");
    fireEvent.focus(positionInputs[1]);
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "1.100" },
      target: { value: "1.100" },
    });
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });
    fireEvent.blur(positionInputs[1], {
      currentTarget: { value: "1.100" },
      target: { value: "1.100" },
    });

    expect([...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value))
      .toEqual(["1.000000", "1.000000", "1.100000", "2.000000", "2.000000"]);
    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2", "3"]);
  });

  it("commits a position edit on Enter and regenerates cue numbering", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A, F",
          notes: [
            { id: "a", midicents: 81, start: 0, end: 1 },
            { id: "b", midicents: 76, start: 0, end: 1 },
          ],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={10}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onSetSnapshotLabelMode={vi.fn()}
          onSelectSnapshot={vi.fn()}
          onSelectMarker={vi.fn()}
          onPlaySnapshot={vi.fn()}
          onStopSnapshot={vi.fn()}
          onSelectSequenceBar={vi.fn()}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onResetSequencePlayhead={vi.fn()}
          onAddBar={vi.fn()}
          onAddBarsBeforeSnapshots={vi.fn()}
          onDeleteBar={vi.fn()}
          onUpdateBar={vi.fn()}
          onMoveBar={vi.fn()}
          onDeleteSnapshot={vi.fn()}
          onMoveSnapshot={vi.fn()}
          onUpdateSnapshot={(id, updates) => {
            setSnapshots((prev) => prev.map((snapshot) => (
              snapshot.id === id ? { ...snapshot, ...updates } : snapshot
            )));
          }}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    const { container } = render(<Harness />);

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack position");
    positionInputs[1].focus();
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "1.100" },
      target: { value: "1.100" },
    });
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });

    expect([...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value))
      .toEqual(["1.000000", "1.000000", "1.100000", "2.000000", "2.000000"]);
    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2", "3"]);
  });

  it("commits position edits for captured snapshot notes that do not have ids", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "Captured",
          notes: [
            { midicents: 81, start: 0, end: 1, attackVelocity: 90, releaseVelocity: 30 },
            { midicents: 76, start: 0, end: 1, attackVelocity: 80, releaseVelocity: 20 },
            { midicents: 72, start: 0, end: 1, attackVelocity: 70, releaseVelocity: 10 },
          ],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={10}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onSetSnapshotLabelMode={vi.fn()}
          onSelectSnapshot={vi.fn()}
          onSelectMarker={vi.fn()}
          onPlaySnapshot={vi.fn()}
          onStopSnapshot={vi.fn()}
          onSelectSequenceBar={vi.fn()}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onResetSequencePlayhead={vi.fn()}
          onAddBar={vi.fn()}
          onAddBarsBeforeSnapshots={vi.fn()}
          onDeleteBar={vi.fn()}
          onUpdateBar={vi.fn()}
          onMoveBar={vi.fn()}
          onDeleteSnapshot={vi.fn()}
          onMoveSnapshot={vi.fn()}
          onUpdateSnapshot={(id, updates) => {
            setSnapshots((prev) => prev.map((snapshot) => (
              snapshot.id === id ? { ...snapshot, ...updates } : snapshot
            )));
          }}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    const { container } = render(<Harness />);

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack position");
    positionInputs[1].focus();
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "1.200" },
      target: { value: "1.200" },
    });
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });

    expect([...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value))
      .toEqual(["1.000000", "1.000000", "1.000000", "1.200000", "2.000000", "2.000000", "2.000000"]);
    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2", "3"]);
  });

  it("keeps the last cue number visible at the terminal snapshot end slot", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              {
                id: "a",
                midicents: 69,
                start: 0,
                end: 1,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 1, markerIndex: 1, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    expect(screen.getByText("end")).not.toBeNull();
    expect(screen.getAllByText("2")[0]).not.toBeNull();
    expect(screen.getByLabelText("next sequence step").disabled).toBe(true);
  });

  it("shows the next snapshot and cue in brackets when a bar is selected", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 69, start: 0, end: 1 }],
          },
          {
            id: 11,
            length: 1,
            description: "B",
            notes: [{ id: "b", midicents: 71, start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={null}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 1, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    const statuses = screen.getAllByText(/\((?:\d+)\)/);
    expect(statuses.map((node) => node.textContent)).toEqual(["(2)", "(2)"]);
  });


  it("adds a bar at the requested position", () => {
    const onAddBar = vi.fn();
    const onAddBarsBeforeSnapshots = vi.fn();

    render(
      <Sequencer
        snapshots={[]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={null}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={onAddBar}
        onAddBarsBeforeSnapshots={onAddBarsBeforeSnapshots}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceDescription=""
        sequenceLegato
      />,
    );

    fireEvent.input(screen.getByLabelText("new bar position"), {
      currentTarget: { value: "2.5" },
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByText("Add Bar"));
    expect(onAddBar).toHaveBeenCalledWith(2.5);

    fireEvent.click(screen.getByRole("button", { name: "Add Bars Before Snapshots" }));
    expect(onAddBarsBeforeSnapshots).toHaveBeenCalledTimes(1);
  });

  it("renders non-integer bars inside the expanded snapshot event flow", () => {
    const { container } = render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 0, end: 1 },
              { id: "b", midicents: 72, start: 0.75, end: 1 },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 1.5 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceDescription=""
        sequenceLegato
      />,
    );

    expect(screen.getByLabelText("bar 1 position").value).toBe("1.000000");
    expect(screen.getByLabelText("bar 2 position").value).toBe("1.500000");

    const expandedTimes = [...container.querySelectorAll(".sequencer-events-grid .sequencer-event__position")]
      .map((node) => node.value);
    expect(expandedTimes).toEqual(["1.000000", "1.500000", "1.750000", "2.000000", "2.000000"]);
  });

  it("wraps mid-snapshot tempo rows in the structural bar wrapper inside the expanded event flow", () => {
    const { container } = render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 0, end: 1 },
              { id: "b", midicents: 72, start: 0.75, end: 1 },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatLength: 1 }, { id: 2, position: 1.5, bpm: 72, beatLength: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddTempo={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onDeleteTempo={vi.fn()}
        onUpdateBar={vi.fn()}
        onUpdateTempo={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceDescription=""
        sequenceLegato
      />,
    );

    expect(container.querySelector(".sequencer-events-grid__body .sequencer-item--bar .sequencer-tempo-row")).not.toBeNull();
  });

  it("holds tempo bar-relative edits in a draft until the user explicitly commits them", () => {
    const onUpdateTempo = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 69, start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }, { id: 2, position: 2, numerator: 3, denominator: 2 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddTempo={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onDeleteTempo={vi.fn()}
        onUpdateBar={vi.fn()}
        onUpdateTempo={onUpdateTempo}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceDescription=""
        sequenceLegato
      />,
    );

    const tempoBar = screen.getByLabelText("tempo bar");
    const tempoBeat = screen.getByLabelText("tempo beat");

    fireEvent.input(tempoBar, { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.input(tempoBeat, { currentTarget: { value: "3" }, target: { value: "3" } });

    expect(onUpdateTempo).not.toHaveBeenCalled();
    expect(screen.getByLabelText("tempo bar").value).toBe("2");
    expect(screen.getByLabelText("tempo beat").value).toBe("3");

    fireEvent.click(screen.getByLabelText("cancel tempo bar-relative timing"));
    expect(onUpdateTempo).not.toHaveBeenCalled();
    expect(screen.getByLabelText("tempo bar").value).toBe("1");
    expect(screen.getByLabelText("tempo beat").value).toBe("1");

    fireEvent.input(screen.getByLabelText("tempo bar"), { currentTarget: { value: "2" }, target: { value: "2" } });
    fireEvent.input(screen.getByLabelText("tempo beat"), { currentTarget: { value: "3" }, target: { value: "3" } });

    fireEvent.click(screen.getByLabelText("commit tempo bar-relative timing"));
    expect(onUpdateTempo).toHaveBeenLastCalledWith(1, { position: 2.666667 });
  });

  it("renders a whole-position bar inside the expanded snapshot flow ahead of the coincident note event", () => {
    const { container } = render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 1, end: 1 },
            ],
          },
          {
            id: 11,
            length: 1,
            description: "B",
            notes: [
              { id: "b", midicents: 72, start: 0, end: 1 },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceDescription=""
        sequenceLegato
      />,
    );

    const body = container.querySelector(".sequencer-events-grid__body");
    expect(body.children[0].querySelector(".sequencer-bar-row")).not.toBeNull();
    expect(body.children[1].classList.contains("sequencer-event-row")).toBe(true);
  });

  it("defaults the new bar position to the selected cue start", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 69, start: 0, end: 1 }],
          },
          {
            id: 11,
            length: 1,
            description: "B",
            notes: [{ id: "b", midicents: 72, start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={11}
        selectedMarker={{ snapshotId: 11, time: 0 }}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 1, markerIndex: 1, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onUpdateBar={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceDescription=""
        sequenceLegato
      />,
    );

    expect(screen.getByLabelText("new bar position").value).toBe("2.000000");
  });

  it("hides delete buttons for the always-on anchor bar and tempo marker", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 69, start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatLength: 1 }, { id: 2, position: 2, bpm: 72, beatLength: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onAddBar={vi.fn()}
        onAddTempo={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onDeleteTempo={vi.fn()}
        onUpdateBar={vi.fn()}
        onUpdateTempo={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceDescription=""
        sequenceLegato
      />,
    );

    expect(screen.queryByLabelText("delete bar 1")).toBeNull();
    expect(screen.getByLabelText("delete bar 2")).not.toBeNull();
    expect(screen.queryAllByLabelText("delete tempo marker")).toHaveLength(1);
  });
});
