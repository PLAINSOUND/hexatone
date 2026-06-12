import { useState } from "preact/hooks";
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import Sequencer from "./sequencer.jsx";

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
    expect(eventTimes).toEqual(["1.000", "1.000", "1.500", "2.000", "2.000", "2.000"]);
    const cueNumbers = [...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent);
    expect(cueNumbers).toEqual(["1", "2", "3"]);
    expect(screen.getByText("Position")).not.toBeNull();
    expect(screen.getByLabelText("bar 1 position").value).toBe("1.000");
    expect(screen.getByLabelText("bar 2 position").value).toBe("2.000");
    expect(screen.getByText("MIDI¢")).not.toBeNull();
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 release midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).toBe("880.0");
    expect(screen.getAllByLabelText("snapshot 1 release frequency")[0].value).toBe("880.0");
    expect(screen.getAllByText("on")).toHaveLength(2);
    expect(screen.getAllByText("off")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("play cue 1"));
    expect(onPlayCue).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByText("2 notes"));
    expect(container.querySelector(".sequencer-events-grid")).toBeNull();

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
      .toEqual(["1.000", "1.000", "1.100", "2.000", "2.000"]);
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
      .toEqual(["1.000", "1.000", "1.100", "2.000", "2.000"]);
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
      .toEqual(["1.000", "1.000", "1.000", "1.200", "2.000", "2.000", "2.000"]);
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

    expect(screen.getByLabelText("bar 1 position").value).toBe("1.000");
    expect(screen.getByLabelText("bar 2 position").value).toBe("1.500");

    const expandedTimes = [...container.querySelectorAll(".sequencer-events-grid .sequencer-event__position")]
      .map((node) => node.value);
    expect(expandedTimes).toEqual(["1.000", "1.500", "1.750", "2.000", "2.000"]);
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

    expect(screen.getByLabelText("new bar position").value).toBe("2.000");
  });
});
