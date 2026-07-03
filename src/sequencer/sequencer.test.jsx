import { useState } from "preact/hooks";
import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import Sequencer from "./sequencer.jsx";
import { loadUserSequences } from "./sequence-library.jsx";
import { normalizeBarMarkers, normalizeTempoMarkers } from "./transport.js";

describe("Sequencer", () => {
  it("keeps cue stepping anchored to the earliest sounding snapshot in full-list view", () => {
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const raf = vi.fn((callback) => {
      callback();
      return 1;
    });
    const cancelRaf = vi.fn();
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = cancelRaf;
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancelRaf;

    const baseProps = {
      bars: [{ id: 1, position: 1 }],
      snapshotLabelMode: "labels",
      selectedSnapshotId: 11,
      selectedMarker: null,
      playingSnapshotId: 11,
      onTakeSnapshot: vi.fn(),
      onLoadSequence: vi.fn(),
      onSequenceNameChange: vi.fn(),
      onSequenceDescriptionChange: vi.fn(),
      onSequenceLegatoChange: vi.fn(),
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
      onAddTempo: vi.fn(),
      onAddBarsBeforeSnapshots: vi.fn(),
      onDeleteBar: vi.fn(),
      onDeleteTempo: vi.fn(),
      onUpdateBar: vi.fn(),
      onUpdateTempo: vi.fn(),
      onMoveBar: vi.fn(),
      onDeleteSnapshot: vi.fn(),
      onMoveSnapshot: vi.fn(),
      onUpdateSnapshot: vi.fn(),
      onResetSnapshotDescription: vi.fn(),
      activeSequenceName: "",
      activeSequenceDescription: "",
      sequenceLegato: true,
      snapshots: [
        {
          id: 10,
          length: 2,
          description: "carry",
          notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1.25 }],
        },
        {
          id: 11,
          length: 1,
          description: "arrival",
          notes: [{ id: "b", midicents: 72, displayLabel: "C", start: 0.25, end: 1 }],
        },
      ],
    };

    const { container, rerender } = render(
      <Sequencer
        {...baseProps}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: false }}
      />,
    );

    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(scrollPanel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollPanel, "scrollHeight", { configurable: true, value: 1000 });
    let scrollTopValue = 0;
    Object.defineProperty(scrollPanel, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollTopValue = value;
      },
    });
    scrollPanel.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200 });

    const eventRows = container.querySelectorAll(".sequencer-event-row");
    eventRows[0].getBoundingClientRect = () => ({ top: 120, bottom: 150, left: 0, right: 0, width: 0, height: 30 });
    eventRows[1].getBoundingClientRect = () => ({ top: 320, bottom: 350, left: 0, right: 0, width: 0, height: 30 });
    eventRows[2].getBoundingClientRect = () => ({ top: 680, bottom: 710, left: 0, right: 0, width: 0, height: 30 });

    rerender(
      <Sequencer
        {...baseProps}
        playhead={{ barIndex: 0, stepIndex: 1, markerIndex: 1, stopped: false }}
      />,
    );

    expect(scrollTopValue).toBe(0);

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  it("auto-scrolls to the selected snapshot row when a pending snapshot target is chosen", () => {
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const raf = vi.fn((callback) => {
      callback();
      return 1;
    });
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = vi.fn();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame;

    const { container } = render(
      <Sequencer
        snapshots={[
          { id: 10, length: 1, description: "A", notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] },
          { id: 11, length: 1, description: "B", notes: [{ id: "b", midicents: 72, start: 0, end: 1 }] },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
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

    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(scrollPanel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollPanel, "scrollHeight", { configurable: true, value: 1000 });
    let scrollTopValue = 0;
    Object.defineProperty(scrollPanel, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollTopValue = value;
      },
    });
    scrollPanel.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200 });

    const snapshotRows = container.querySelectorAll(".sequencer-item:not(.sequencer-item--bar)");
    snapshotRows[0].getBoundingClientRect = () => ({ top: 60, bottom: 90, left: 0, right: 0, width: 0, height: 30 });
    snapshotRows[1].getBoundingClientRect = () => ({ top: 240, bottom: 270, left: 0, right: 0, width: 0, height: 30 });

    fireEvent.change(screen.getByLabelText("next snapshot target"), { target: { value: "1" } });

    expect(scrollTopValue).toBe(234);

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  it("keeps pending cue selection anchored to the earliest sounding snapshot in full-list view", () => {
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const raf = vi.fn((callback) => {
      callback();
      return 1;
    });
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = vi.fn();
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame;

    const { container } = render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 2,
            description: "carry",
            notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1.25 }],
          },
          {
            id: 11,
            length: 1,
            description: "arrival",
            notes: [{ id: "b", midicents: 72, displayLabel: "C", start: 0.25, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
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

    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(scrollPanel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollPanel, "scrollHeight", { configurable: true, value: 1000 });
    let scrollTopValue = 0;
    Object.defineProperty(scrollPanel, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollTopValue = value;
      },
    });
    scrollPanel.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200 });

    const eventRows = container.querySelectorAll(".sequencer-event-row");
    eventRows[0].getBoundingClientRect = () => ({ top: 120, bottom: 150, left: 0, right: 0, width: 0, height: 30 });
    eventRows[1].getBoundingClientRect = () => ({ top: 320, bottom: 350, left: 0, right: 0, width: 0, height: 30 });
    eventRows[2].getBoundingClientRect = () => ({ top: 680, bottom: 710, left: 0, right: 0, width: 0, height: 30 });

    fireEvent.change(screen.getByLabelText("next cue target"), { target: { value: "1" } });

    expect(scrollTopValue).toBe(0);

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  it("keeps all relevant snapshots expanded in closed view while cue playback spans multiple snapshots", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 2,
            description: "carry",
            notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1.25 }],
          },
          {
            id: 11,
            length: 1,
            description: "arrival",
            notes: [{ id: "b", midicents: 72, displayLabel: "C", start: 0.25, end: 1 }],
          },
          {
            id: 12,
            length: 1,
            description: "later",
            notes: [{ id: "c", midicents: 76, displayLabel: "E", start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={11}
        selectedMarker={null}
        playingSnapshotId={11}
        playhead={{ barIndex: 0, stepIndex: 1, markerIndex: 1, stopped: false }}
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

    fireEvent.click(screen.getByTitle("Collapse to snapshot view"));

    expect(screen.queryByLabelText("snapshot 1 events")).toBeNull();
    expect(screen.getByLabelText("snapshot 2 events")).toBeTruthy();
    expect(screen.queryByLabelText("snapshot 3 events")).toBeNull();
  });

  it("previews all relevant snapshots in closed view when a cue is lined up", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 2,
            description: "carry",
            notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1.25 }],
          },
          {
            id: 11,
            length: 1,
            description: "arrival",
            notes: [{ id: "b", midicents: 72, displayLabel: "C", start: 0.25, end: 1 }],
          },
          {
            id: 12,
            length: 1,
            description: "later",
            notes: [{ id: "c", midicents: 76, displayLabel: "E", start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={11}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 1, markerIndex: null, stopped: true }}
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

    fireEvent.click(screen.getByTitle("Collapse to snapshot view"));
    fireEvent.change(screen.getByLabelText("next cue target"), { target: { value: "1" } });

    expect(screen.queryByLabelText("snapshot 1 events")).toBeNull();
    expect(screen.getByLabelText("snapshot 2 events")).toBeTruthy();
    expect(screen.queryByLabelText("snapshot 3 events")).toBeNull();
  });

  it("hides sequence setup and edit controls in collapsed playback view", () => {
    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
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

    fireEvent.click(screen.getByTitle("Collapse to snapshot view"));

    expect(screen.queryByText("Snapshot Labels")).toBeNull();
    expect(screen.queryByText("Choose Tempo Position")).toBeNull();
    expect(screen.queryByText("Choose Bar Position")).toBeNull();
    expect(screen.queryByText("Auto-Create Bars")).toBeNull();
    expect(screen.queryByText("Legato")).toBeNull();
    expect(screen.queryByText("Clear Sequence")).toBeNull();
  });

  it("keeps the standard two event panes in phone portrait mode", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === "(max-width: 480px) and (orientation: portrait)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    try {
      render(
        <Sequencer
          snapshots={[
            {
              id: 10,
              length: 1,
              description: "A",
              notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1 }],
            },
          ]}
          bars={[{ id: 1, position: 1 }]}
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

      expect(screen.getAllByText("Bar").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Num").length).toBeGreaterThan(0);
      expect(screen.getByLabelText("show expression controls")).toBeTruthy();

      fireEvent.click(screen.getByLabelText("show expression controls"));
      expect(screen.getAllByText("v-on").length).toBeGreaterThan(0);
      expect(screen.getByLabelText("show bar-relative timing")).toBeTruthy();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

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
    fireEvent.mouseDown(screen.getByLabelText("next sequence marker"));
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

    expect(screen.getAllByLabelText("snapshot 1 attack snapshot")[0].value).toBe("1");
    expect(screen.getAllByLabelText("snapshot 1 attack offset")[0].value).toBe("0.000");
    expect(screen.getAllByLabelText("snapshot 1 release offset")[0].value).toBe("1.000");
    const cueNumbers = [...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent);
    expect(cueNumbers).toEqual(["1", "2", "3"]);
    expect(screen.getByText("Offset")).not.toBeNull();
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

    fireEvent.input(screen.getAllByLabelText("snapshot 1 attack offset")[0], {
      currentTarget: { value: "0.250000" },
      target: { value: "0.250000" },
    });
    fireEvent.click(screen.getAllByLabelText("commit snapshot 1 attack sequence placement")[0]);
    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, {
      notes: [
        expect.objectContaining({ id: "a", start: 0.25, end: 1 }),
        expect.objectContaining({ id: "b", start: 0.5, end: 1 }),
      ],
    });

    fireEvent.input(screen.getAllByLabelText("snapshot 1 release offset")[0], {
      currentTarget: { value: "1.250000" },
      target: { value: "1.250000" },
    });
    fireEvent.click(screen.getAllByLabelText("commit snapshot 1 release sequence placement")[0]);
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

  it("lights only currently sounding attack rows during cue playback", () => {
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
                end: 1.25,
              },
              {
                id: "b",
                midicents: 76,
                displayLabel: "F",
                start: 0.5,
                end: 1,
              },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        tempi={[]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={10}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: 1, stopped: false }}
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
      />,
    );

    const kindCells = [...container.querySelectorAll(".sequencer-event__kind")].map((node) => node.classList.contains("sequencer-event__kind--active"));
    expect(kindCells).toEqual([true, true, false, false]);
  });

  it("does not mark the name as edited when MIDI¢ is focused and blurred unchanged", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [
            {
              id: "a",
              midicents: 69.1234567,
              displayLabel: "A",
              start: 0,
              end: 1,
            },
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
          onUpdateSnapshot={(id, updates) => {
            setSnapshots((prev) => prev.map((snapshot) => (
              snapshot.id === id ? { ...snapshot, ...updates } : snapshot
            )));
          }}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    render(<Harness />);

    const midicentsInput = screen.getAllByLabelText("snapshot 1 attack midicents")[0];
    fireEvent.focus(midicentsInput);
    fireEvent.blur(midicentsInput, {
      currentTarget: { value: "69.123457" },
      target: { value: "69.123457" },
    });

    expect(screen.queryByText("edited")).toBeNull();
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
  });

  it("commits a focused position edit before cue stepping", async () => {
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

    const attackPosition = screen.getByLabelText("snapshot 1 attack offset");
    attackPosition.focus();
    expect(document.activeElement).toBe(attackPosition);
    fireEvent.input(attackPosition, {
      currentTarget: { value: "0.250000" },
      target: { value: "0.250000" },
    });

    fireEvent.click(await screen.findByLabelText("commit snapshot 1 attack sequence placement"));
    fireEvent.click(screen.getByLabelText("next sequence marker"));

    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, {
      notes: [expect.objectContaining({ id: "a", start: 0.25, end: 1 })],
    });
  });

  it("clears all snapshots from the snapshot section after confirmation", () => {
    const onDeleteAllSnapshots = vi.fn();

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
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
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
        onAddTempo={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onDeleteTempo={vi.fn()}
        onUpdateBar={vi.fn()}
        onUpdateTempo={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onDeleteAllSnapshots={onDeleteAllSnapshots}
        onMoveSnapshot={vi.fn()}
        onDuplicateSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Clear All"));
    expect(screen.getByText("Clear all snapshots?")).not.toBeNull();

    fireEvent.click(screen.getByText("Yes, clear"));
    expect(onDeleteAllSnapshots).toHaveBeenCalledTimes(1);
  });

  it("updates the bar selector when a snapshot or cue target is chosen", () => {
    const onSelectSequenceBar = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 0, end: 1 },
            ],
          },
          {
            id: 11,
            length: 1,
            description: "B",
            notes: [
              { id: "b", midicents: 71, start: 0.5, end: 1 },
            ],
          },
        ]}
        bars={[
          { id: 1, position: 1, numerator: 4, denominator: 4 },
          { id: 2, position: 2, numerator: 4, denominator: 4 },
        ]}
        snapshotLabelMode="labels"
        selectedSnapshotId={null}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={onSelectSequenceBar}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onJumpSequenceSnapshot={vi.fn()}
        onJumpSequenceCue={vi.fn()}
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

    fireEvent.change(screen.getByLabelText("next snapshot target"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    expect(onSelectSequenceBar).toHaveBeenLastCalledWith(1);

    fireEvent.change(screen.getByLabelText("next cue target"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    expect(onSelectSequenceBar).toHaveBeenLastCalledWith(1);
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

  it("allows bar 1 to commit a stopped 0/n time signature", () => {
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

    numeratorInput.value = "0";
    fireEvent.blur(numeratorInput);
    denominatorInput.value = "4";
    fireEvent.blur(denominatorInput);

    expect(onUpdateBar).toHaveBeenCalledWith(1, { numerator: 0 });
    expect(onUpdateBar).toHaveBeenCalledWith(1, { denominator: 4 });
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
    window.confirm = vi.fn(() => true);
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
      const [activeSequenceSavedName, setActiveSequenceSavedName] = useState("");
      const [activeSequenceDescription, setActiveSequenceDescription] = useState("");

      return (
        <Sequencer
          snapshots={snapshots}
          bars={bars}
          tempi={tempi}
          snapshotLabelMode={snapshotLabelMode}
          activeSequenceName={activeSequenceName}
          activeSequenceSavedName={activeSequenceSavedName}
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
            setActiveSequenceSavedName(String(sequence?.name ?? ""));
            setActiveSequenceDescription(String(sequence?.description ?? ""));
          }}
          onSequenceNameChange={(value) => {
            const nextName = String(value ?? "");
            const trimmed = nextName.trim();
            setActiveSequenceName(nextName);
            setActiveSequenceSavedName((current) => (current && current === trimmed ? current : ""));
          }}
          onSequenceDescriptionChange={setActiveSequenceDescription}
          onSequenceSaved={(name) => {
            const nextName = String(name ?? "").trim();
            setActiveSequenceName(nextName);
            setActiveSequenceSavedName(nextName);
          }}
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

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack offset");
    fireEvent.focus(positionInputs[1]);
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "0.100000" },
      target: { value: "0.100000" },
    });
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });

    expect([...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value))
      .toEqual(["1.000000", "0.000", "0.100", "1.000", "1.000"]);
    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2"]);
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

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack offset");
    positionInputs[1].focus();
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "0.100000" },
      target: { value: "0.100000" },
    });
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });

    expect([...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value))
      .toEqual(["1.000000", "0.000", "0.100", "1.000", "1.000"]);
    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2"]);
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

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack offset");
    positionInputs[1].focus();
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "0.200000" },
      target: { value: "0.200000" },
    });
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });

    expect([...container.querySelectorAll(".sequencer-event__position")].map((node) => node.value))
      .toEqual(["1.000000", "0.000", "0.200", "0.000", "1.000", "1.000", "1.000"]);
    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2"]);
  });

  it("deletes an event by removing its owning note", () => {
    const onUpdateSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A, F",
            notes: [
              { id: "a", midicents: 81, start: 0, end: 1 },
              { id: "b", midicents: 76, start: 0, end: 1 },
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

    fireEvent.click(screen.getAllByLabelText("delete snapshot 1 attack event")[0]);

    expect(onUpdateSnapshot).toHaveBeenCalledWith(10, {
      notes: [expect.objectContaining({ id: "b" })],
    });
  });

  it("moves an event note into another snapshot by dragging", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [{ id: "a", midicents: 81, start: 0.25, end: 1 }],
        },
        {
          id: 20,
          length: 1,
          description: "B",
          notes: [{ id: "b", midicents: 76, start: 0, end: 1 }],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
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

    render(<Harness />);

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    const dragHandle = screen.getAllByLabelText("drag snapshot 1 attack event")[0];
    const dropTarget = screen.getByLabelText("snapshot 2 description").closest(".sequencer-item");

    fireEvent.dragStart(dragHandle, { dataTransfer });
    fireEvent.dragEnter(dropTarget, { dataTransfer });
    fireEvent.dragOver(dropTarget, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer });

    expect(screen.getAllByLabelText("snapshot 2 attack snapshot").map((node) => node.value)).toContain("2");
    expect(screen.getAllByLabelText("snapshot 2 attack offset").map((node) => node.value)).toContain("-0.750");
  });

  it("duplicates an event note into another snapshot on option-drag", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [{ id: "a", midicents: 81, start: 0.25, end: 1 }],
        },
        {
          id: 20,
          length: 1,
          description: "B",
          notes: [{ id: "b", midicents: 76, start: 0, end: 1 }],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
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

    render(<Harness />);

    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(),
    };
    const dragHandle = screen.getAllByLabelText("drag snapshot 1 attack event")[0];
    const dropTarget = screen.getByLabelText("snapshot 2 description").closest(".sequencer-item");

    fireEvent.dragStart(dragHandle, { dataTransfer, altKey: true });
    fireEvent.dragEnter(dropTarget, { dataTransfer, altKey: true });
    fireEvent.dragOver(dropTarget, { dataTransfer, altKey: true });
    fireEvent.drop(dropTarget, { dataTransfer, altKey: true });

    expect(screen.getAllByLabelText("snapshot 2 attack snapshot")).toHaveLength(2);
    expect(screen.getAllByLabelText("snapshot 2 attack offset").map((node) => node.value)).toContain("-0.750");
  });

  it("queues the first snapshot and cue again at the terminal sequence end slot", () => {
    const onJumpSequenceSnapshot = vi.fn();
    const onJumpSequenceCue = vi.fn();

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
        onJumpSequenceSnapshot={onJumpSequenceSnapshot}
        onJumpSequenceCue={onJumpSequenceCue}
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

    const snapshotTargetSelect = screen.getByLabelText("next snapshot target");
    const cueTargetSelect = screen.getByLabelText("next cue target");
    expect(Array.from(snapshotTargetSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["(1)"]);
    expect(Array.from(cueTargetSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["(1)", "2"]);
    expect(snapshotTargetSelect.value).toBe("0");
    expect(cueTargetSelect.value).toBe("0");
    expect(screen.getByLabelText("next sequence step").disabled).toBe(false);
    expect(screen.getByLabelText("next sequence marker").disabled).toBe(false);

    fireEvent.click(screen.getByLabelText("next sequence step"));
    expect(onJumpSequenceSnapshot).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByLabelText("next sequence marker"));
    expect(onJumpSequenceCue).toHaveBeenCalledWith(0);
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

    const snapshotTargetSelect = screen.getByLabelText("next snapshot target");
    const cueTargetSelect = screen.getByLabelText("next cue target");
    expect(Array.from(snapshotTargetSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["1", "(2)"]);
    expect(Array.from(cueTargetSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["1", "(2)", "3"]);
    expect(snapshotTargetSelect.value).toBe("1");
    expect(cueTargetSelect.value).toBe("1");
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
    fireEvent.input(screen.getByLabelText("new bar numerator"), {
      currentTarget: { value: "3" },
      target: { value: "3" },
    });
    fireEvent.input(screen.getByLabelText("new bar denominator"), {
      currentTarget: { value: "2" },
      target: { value: "2" },
    });
    fireEvent.click(screen.getByText("Add Bar"));
    expect(onAddBar).toHaveBeenCalledWith(2.5, 3, 2);

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
    expect(expandedTimes).toEqual(["0.000", "1.500000", "0.750", "1.000", "1.000"]);
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

  it("shows stopped 0/1 bars as beat 0 with non-editable beat, num, and den fields", () => {
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
        bars={[{ id: 1, position: 1, numerator: 0, denominator: 1 }]}
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

    expect(screen.getByLabelText("snapshot 1 attack beat").value).toBe("0");
    expect(screen.getByLabelText("snapshot 1 attack beat fraction numerator").value).toBe("0");
    expect(screen.getByLabelText("snapshot 1 attack beat fraction denominator").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 attack beat").disabled).toBe(true);
    expect(screen.getByLabelText("snapshot 1 attack beat fraction numerator").disabled).toBe(true);
    expect(screen.getByLabelText("snapshot 1 attack beat fraction denominator").disabled).toBe(true);
    expect(screen.getByLabelText("tempo beat").value).toBe("0");
    expect(screen.getByLabelText("tempo beat fraction numerator").value).toBe("0");
    expect(screen.getByLabelText("tempo beat fraction denominator").value).toBe("1");
    expect(screen.getByLabelText("tempo beat").disabled).toBe(true);
    expect(screen.getByLabelText("tempo beat fraction numerator").disabled).toBe(true);
    expect(screen.getByLabelText("tempo beat fraction denominator").disabled).toBe(true);
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

  it("shows edited in the Name field after pitch edits and can restore the captured pitch and name", () => {
    function Harness() {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1 }],
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
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: 0, stopped: true }}
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
          onUpdateSnapshot={(id, patch) => {
            setSnapshots((current) => current.map((snapshot) => (
              snapshot.id === id ? { ...snapshot, ...patch } : snapshot
            )));
          }}
          onResetSnapshotDescription={vi.fn()}
          activeSequenceName=""
          activeSequenceDescription=""
          sequenceLegato
        />
      );
    }

    render(<Harness />);

    fireEvent.blur(screen.getAllByLabelText("snapshot 1 attack midicents")[0], {
      currentTarget: { value: "70.500000" },
      target: { value: "70.500000" },
    });

    expect(screen.getAllByText("edited").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("restore snapshot 1 attack captured pitch and name")).not.toBeNull();
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("70.500");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).not.toBe("440.0");

    fireEvent.click(screen.getByLabelText("restore snapshot 1 attack captured pitch and name"));

    expect(screen.queryByText("edited")).toBeNull();
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("69.000");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).toBe("440.0");
  });

  it("does not mark the Name field as edited when MIDI¢ or Hz blur without a real pitch change", () => {
    function Harness() {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1 }],
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
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: 0, stopped: true }}
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
          onUpdateSnapshot={(id, patch) => {
            setSnapshots((current) => current.map((snapshot) => (
              snapshot.id === id ? { ...snapshot, ...patch } : snapshot
            )));
          }}
          onResetSnapshotDescription={vi.fn()}
          activeSequenceName=""
          activeSequenceDescription=""
          sequenceLegato
        />
      );
    }

    render(<Harness />);

    fireEvent.blur(screen.getAllByLabelText("snapshot 1 attack midicents")[0], {
      currentTarget: { value: "69.000000" },
      target: { value: "69.000000" },
    });

    expect(screen.queryByText("edited")).toBeNull();
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);

    fireEvent.blur(screen.getAllByLabelText("snapshot 1 attack frequency")[0], {
      currentTarget: { value: "440.000000" },
      target: { value: "440.000000" },
    });

    expect(screen.queryByText("edited")).toBeNull();
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
  });
});
