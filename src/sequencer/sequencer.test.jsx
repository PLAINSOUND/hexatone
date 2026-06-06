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
        onResetSequencePlayhead={onResetSequencePlayhead}
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
    fireEvent.click(screen.getByText("2 notes"));

    expect(onSelectSnapshot).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getByLabelText("play snapshot 1"));
    expect(onPlaySnapshot).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getByLabelText("stop snapshot 1"));
    expect(onStopSnapshot).toHaveBeenCalledWith(10);

    const eventTimes = [...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value);
    expect(eventTimes).toEqual(["1.000", "1.500", "2.000", "2.000"]);
    expect(screen.getByText("Position")).not.toBeNull();
    expect(screen.getByText("MIDI¢")).not.toBeNull();
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 release midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).toBe("880.00");
    expect(screen.getAllByLabelText("snapshot 1 release frequency")[0].value).toBe("880.00");
    expect(screen.getAllByText("on")).toHaveLength(2);
    expect(screen.getAllByText("off")).toHaveLength(2);

    fireEvent.click(screen.getByText("2 notes"));
    expect(container.querySelector(".sequencer-events-table")).toBeNull();

    fireEvent.click(screen.getByText("2 notes"));

    fireEvent.click(container.querySelectorAll(".sequencer-event")[1]);
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

    fireEvent.input(screen.getByLabelText("snapshot 1 description"), {
      currentTarget: { value: "Edited" },
      target: { value: "Edited" },
    });
    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, { description: "Edited" });

    fireEvent.click(screen.getByLabelText("reset snapshot 1 description"));
    expect(onResetSnapshotDescription).toHaveBeenCalledWith(10);
  });

  it("renders the terminal end slot in the playback strip", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A, F",
            notes: [],
          },
        ]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 1, markerIndex: null, stopped: true }}
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
        onResetSequencePlayhead={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    expect(screen.getAllByText("end")).toHaveLength(2);
    expect(screen.getByLabelText("next sequence step").disabled).toBe(true);
  });
});
