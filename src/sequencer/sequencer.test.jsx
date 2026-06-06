import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import Sequencer from "./sequencer.jsx";

describe("Sequencer", () => {
  it("renders snapshots as auto-numbered rows and expands derived event groups", () => {
    const onSelectSnapshot = vi.fn();
    const onSelectMarker = vi.fn();
    const onUpdateSnapshot = vi.fn();

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
        playingSnapshotId={null}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={onSelectSnapshot}
        onSelectMarker={onSelectMarker}
        onPlaySnapshot={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onUpdateSnapshot={onUpdateSnapshot}
      />,
    );

    expect(screen.getByLabelText("snapshot 1 description").value).toBe("A, F");
    expect(screen.getByLabelText("Snapshot Labels").value).toBe("labels");
    fireEvent.click(screen.getByText("2 notes"));

    expect(onSelectSnapshot).toHaveBeenCalledWith(10);
    const eventTimes = [...container.querySelectorAll(".sequencer-event__time")].map((node) => node.textContent);
    expect(eventTimes).toEqual(["1.000", "1.500", "2.000", "2.000"]);
    expect(screen.getByText("Position")).not.toBeNull();
    expect(screen.getByText("MIDI¢")).not.toBeNull();
    expect(screen.getAllByText("81.000")).toHaveLength(2);
    expect(screen.getAllByText("880.00")).toHaveLength(2);
    expect(screen.getAllByText("on")).toHaveLength(2);
    expect(screen.getAllByText("off")).toHaveLength(2);

    fireEvent.click(container.querySelectorAll(".sequencer-event")[1]);
    expect(onSelectMarker).toHaveBeenCalledWith(10, 0.5);

    fireEvent.input(screen.getByLabelText("snapshot 1 description"), {
      currentTarget: { value: "Edited" },
      target: { value: "Edited" },
    });
    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, { description: "Edited" });
  });
});
