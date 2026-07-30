import { useState } from "preact/hooks";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPersistedSequencerCrashDiagnostics, SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY } from "../debug/sequencer-crash-diagnostics.js";
import Sequencer from "./sequencer.jsx";
import { buildSnapshotDescription } from "./labels.js";
import flightSequence from "./preset-sequences/marc-sabat/Flight.json";
import { loadUserSequences } from "./sequence-library.jsx";
import { normalizeBarMarkers, normalizeTempoMarkers } from "./transport.js";
import { deriveSequenceCueGroups, deriveSequenceEvents } from "./trigger-groups.js";
import { deriveCueViewportPlan } from "./view-runtime.js";
import {
  deleteSnapshotRangeFromWorkspace,
  resetSnapshotRangeNoteOffsetsInWorkspace,
} from "./snapshot-workspace-runtime.js";

describe("Sequencer", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("does not reset bar playback state before dispatching a timed cue", () => {
    vi.useFakeTimers();
    localStorage.setItem("hexatone_debug_timed_transport", "true");
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const raf = vi.fn(() => 1);
    const cancelRaf = vi.fn();
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = cancelRaf;
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancelRaf;

    let nowSeconds = 0;
    const onPlayCue = vi.fn();
    const onSelectSequenceBar = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 0, end: 0.5 },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
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
        onSelectSequenceBar={onSelectSequenceBar}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={onPlayCue}
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
        getTimedTransportClockSeconds={() => nowSeconds}
      />,
    );

    fireEvent.click(screen.getByLabelText("play timed transport"));
    vi.runOnlyPendingTimers();

    expect(onPlayCue).toHaveBeenCalledWith(0);
    expect(onSelectSequenceBar).not.toHaveBeenCalled();

    nowSeconds = 2;
    vi.runOnlyPendingTimers();
    nowSeconds = 5;
    vi.runOnlyPendingTimers();
    expect(globalThis.__hexatoneTimedTransportDiagnostics.get().recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "finished",
          status: "finished",
          detail: "Timed transport reached the terminal playback burst",
        }),
      ]),
    );

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    vi.useRealTimers();
  });

  it("offers an Empty snapshot button alongside Capture", () => {
    const onAddEmptySnapshot = vi.fn();
    const onUpdateSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 1,
            length: 1,
            notes: [],
            description: "",
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        snapshotLabelMode="labels"
        manualArpeggiation={{ mode: "per-snapshot" }}
        selectedSnapshotId={null}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onAddEmptySnapshot={onAddEmptySnapshot}
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
        onUpdateSnapshot={onUpdateSnapshot}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Append Empty Snapshot" }));
    expect(onAddEmptySnapshot).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "chord snapshot 1" }));
    expect(onUpdateSnapshot).toHaveBeenCalledWith(1, {
      manualTrigger: {
        articulation: "arpeggiate",
        styleId: null,
        styleParameters: null,
      },
    });
  });

  it("resets note offsets in place from the Copy & Insert controls", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [{ id: "a", midicents: 69, start: 0.25, end: 0.75, startFractionDenominator: 4, endFractionDenominator: 4 }],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
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
          onResetSnapshotRangeNoteOffsetsInPlace={(selection) => {
            const result = resetSnapshotRangeNoteOffsetsInWorkspace({
              snapshots,
              bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
              startPosition: selection?.startPosition,
              endPosition: selection?.endPosition,
              includeBars: selection?.includeBars === true,
            });
            setSnapshots(result.snapshots);
            return result;
          }}
          onUpdateSnapshot={vi.fn()}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    render(<Harness />);

    expect(screen.getAllByLabelText("snapshot 1 attack offset")[0].value).toBe("0.250");
    expect(screen.getAllByLabelText("snapshot 1 release offset")[0].value).toBe("0.750");

    fireEvent.click(screen.getByRole("button", { name: "Reset Note Offsets" }));

    expect(screen.getAllByLabelText("snapshot 1 attack offset")[0].value).toBe("0.000");
    expect(screen.getAllByLabelText("snapshot 1 release offset")[0].value).toBe("1.000");
  });

  it("deletes the selected range from the Copy & Insert controls", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
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
          notes: [{ id: "b", midicents: 71, start: 0.5, end: 1 }],
        },
      ]);
      const [selectedSnapshotId, setSelectedSnapshotId] = useState(10);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={selectedSnapshotId}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onLoadSequence={vi.fn()}
          onSequenceNameChange={vi.fn()}
          onSequenceDescriptionChange={vi.fn()}
          onSequenceLegatoChange={vi.fn()}
          onSetSnapshotLabelMode={vi.fn()}
          onSelectSnapshot={setSelectedSnapshotId}
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
          onDeleteSnapshotRange={(selection) => {
            const result = deleteSnapshotRangeFromWorkspace({
              snapshots,
              bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
              tempi: [],
              repeats: [],
              startPosition: selection?.startPosition,
              endPosition: selection?.endPosition,
              includeBars: selection?.includeBars === true,
              includeTempi: selection?.includeTempi === true,
              includeRepeats: selection?.includeRepeats === true,
              selectedSnapshotId,
              selectedSnapshotMarker: null,
            });
            setSnapshots(result.snapshots);
            setSelectedSnapshotId(result.selectedSnapshotId);
            return result;
          }}
          onUpdateSnapshot={vi.fn()}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    render(<Harness />);

    expect(screen.getByDisplayValue("A")).not.toBeNull();
    expect(screen.getByDisplayValue("B")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete Selected Range" }));

    expect(screen.queryByDisplayValue("A")).toBeNull();
    expect(screen.getByDisplayValue("B")).not.toBeNull();
  });

  it("offers sequence structure and playback modifier controls", () => {
    const onManualArpeggiationChange = vi.fn();
    render(
      <Sequencer
        snapshots={[]}
        bars={[{ id: 1, position: 1 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" }]}
        snapshotLabelMode="labels"
        manualArpeggiation={{
          mode: "per-snapshot",
          initialSpreadMs: 825,
          spreadVariation: 0.33,
          timingVariation: 0.18,
          decayMode: "timed",
          decayMs: 4200,
          decayVariation: 0.22,
        }}
        selectedSnapshotId={null}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onAddEmptySnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onManualArpeggiationChange={onManualArpeggiationChange}
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
        getTimedTransportClockSeconds={() => 0}
      />,
    );

    expect(screen.getByRole("button", { name: "Add Tempo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Target Tempo" })).toBeTruthy();
    expect(screen.getByLabelText("sequence playback speed")).toBeTruthy();
    expect(screen.getByLabelText("sequence playback pitch")).toBeTruthy();
    expect(screen.getByRole("slider", { name: "sequence playback speed slider" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "sequence playback pitch slider" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "manual snapshot arpeggiation mode" }).value)
      .toBe("per-snapshot");
    expect(screen.getByRole("slider", { name: "manual arpeggiation initial spread" }).value)
      .toBe("825");
    expect(screen.getByRole("slider", { name: "manual arpeggiation spread variation" }).value)
      .toBe("33");
    expect(screen.getByRole("slider", { name: "manual arpeggiation timing variation" }).value)
      .toBe("18");
    expect(screen.getByRole("slider", { name: "manual arpeggiation decay" }).value)
      .toBe("4200");
    expect(screen.getByRole("slider", { name: "manual arpeggiation decay variation" }).value)
      .toBe("22");

    fireEvent.input(screen.getByRole("slider", { name: "manual arpeggiation initial spread" }), {
      currentTarget: { value: "1200" },
      target: { value: "1200" },
    });
    fireEvent.input(screen.getByRole("slider", { name: "manual arpeggiation timing variation" }), {
      currentTarget: { value: "25" },
      target: { value: "25" },
    });
    fireEvent.input(screen.getByRole("slider", { name: "manual arpeggiation spread variation" }), {
      currentTarget: { value: "40" },
      target: { value: "40" },
    });
    fireEvent.input(screen.getByRole("slider", { name: "manual arpeggiation decay" }), {
      currentTarget: { value: "7500" },
      target: { value: "7500" },
    });
    fireEvent.input(screen.getByRole("slider", { name: "manual arpeggiation decay" }), {
      currentTarget: { value: "0" },
      target: { value: "0" },
    });
    fireEvent.input(screen.getByRole("slider", { name: "manual arpeggiation decay" }), {
      currentTarget: { value: "10100" },
      target: { value: "10100" },
    });
    fireEvent.input(screen.getByRole("slider", { name: "manual arpeggiation decay variation" }), {
      currentTarget: { value: "35" },
      target: { value: "35" },
    });
    expect(onManualArpeggiationChange).toHaveBeenNthCalledWith(1, { initialSpreadMs: 1200 });
    expect(onManualArpeggiationChange).toHaveBeenNthCalledWith(2, { timingVariation: 0.25 });
    expect(onManualArpeggiationChange).toHaveBeenNthCalledWith(3, { spreadVariation: 0.4 });
    expect(onManualArpeggiationChange).toHaveBeenNthCalledWith(4, {
      decayMode: "timed",
      decayMs: 7500,
    });
    expect(onManualArpeggiationChange).toHaveBeenNthCalledWith(5, {
      decayMode: "immediate",
    });
    expect(onManualArpeggiationChange).toHaveBeenNthCalledWith(6, {
      decayMode: "sustain",
    });
    expect(onManualArpeggiationChange).toHaveBeenNthCalledWith(7, { decayVariation: 0.35 });
  });

  it("suggests the tempo at a chosen position and retains user-entered tempo values after adding", () => {
    const onAddTempo = vi.fn();
    render(
      <Sequencer
        snapshots={[]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
        tempi={[
          { id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 },
          { id: 2, position: 3, bpm: 120, beatNumerator: 3, beatDenominator: 16, beatLength: 0.75 },
        ]}
        snapshotLabelMode="labels"
        selectedSnapshotId={null}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onAddEmptySnapshot={vi.fn()}
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
        onAddTempo={onAddTempo}
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
        getTimedTransportClockSeconds={() => 0}
      />,
    );

    const positionInput = screen.getByLabelText("new tempo position");
    const bpmInput = screen.getByLabelText("new tempo bpm");

    fireEvent.input(positionInput, { target: { value: "3" } });
    expect(bpmInput.value).toBe("90");
    expect(bpmInput.classList.contains("sequencer-bars-add__position--hint")).toBe(true);

    fireEvent.input(bpmInput, { target: { value: "88" } });
    fireEvent.input(positionInput, { target: { value: "2" } });
    expect(bpmInput.value).toBe("88");
    expect(bpmInput.classList.contains("sequencer-bars-add__position--hint")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Add Tempo" }));

    expect(onAddTempo).toHaveBeenCalledWith(2, 88, "immediate");
    expect(positionInput.value).toBe("2");
    expect(bpmInput.value).toBe("88");

    fireEvent.click(screen.getByRole("button", { name: "Add Target Tempo" }));
    expect(onAddTempo).toHaveBeenLastCalledWith(2, 88, "gradual");
    expect(positionInput.value).toBe("2");
    expect(bpmInput.value).toBe("88");
  });

  it("applies articulation to a snapshot range and inserts its copied block", () => {
    const onInsertSnapshotCopyBlock = vi.fn(() => null);
    const onSetSnapshotRangeArticulation = vi.fn(() => null);
    const onRestoreSnapshotRangeChanges = vi.fn(() => null);
    const onManualArpeggiationChange = vi.fn();

    render(
      <Sequencer
        snapshots={[
          { id: 1, length: 1, notes: [{ id: "n1", midicents: 69, start: 0.25, end: 0.75 }], description: "A" },
          { id: 2, length: 1, notes: [{ id: "n2", midicents: 71, start: 0.5, end: 0.9 }], description: "B" },
          { id: 3, length: 1, notes: [], description: "C" },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={2}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onAddEmptySnapshot={vi.fn()}
        onLoadSequence={vi.fn()}
        onSequenceNameChange={vi.fn()}
        onSequenceDescriptionChange={vi.fn()}
        onSequenceSaved={vi.fn()}
        onSequenceLegatoChange={vi.fn()}
        onSequencePlaybackSpeedChange={vi.fn()}
        onSequencePlaybackPitchOffsetChange={vi.fn()}
        onSnapSequenceToCurrentTuningChange={vi.fn()}
        onSequenceAutoCreateBarsChange={vi.fn()}
        onManualArpeggiationChange={onManualArpeggiationChange}
        onSetSnapshotLabelMode={vi.fn()}
        onSelectSnapshot={vi.fn()}
        onSelectMarker={vi.fn()}
        onPlaySnapshot={vi.fn()}
        onStopSnapshot={vi.fn()}
        onSelectSequenceBar={vi.fn()}
        onCueSequenceSnapshot={vi.fn()}
        onCueSequenceCue={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onJumpSequenceSnapshot={vi.fn()}
        onJumpSequenceCue={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onPlayTimedCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onJumpSequenceEnd={vi.fn()}
        getTimedTransportClockSeconds={() => 0}
        onAddBar={vi.fn()}
        onAddTempo={vi.fn()}
        onAddRepeat={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onDeleteTempo={vi.fn()}
        onDeleteRepeat={vi.fn()}
        onUpdateBar={vi.fn()}
        onUpdateTempo={vi.fn()}
        onUpdateRepeat={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onDeleteAllSnapshots={vi.fn()}
        onClearSequence={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onDuplicateSnapshot={vi.fn()}
        onInsertSnapshotCopyBlock={onInsertSnapshotCopyBlock}
        onSetSnapshotRangeArticulation={onSetSnapshotRangeArticulation}
        onRestoreSnapshotRangeChanges={onRestoreSnapshotRangeChanges}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    fireEvent.input(screen.getByLabelText("copy snapshot range start"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    fireEvent.input(screen.getByLabelText("copy snapshot range end"), {
      currentTarget: { value: "2" },
      target: { value: "2" },
    });
    fireEvent.input(screen.getByLabelText("copy snapshot insert global position"), {
      currentTarget: { value: "4" },
      target: { value: "4" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Set to arp" }));
    expect(onSetSnapshotRangeArticulation).toHaveBeenCalledWith({
      startPosition: "1",
      endPosition: "2",
      includeBars: false,
    }, "arpeggiate");
    expect(onManualArpeggiationChange).toHaveBeenCalledWith({ mode: "per-snapshot" });
    fireEvent.click(screen.getByRole("button", { name: "Revert changes" }));
    expect(onRestoreSnapshotRangeChanges).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 2 }),
    ]);
    expect(onManualArpeggiationChange).toHaveBeenLastCalledWith({ mode: "off" });
    fireEvent.click(screen.getByRole("button", { name: "Set to chord" }));
    expect(onSetSnapshotRangeArticulation).toHaveBeenLastCalledWith({
      startPosition: "1",
      endPosition: "2",
      includeBars: false,
    }, "chord");

    fireEvent.click(screen.getByRole("button", { name: "Copy Selection" }));
    expect(screen.getByText("Snapshots 1-2 copied.")).toBeTruthy();
    expect(screen.queryByText("Copied 2 snapshots.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insert Copied Block" }));

    expect(onInsertSnapshotCopyBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        length: 2,
        includeBars: false,
        snapshots: [
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 2 }),
        ],
      }),
      4,
    );
    expect(screen.getByLabelText("copy snapshot range start").value).toBe("4");
    expect(screen.getByLabelText("copy snapshot range end").value).toBe("5");
    expect(screen.getByText("Inserted 2 snapshots at slot 4.")).toBeTruthy();
  });

  it("renders a derived gradual cue and toggles tempo mode by clicking its label", () => {
    const onUpdateTempo = vi.fn();
    const { container } = render(
      <Sequencer
        snapshots={[
          {
            id: 1,
            length: 1,
            notes: [],
            description: "",
          },
        ]}
        bars={[
          { id: 1, position: 1, numerator: 4, denominator: 4 },
          { id: 2, position: 2, numerator: 3, denominator: 2 },
        ]}
        tempi={[
          { id: "t1", position: 1.5, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1, mode: "immediate" },
          { id: "t2", position: 2, bpm: 72, beatNumerator: 3, beatDenominator: 16, beatLength: 0.75, mode: "gradual" },
        ]}
        snapshotLabelMode="labels"
        selectedSnapshotId={null}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
        onTakeSnapshot={vi.fn()}
        onAddEmptySnapshot={vi.fn()}
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
        getTimedTransportClockSeconds={() => 0}
      />,
    );

    expect(container.querySelector(".sequencer-tempo-row__transition-cue")?.textContent).toContain("ritardando until 3/16 = 72 bpm at Bar 2 Beat 1");
    fireEvent.click(screen.getByRole("button", {
      name: "tempo mode gradual; change to immediate",
    }));
    expect(onUpdateTempo).toHaveBeenCalledWith("t2", { mode: "immediate" });
    fireEvent.click(screen.getByRole("button", {
      name: "tempo mode immediate; change to gradual",
    }));
    expect(onUpdateTempo).toHaveBeenCalledWith("t1", { mode: "gradual" });
  });

  it("duplicates the save current sequence action at the bottom of Edit & Play", () => {
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
        activeSequenceName="Test Sequence"
        activeSequenceDescription=""
        sequenceLegato
        sequenceAutoCreateBars
      />,
    );

    expect(screen.getAllByRole("button", { name: "Save current sequence" })).toHaveLength(1);
  });

  it("prefers the dedicated timed cue callback when timed transport dispatches a cue", () => {
    vi.useFakeTimers();
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const frameCallbacks = [];
    window.requestAnimationFrame = vi.fn((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    window.cancelAnimationFrame = vi.fn();
    const flushQueuedFrames = () => {
      frameCallbacks.splice(0).forEach((callback) => callback());
    };

    let nowSeconds = 0;
    const onPlayCue = vi.fn();
    const onPlayTimedCue = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 0, end: 0.5 },
            ],
          },
          {
            id: 20,
            length: 1,
            description: "B",
            notes: [
              { id: "b", midicents: 72, start: 0, end: 0.5 },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
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
        onPlayCue={onPlayCue}
        onPlayTimedCue={onPlayTimedCue}
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
        getTimedTransportClockSeconds={() => nowSeconds}
      />,
    );

    fireEvent.click(screen.getByLabelText("play timed transport"));
    vi.runOnlyPendingTimers();

    expect(onPlayTimedCue).toHaveBeenCalledTimes(1);
    expect(onPlayTimedCue.mock.calls[0][0]).toBe(0);
    expect(onPlayTimedCue.mock.calls[0][1]).toMatchObject({
      cueIndex: 1,
      notes: expect.any(Array),
    });
    expect(onPlayCue).not.toHaveBeenCalled();

    flushQueuedFrames();
    const firstSnapshotRow = screen.getByLabelText("snapshot 1 description").closest(".sequencer-item");
    const secondSnapshotRow = screen.getByLabelText("snapshot 2 description").closest(".sequencer-item");
    const attackRows = document.querySelectorAll(".sequencer-event-row--attack");
    const barSelect = document.querySelector('[data-timed-transport-field="bar"]');
    const snapshotSelect = screen.getByLabelText("next snapshot target");
    const cueSelect = screen.getByLabelText("next cue target");
    expect(firstSnapshotRow?.classList.contains("sequencer-item--timed-playing")).toBe(true);
    expect(attackRows[0]?.classList.contains("sequencer-event-row--timed-sounding")).toBe(true);
    expect(barSelect?.value).toBe("0");
    expect(snapshotSelect.value).toBe("0");
    expect(cueSelect.value).toBe("0");

    fireEvent.click(screen.getByLabelText("Auto-Scroll"));
    expect(screen.getByLabelText("Auto-Scroll").checked).toBe(false);
    expect(localStorage.getItem("hexatone_sequencer_auto_scroll_enabled")).toBe("false");
    expect(firstSnapshotRow?.classList.contains("sequencer-item--timed-playing")).toBe(true);
    expect(attackRows[0]?.classList.contains("sequencer-event-row--timed-sounding")).toBe(true);

    nowSeconds = 4.1;
    vi.advanceTimersByTime(50);
    expect(onPlayTimedCue).toHaveBeenCalledTimes(3);
    flushQueuedFrames();

    expect(secondSnapshotRow?.classList.contains("sequencer-item--timed-playing")).toBe(true);
    expect(attackRows[0]?.classList.contains("sequencer-event-row--timed-sounding")).toBe(false);
    expect(attackRows[1]?.classList.contains("sequencer-event-row--timed-sounding")).toBe(true);
    expect(barSelect?.value).toBe("1");
    expect(snapshotSelect.value).toBe("1");
    expect(cueSelect.value).toBe("2");

    expect(barSelect?.value).toBe("1");
    expect(snapshotSelect.value).toBe("1");
    expect(cueSelect.value).toBe("2");

    fireEvent.click(screen.getByLabelText("pause timed transport"));
    expect(firstSnapshotRow?.classList.contains("sequencer-item--timed-playing")).toBe(false);
    expect(secondSnapshotRow?.classList.contains("sequencer-item--timed-playing")).toBe(false);
    expect(attackRows[1]?.classList.contains("sequencer-event-row--timed-sounding")).toBe(false);
    expect(barSelect?.value).toBe("0");
    expect(snapshotSelect.value).toBe("0");
    expect(cueSelect.value).toBe("0");

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    vi.useRealTimers();
  });

  it("starts timed transport from the armed snapshot selection when the playhead is off", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const onPlayCue = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 69, start: 0, end: 0.5 }],
          },
          {
            id: 11,
            length: 1,
            description: "B",
            notes: [{ id: "b", midicents: 71, start: 0, end: 0.5 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={11}
        selectedMarker={null}
        pendingTransportSelection={{ snapshotIndex: 1, cueIndex: 1 }}
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
        onPlayCue={onPlayCue}
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
        getTimedTransportClockSeconds={() => nowSeconds}
      />,
    );

    fireEvent.click(screen.getByLabelText("play timed transport"));
    vi.runOnlyPendingTimers();

    expect(onPlayCue).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });

  it("starts timed transport from the armed cue selection when the playhead is off", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const onPlayCue = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [{ id: "a", midicents: 69, start: 0, end: 0.5 }],
          },
          {
            id: 11,
            length: 1,
            description: "B",
            notes: [{ id: "b", midicents: 71, start: 0, end: 0.5 }],
          },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={11}
        selectedMarker={{ snapshotId: 11, time: 0 }}
        pendingTransportSelection={{ snapshotIndex: 1, cueIndex: 1 }}
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
        onPlayCue={onPlayCue}
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
        getTimedTransportClockSeconds={() => nowSeconds}
      />,
    );

    fireEvent.click(screen.getByLabelText("play timed transport"));
    vi.runOnlyPendingTimers();

    expect(onPlayCue).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });

  it("keeps timed transport running when display snapshots are rebuilt", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const baseProps = {
      snapshots: [
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [
            { id: "a", midicents: 69, start: 0, end: 0.5 },
          ],
        },
      ],
      displaySnapshots: [
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [
            { id: "a", midicents: 69, start: 0, end: 0.5 },
          ],
        },
      ],
      bars: [{ id: 1, position: 1 }],
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }],
      snapshotLabelMode: "labels",
      selectedSnapshotId: 10,
      selectedMarker: null,
      playingSnapshotId: null,
      playhead: { barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true },
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
      onPlayTimedCue: vi.fn(),
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
      getTimedTransportClockSeconds: () => nowSeconds,
    };

    const { rerender } = render(<Sequencer {...baseProps} />);

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();

    rerender(
      <Sequencer
        {...baseProps}
        displaySnapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 70, start: 0, end: 0.5 },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();
    vi.useRealTimers();
  });

  it("keeps timed transport running when legato changes", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const baseProps = {
      snapshots: [
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [
            { id: "a", midicents: 69, start: 0, end: 0.5 },
          ],
        },
      ],
      bars: [{ id: 1, position: 1 }],
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }],
      snapshotLabelMode: "labels",
      selectedSnapshotId: 10,
      selectedMarker: null,
      playingSnapshotId: null,
      playhead: { barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true },
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
      onPlayTimedCue: vi.fn(),
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
      getTimedTransportClockSeconds: () => nowSeconds,
    };

    const { rerender } = render(<Sequencer {...baseProps} sequenceLegato />);

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();

    rerender(<Sequencer {...baseProps} sequenceLegato={false} />);

    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();
    vi.useRealTimers();
  });

  it("stops timed transport when the playback snapshot source changes mid-run", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const onStopSnapshot = vi.fn();
    const baseProps = {
      snapshots: [
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [
            { id: "a", midicents: 69, start: 0, end: 0.5 },
          ],
        },
      ],
      bars: [{ id: 1, position: 1 }],
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }],
      snapshotLabelMode: "labels",
      selectedSnapshotId: 10,
      selectedMarker: null,
      playingSnapshotId: null,
      playhead: { barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true },
      onTakeSnapshot: vi.fn(),
      onLoadSequence: vi.fn(),
      onSequenceNameChange: vi.fn(),
      onSequenceDescriptionChange: vi.fn(),
      onSequenceLegatoChange: vi.fn(),
      onSetSnapshotLabelMode: vi.fn(),
      onSelectSnapshot: vi.fn(),
      onSelectMarker: vi.fn(),
      onPlaySnapshot: vi.fn(),
      onStopSnapshot,
      onSelectSequenceBar: vi.fn(),
      onStepSequence: vi.fn(),
      onStepSequenceMarker: vi.fn(),
      onPlaySequence: vi.fn(),
      onPlayCue: vi.fn(),
      onPlayTimedCue: vi.fn(),
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
      getTimedTransportClockSeconds: () => nowSeconds,
    };

    const { rerender } = render(<Sequencer {...baseProps} />);

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();

    rerender(
      <Sequencer
        {...baseProps}
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 0, end: 0.5 },
              { id: "b", midicents: 72, start: 0.5, end: 1 },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("play timed transport")).toBeTruthy();
    expect(onStopSnapshot).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("keeps timed transport running when only the live tuning-mapped snapshot view changes", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const onStopSnapshot = vi.fn();
    const snapshots = [
      {
        id: 10,
        length: 1,
        description: "A",
        notes: [
          { id: "a", midicents: 69, start: 0, end: 0.5 },
        ],
      },
    ];
    const baseProps = {
      snapshots,
      playbackSnapshots: snapshots,
      bars: [{ id: 1, position: 1 }],
      tempi: [{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }],
      snapshotLabelMode: "labels",
      selectedSnapshotId: 10,
      selectedMarker: null,
      playingSnapshotId: null,
      playhead: { barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true },
      onTakeSnapshot: vi.fn(),
      onLoadSequence: vi.fn(),
      onSequenceNameChange: vi.fn(),
      onSequenceDescriptionChange: vi.fn(),
      onSequenceLegatoChange: vi.fn(),
      onSetSnapshotLabelMode: vi.fn(),
      onSelectSnapshot: vi.fn(),
      onSelectMarker: vi.fn(),
      onPlaySnapshot: vi.fn(),
      onStopSnapshot,
      onSelectSequenceBar: vi.fn(),
      onStepSequence: vi.fn(),
      onStepSequenceMarker: vi.fn(),
      onPlaySequence: vi.fn(),
      onPlayCue: vi.fn(),
      onPlayTimedCue: vi.fn(),
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
      getTimedTransportClockSeconds: () => nowSeconds,
    };

    const { rerender } = render(<Sequencer {...baseProps} />);

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();

    rerender(
      <Sequencer
        {...baseProps}
        playbackSnapshots={[
          {
            ...snapshots[0],
            notes: [
              { ...snapshots[0].notes[0], midicents: 70 },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();
    expect(onStopSnapshot).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("pauses timed playback by stopping sound and resumes from the current cue", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const onPlayTimedCue = vi.fn();
    const onStopSnapshot = vi.fn();

    render(
      <Sequencer
        snapshots={[
          {
            id: 10,
            length: 1,
            description: "A",
            notes: [
              { id: "a", midicents: 69, start: 0, end: 0.5 },
              { id: "b", midicents: 72, start: 0.5, end: 1 },
            ],
          },
        ]}
        bars={[{ id: 1, position: 1 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
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
        onStopSnapshot={onStopSnapshot}
        onSelectSequenceBar={vi.fn()}
        onStepSequence={vi.fn()}
        onStepSequenceMarker={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onPlayTimedCue={onPlayTimedCue}
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
        getTimedTransportClockSeconds={() => nowSeconds}
      />,
    );

    fireEvent.click(screen.getByLabelText("play timed transport"));
    vi.runOnlyPendingTimers();
    expect(onPlayTimedCue).toHaveBeenCalledTimes(1);
    expect(onPlayTimedCue.mock.calls[0][0]).toBe(0);

    nowSeconds = 2.1;
    vi.advanceTimersByTime(50);
    expect(onPlayTimedCue).toHaveBeenCalledTimes(2);
    expect(onPlayTimedCue.mock.calls[1][0]).toBe(1);

    fireEvent.click(screen.getByLabelText("pause timed transport"));
    expect(onStopSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("play timed transport")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();
    expect(onPlayTimedCue).toHaveBeenCalledTimes(3);
    expect(onPlayTimedCue.mock.calls[2][0]).toBe(1);

    vi.useRealTimers();
  });

  it("starts timed playback from the queued cue instead of the previous cue", () => {
    vi.useFakeTimers();

    let nowSeconds = 0;
    const onPlayTimedCue = vi.fn();

    const Harness = () => {
      const [playhead, setPlayhead] = useState({ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true });
      return (
        <Sequencer
          snapshots={[
            {
              id: 10,
              length: 1,
              description: "A",
              notes: [
                { id: "a", midicents: 69, start: 0, end: 0.25 },
                { id: "b", midicents: 71, start: 0.25, end: 0.5 },
                { id: "c", midicents: 72, start: 0.5, end: 0.75 },
              ],
            },
          ]}
          bars={[{ id: 1, position: 1 }]}
          tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={10}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={playhead}
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
          onCueSequenceCue={(cueIndex) => setPlayhead({ barIndex: 0, stepIndex: 0, markerIndex: cueIndex, stopped: true })}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onPlayTimedCue={onPlayTimedCue}
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
          getTimedTransportClockSeconds={() => nowSeconds}
        />
      );
    };

    render(<Harness />);

    fireEvent.change(screen.getByLabelText("next cue target"), { target: { value: "2" } });
    expect(screen.getByLabelText("next cue target").value).toBe("2");

    fireEvent.click(screen.getByLabelText("play timed transport"));
    vi.runOnlyPendingTimers();

    expect(onPlayTimedCue).toHaveBeenCalledTimes(1);
    expect(onPlayTimedCue.mock.calls[0][0]).toBe(2);

    vi.useRealTimers();
  });

  it("stops timed playback before jumping the timed transport to the start or end", () => {
    vi.useFakeTimers();
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const raf = vi.fn(() => 1);
    const cancelRaf = vi.fn();
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = cancelRaf;
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancelRaf;

    const { rerender } = render(
      <Sequencer
        snapshots={[
          { id: 10, length: 1, description: "A", notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] },
          { id: 11, length: 1, description: "B", notes: [{ id: "b", midicents: 72, start: 0, end: 1 }] },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: 0, stopped: false }}
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
        onJumpSequenceEnd={vi.fn()}
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
        getTimedTransportClockSeconds={() => 0}
      />,
    );

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("move timed transport to end"));
    expect(screen.getByLabelText("play timed transport")).toBeTruthy();

    rerender(
      <Sequencer
        snapshots={[
          { id: 10, length: 1, description: "A", notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] },
          { id: 11, length: 1, description: "B", notes: [{ id: "b", midicents: 72, start: 0, end: 1 }] },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={10}
        selectedMarker={null}
        playingSnapshotId={null}
        playhead={{ barIndex: 0, stepIndex: 0, markerIndex: 0, stopped: false }}
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
        onJumpSequenceEnd={vi.fn()}
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
        getTimedTransportClockSeconds={() => 0}
      />,
    );

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("move timed transport to start"));
    expect(screen.getByLabelText("play timed transport")).toBeTruthy();

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    vi.useRealTimers();
  });

  it("stops timed playback when PLAY FROM selectors are changed", () => {
    vi.useFakeTimers();
    const originalRaf = window.requestAnimationFrame;
    const originalCancelRaf = window.cancelAnimationFrame;
    const raf = vi.fn(() => 1);
    const cancelRaf = vi.fn();
    window.requestAnimationFrame = raf;
    window.cancelAnimationFrame = cancelRaf;
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = cancelRaf;

    const Harness = () => {
      const [playhead, setPlayhead] = useState({ barIndex: 0, stepIndex: 0, markerIndex: 0, stopped: false });
      return (
        <Sequencer
          snapshots={[
            { id: 10, length: 1, description: "A", notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] },
            { id: 11, length: 1, description: "B", notes: [{ id: "b", midicents: 72, start: 0, end: 1 }] },
          ]}
          bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
          tempi={[{ id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={10}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={playhead}
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
          onCueSequenceCue={(cueIndex) => setPlayhead({ barIndex: 1, stepIndex: 1, markerIndex: cueIndex, stopped: true })}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onResetSequencePlayhead={vi.fn()}
          onJumpSequenceEnd={vi.fn()}
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
          getTimedTransportClockSeconds={() => 0}
        />
      );
    };

    render(<Harness />);

    fireEvent.click(screen.getByLabelText("play timed transport"));
    expect(screen.getByLabelText("pause timed transport")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("next cue target"), { target: { value: "1" } });
    expect(screen.getByLabelText("play timed transport")).toBeTruthy();
    expect(screen.getByLabelText("next cue target").value).toBe("1");

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
    vi.useRealTimers();
  });

  it("finds distant virtualized PLAY FROM snapshots in both directions", async () => {
    const snapshots = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      length: 1,
      description: `Snapshot ${index + 1}`,
      notes: [{ id: `note-${index + 1}`, midicents: 60 + index, start: 0, end: 1 }],
    }));

    const Harness = () => {
      const [selectedSnapshotId, setSelectedSnapshotId] = useState(1);
      const [pendingTransportSelection, setPendingTransportSelection] = useState({
        snapshotIndex: null,
        cueIndex: null,
      });
      const [playhead, setPlayhead] = useState({
        barIndex: 0,
        stepIndex: -1,
        markerIndex: null,
        stopped: true,
      });
      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={selectedSnapshotId}
          selectedMarker={null}
          pendingTransportSelection={pendingTransportSelection}
          playingSnapshotId={null}
          playhead={playhead}
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
          onCueSequenceSnapshot={(targetIndex) => {
            const snapshotIndex = Number(targetIndex);
            setPendingTransportSelection({ snapshotIndex, cueIndex: null });
            setSelectedSnapshotId(snapshots[snapshotIndex].id);
            setPlayhead({ barIndex: 0, stepIndex: snapshotIndex, markerIndex: null, stopped: true });
          }}
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
        />
      );
    };

    const { container } = render(<Harness />);
    const snapshotSelect = screen.getByLabelText("next snapshot target");
    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(scrollPanel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollPanel, "scrollHeight", { configurable: true, value: 10000 });
    let scrollTopValue = 0;
    Object.defineProperty(scrollPanel, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollTopValue = value;
      },
    });
    scrollPanel.getBoundingClientRect = () => ({
      top: 0,
      bottom: 200,
      left: 0,
      right: 0,
      width: 0,
      height: 200,
    });
    const virtualList = container.querySelector(".sequencer-virtual-list");
    virtualList.getBoundingClientRect = () => ({
      top: -scrollTopValue,
      bottom: 10000 - scrollTopValue,
      left: 0,
      right: 0,
      width: 0,
      height: 10000,
    });

    expect(screen.getAllByLabelText(/^snapshot \d+ description$/).length).toBeLessThan(snapshots.length);
    expect(document.querySelector(".sequencer-virtual-spacer")).not.toBeNull();
    expect(screen.queryByLabelText("snapshot 41 description")).toBeNull();

    fireEvent.change(snapshotSelect, { target: { value: "40" } });

    expect(snapshotSelect.value).toBe("40");
    expect(snapshotSelect.selectedOptions[0]?.textContent).toBe("(41)");
    await waitFor(() => {
      expect(screen.getByLabelText("snapshot 41 description")).toBeTruthy();
    });

    fireEvent.change(snapshotSelect, { target: { value: "15" } });

    expect(snapshotSelect.value).toBe("15");
    expect(snapshotSelect.selectedOptions[0]?.textContent).toBe("(16)");
    await waitFor(() => {
      expect(screen.getByLabelText("snapshot 16 description")).toBeTruthy();
    });
  });

  it("keeps the transport-selected cue viewport fixed when the arrow triggers it", () => {
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
          notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 2.5 }],
        },
        {
          id: 11,
          length: 1,
          description: "arrival",
          notes: [{ id: "b", midicents: 72, displayLabel: "C", start: 0.25, end: 1 }],
        },
      ],
    };

    function Harness() {
      const [pendingTransportSelection, setPendingTransportSelection] = useState({
        snapshotIndex: null,
        cueIndex: null,
      });
      const [snapshots, setSnapshots] = useState(baseProps.snapshots);
      const [playingSnapshotId, setPlayingSnapshotId] = useState(null);
      const [playhead, setPlayhead] = useState({
        barIndex: 0,
        stepIndex: 0,
        markerIndex: null,
        stopped: true,
      });
      return (
        <Sequencer
          {...baseProps}
          snapshots={snapshots}
          pendingTransportSelection={pendingTransportSelection}
          playingSnapshotId={playingSnapshotId}
          playhead={playhead}
          onCueSequenceCue={(cueIndex) => {
            setPendingTransportSelection({ snapshotIndex: 0, cueIndex: Number(cueIndex) });
            setPlayhead({
              barIndex: 0,
              stepIndex: 0,
              markerIndex: Number(cueIndex),
              stopped: true,
            });
          }}
          onUpdateSnapshot={(snapshotId, updates) => {
            setSnapshots((current) => current.map((snapshot) => (
              snapshot.id === snapshotId ? { ...snapshot, ...updates } : snapshot
            )));
          }}
          onStepSequenceMarker={() => {
            setPendingTransportSelection({ snapshotIndex: null, cueIndex: null });
            setPlayingSnapshotId(11);
            setPlayhead((current) => ({
              barIndex: 0,
              stepIndex: 1,
              markerIndex: current.stopped ? 1 : current.markerIndex + 1,
              stopped: false,
            }));
          }}
        />
      );
    }

    const { container } = render(<Harness />);

    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(scrollPanel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollPanel, "scrollHeight", { configurable: true, value: 1000 });
    let scrollTopValue = 0;
    let scrollWriteCount = 0;
    Object.defineProperty(scrollPanel, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollWriteCount += 1;
        scrollTopValue = value;
      },
    });
    scrollPanel.getBoundingClientRect = () => ({ top: 0, bottom: 200, left: 0, right: 0, width: 0, height: 200 });

    const eventRows = container.querySelectorAll(".sequencer-event-row");
    eventRows[0].getBoundingClientRect = () => ({ top: 120 - scrollTopValue, bottom: 150 - scrollTopValue, left: 0, right: 0, width: 0, height: 30 });
    eventRows[1].getBoundingClientRect = () => ({ top: 320 - scrollTopValue, bottom: 350 - scrollTopValue, left: 0, right: 0, width: 0, height: 30 });
    eventRows[2].getBoundingClientRect = () => ({ top: 680 - scrollTopValue, bottom: 710 - scrollTopValue, left: 0, right: 0, width: 0, height: 30 });
    eventRows[3].getBoundingClientRect = () => ({ top: 760 - scrollTopValue, bottom: 790 - scrollTopValue, left: 0, right: 0, width: 0, height: 30 });
    const originalElementRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getCueStepRect() {
      if (this.dataset?.sequenceEventId === "11:b:attack:0.25") {
        return {
          top: 680 - scrollTopValue,
          bottom: 710 - scrollTopValue,
          left: 0,
          right: 0,
          width: 0,
          height: 30,
        };
      }
      return originalElementRect.call(this);
    };

    fireEvent.change(screen.getByLabelText("next cue target"), {
      target: { value: "1" },
    });

    expect(scrollTopValue).toBe(516);
    expect(scrollWriteCount).toBe(1);
    const linedUpScrollTop = scrollTopValue;
    const linedUpScrollWriteCount = scrollWriteCount;

    fireEvent.click(screen.getByLabelText("next sequence marker"));

    expect(scrollTopValue).toBe(linedUpScrollTop);
    expect(scrollWriteCount).toBe(linedUpScrollWriteCount);
    expect(container.querySelectorAll(".sequencer-event__kind--active")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("next sequence marker"));

    expect(scrollTopValue).not.toBe(linedUpScrollTop);
    expect(scrollWriteCount).toBe(linedUpScrollWriteCount + 1);
    expect(container.querySelectorAll(".sequencer-event__kind--active")).toHaveLength(1);

    scrollTopValue = 275;
    fireEvent.input(screen.getByLabelText("snapshot 2 attack offset"), {
      currentTarget: { value: "0.5" },
      target: { value: "0.5" },
    });
    fireEvent.click(screen.getByLabelText("commit snapshot 2 attack sequence placement"));

    expect(scrollTopValue).toBe(275);

    HTMLElement.prototype.getBoundingClientRect = originalElementRect;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  it("tracks Flight sounding notes forward through cue 17 and backward after manual scrolling", async () => {
    const sequenceEvents = deriveSequenceEvents(
      flightSequence.snapshots,
      flightSequence.bars,
      flightSequence.tempi,
      flightSequence.repeats,
    );
    const cueGroups = deriveSequenceCueGroups(
      flightSequence.snapshots,
      flightSequence.bars,
      flightSequence.tempi,
      flightSequence.repeats,
    );
    const eventOrderById = new Map();
    const eventCountBySnapshot = new Map();
    sequenceEvents.forEach((event) => {
      if (event.type !== "note") return;
      const order = eventCountBySnapshot.get(event.snapshotIndex) ?? 0;
      eventOrderById.set(event.eventId, { snapshotIndex: event.snapshotIndex, order });
      eventCountBySnapshot.set(event.snapshotIndex, order + 1);
    });
    const originalElementRect = HTMLElement.prototype.getBoundingClientRect;
    let scrollTop = 0;
    HTMLElement.prototype.getBoundingClientRect = function getFlightCueRect() {
      if (this.classList?.contains("sequencer-scroll-panel")) {
        return { top: 0, bottom: 300, left: 0, right: 600, width: 600, height: 300 };
      }
      if (this.dataset?.sequenceVirtualIndex != null) {
        const index = Number(this.dataset.sequenceVirtualIndex);
        const top = (index * 220) - scrollTop;
        return { top, bottom: top + 200, left: 0, right: 600, width: 600, height: 200 };
      }
      if (this.dataset?.sequenceEventId != null) {
        const eventPosition = eventOrderById.get(this.dataset.sequenceEventId);
        if (eventPosition) {
          const top = (eventPosition.snapshotIndex * 220)
            + 42
            + (eventPosition.order * 24)
            - scrollTop;
          return { top, bottom: top + 22, left: 0, right: 600, width: 600, height: 22 };
        }
      }
      if (
        this.classList?.contains("sequencer-list")
        || this.classList?.contains("sequencer-virtual-list")
      ) {
        return {
          top: -scrollTop,
          bottom: (flightSequence.snapshots.length * 220) - scrollTop,
          left: 0,
          right: 600,
          width: 600,
          height: flightSequence.snapshots.length * 220,
        };
      }
      return originalElementRect.call(this);
    };

    const baseProps = {
      bars: flightSequence.bars,
      tempi: flightSequence.tempi,
      repeats: flightSequence.repeats,
      snapshotLabelMode: "labels",
      selectedMarker: null,
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
      activeSequenceName: "Flight",
      activeSequenceDescription: "",
      sequenceLegato: true,
      snapshots: flightSequence.snapshots,
      pendingTransportSelection: { snapshotIndex: null, cueIndex: null },
    };

    function Harness() {
      const [markerIndex, setMarkerIndex] = useState(10);
      const cueGroup = cueGroups[markerIndex];
      const snapshot = flightSequence.snapshots[cueGroup.snapshotIndex];
      return (
        <Sequencer
          {...baseProps}
          selectedSnapshotId={snapshot.id}
          playingSnapshotId={snapshot.id}
          playhead={{
            barIndex: 0,
            stepIndex: cueGroup.snapshotIndex,
            markerIndex,
            stopped: false,
          }}
          onStepSequenceMarker={(direction) => {
            setMarkerIndex((current) => Math.max(0, Math.min(cueGroups.length - 1, current + direction)));
          }}
          onJumpSequenceCue={setMarkerIndex}
        />
      );
    }

    const { container } = render(<Harness />);
    const panel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(panel, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: flightSequence.snapshots.length * 220,
    });
    Object.defineProperty(panel, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = value;
      },
    });
    const eventNodeFor = (eventId) => [...container.querySelectorAll("[data-sequence-event-id]")]
      .find((node) => node.dataset.sequenceEventId === eventId) ?? null;
    const expectCueAnchorVisible = async (cueIndexZeroBased) => {
      const plan = deriveCueViewportPlan({ cueIndexZeroBased, sequenceEvents });
      await waitFor(() => {
        const node = eventNodeFor(plan.overflowEventId);
        expect(node).toBeTruthy();
        const rect = node.getBoundingClientRect();
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(rect.bottom).toBeLessThanOrEqual(300);
      });
    };

    for (let cueIndex = 11; cueIndex <= 16; cueIndex += 1) {
      fireEvent.click(screen.getByLabelText("next sequence marker"));
      await expectCueAnchorVisible(cueIndex);
    }

    scrollTop = 18000;
    fireEvent.wheel(panel);
    fireEvent.scroll(panel);

    for (let cueIndex = 15; cueIndex >= 9; cueIndex -= 1) {
      fireEvent.click(screen.getByLabelText("previous sequence marker"));
      await expectCueAnchorVisible(cueIndex);
    }

    fireEvent.change(screen.getByLabelText("next cue target"), {
      target: { value: "58" },
    });
    await expectCueAnchorVisible(58);

    HTMLElement.prototype.getBoundingClientRect = originalElementRect;
  }, 30000);

  it("top-aligns snapshot selection, stepping, and Edit & Play layout changes identically", () => {
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

    function Harness() {
      const [playhead, setPlayhead] = useState({
        barIndex: 0,
        stepIndex: 0,
        markerIndex: null,
        stopped: true,
      });
      return (
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
        playhead={playhead}
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
        onStepSequence={(direction) => {
          setPlayhead((current) => ({
            ...current,
            stepIndex: current.stepIndex + direction,
          }));
        }}
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
        />
      );
    }

    const { container } = render(<Harness />);

    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(scrollPanel, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollPanel, "scrollHeight", { configurable: true, value: 1000 });
    let scrollTopValue = 300;
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
    snapshotRows[1].getBoundingClientRect = () => ({ top: 120, bottom: 150, left: 0, right: 0, width: 0, height: 30 });
    const snapshotGroups = container.querySelectorAll(".sequencer-virtual-item");
    snapshotGroups[0].getBoundingClientRect = () => ({
      top: 360 - scrollTopValue,
      bottom: 390 - scrollTopValue,
      left: 0,
      right: 0,
      width: 0,
      height: 30,
    });
    snapshotGroups[1].getBoundingClientRect = () => ({
      top: 420 - scrollTopValue,
      bottom: 450 - scrollTopValue,
      left: 0,
      right: 0,
      width: 0,
      height: 30,
    });

    fireEvent.change(screen.getByLabelText("next snapshot target"), { target: { value: "1" } });

    expect(scrollTopValue).toBe(414);

    scrollTopValue = 300;
    fireEvent.click(screen.getByLabelText("next sequence step"));

    expect(scrollTopValue).toBe(414);

    scrollTopValue = 300;
    fireEvent.click(screen.getByTitle("Collapse to snapshot view"));

    expect(scrollTopValue).toBe(414);

    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  it("scrolls back to the top when the transport is reset to the beginning", () => {
    const onResetSequencePlayhead = vi.fn();

    const { container } = render(
      <Sequencer
        snapshots={[
          { id: 10, length: 1, description: "A", notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] },
          { id: 11, length: 1, description: "B", notes: [{ id: "b", midicents: 72, start: 0, end: 1 }] },
        ]}
        bars={[{ id: 1, position: 1 }, { id: 2, position: 2 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={11}
        selectedMarker={null}
        pendingTransportSelection={{ snapshotIndex: 1, cueIndex: 1 }}
        playingSnapshotId={null}
        playhead={{ barIndex: 1, stepIndex: 1, markerIndex: null, stopped: true }}
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
        onJumpSequenceSnapshot={vi.fn()}
        onJumpSequenceCue={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={onResetSequencePlayhead}
        onAddBar={vi.fn()}
        onAddTempo={vi.fn()}
        onAddRepeat={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onDeleteTempo={vi.fn()}
        onDeleteRepeat={vi.fn()}
        onUpdateBar={vi.fn()}
        onUpdateTempo={vi.fn()}
        onUpdateRepeat={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onDeleteAllSnapshots={vi.fn()}
        onClearSequence={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onDuplicateSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceSavedName=""
        activeSequenceDescription=""
        sequenceLegato
        snapSequenceToCurrentTuning={false}
        sequenceAutoCreateBars
      />,
    );

    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    let scrollTopValue = 240;
    Object.defineProperty(scrollPanel, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollTopValue = value;
      },
    });

    fireEvent.click(screen.getByLabelText("move sequence playhead to start"));

    expect(scrollTopValue).toBe(0);
    expect(onResetSequencePlayhead).toHaveBeenCalledTimes(1);
  });

  it("scrolls to the bottom when the transport jumps to the end", () => {
    const onJumpSequenceEnd = vi.fn();

    const { container } = render(
      <Sequencer
        snapshots={[
          { id: 10, length: 1, description: "A", notes: [{ id: "a", midicents: 69, start: 0, end: 1 }] },
          { id: 11, length: 1, description: "B", notes: [{ id: "b", midicents: 72, start: 0, end: 1 }] },
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
        onJumpSequenceSnapshot={vi.fn()}
        onJumpSequenceCue={vi.fn()}
        onPlaySequence={vi.fn()}
        onPlayCue={vi.fn()}
        onResetSequencePlayhead={vi.fn()}
        onJumpSequenceEnd={onJumpSequenceEnd}
        onAddBar={vi.fn()}
        onAddTempo={vi.fn()}
        onAddRepeat={vi.fn()}
        onAddBarsBeforeSnapshots={vi.fn()}
        onDeleteBar={vi.fn()}
        onDeleteTempo={vi.fn()}
        onDeleteRepeat={vi.fn()}
        onUpdateBar={vi.fn()}
        onUpdateTempo={vi.fn()}
        onUpdateRepeat={vi.fn()}
        onMoveBar={vi.fn()}
        onDeleteSnapshot={vi.fn()}
        onDeleteAllSnapshots={vi.fn()}
        onClearSequence={vi.fn()}
        onMoveSnapshot={vi.fn()}
        onDuplicateSnapshot={vi.fn()}
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
        activeSequenceName=""
        activeSequenceSavedName=""
        activeSequenceDescription=""
        sequenceLegato
        snapSequenceToCurrentTuning={false}
        sequenceAutoCreateBars
      />,
    );

    const scrollPanel = container.querySelector(".sequencer-scroll-panel");
    Object.defineProperty(scrollPanel, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scrollPanel, "clientHeight", { configurable: true, value: 320 });
    let scrollTopValue = 24;
    Object.defineProperty(scrollPanel, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value) => {
        scrollTopValue = value;
      },
    });

    fireEvent.click(screen.getByLabelText("move sequence playhead to end"));

    expect(scrollTopValue).toBe(680);
    expect(onJumpSequenceEnd).toHaveBeenCalledTimes(1);
  });

  it("bottom-aligns the most recent sounding note when a pending cue span does not fit", () => {
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
            notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1.5 }],
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

    const snapshotGroups = container.querySelectorAll(".sequencer-virtual-item");
    snapshotGroups[0].getBoundingClientRect = () => ({
      top: 100,
      bottom: 350,
      left: 0,
      right: 0,
      width: 0,
      height: 250,
    });
    snapshotGroups[1].getBoundingClientRect = () => ({
      top: 350,
      bottom: 710,
      left: 0,
      right: 0,
      width: 0,
      height: 360,
    });
    const eventRows = container.querySelectorAll(".sequencer-event-row");
    eventRows[0].getBoundingClientRect = () => ({ top: 120, bottom: 150, left: 0, right: 0, width: 0, height: 30 });
    eventRows[1].getBoundingClientRect = () => ({ top: 320, bottom: 350, left: 0, right: 0, width: 0, height: 30 });
    eventRows[2].getBoundingClientRect = () => ({ top: 680, bottom: 710, left: 0, right: 0, width: 0, height: 30 });

    fireEvent.change(screen.getByLabelText("next cue target"), { target: { value: "1" } });

    expect(scrollTopValue).toBe(516);

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

    expect(screen.getByLabelText("snapshot 1 events")).toBeTruthy();
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

    expect(screen.getByLabelText("snapshot 1 events")).toBeTruthy();
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

    expect(screen.queryByText("Snapshot Labels")).not.toBeNull();
    expect(screen.queryByText("Choose Tempo Position")).toBeNull();
    expect(screen.queryByText("Choose Bar Position")).toBeNull();
    expect(screen.queryByText("Auto-Create Bars")).toBeNull();
    expect(screen.queryByText("Legato")).not.toBeNull();
    expect(screen.queryByText("Auto-Scroll")).not.toBeNull();
    expect(screen.queryByText("Snap Sequence to Current Hexatone Tuning")).not.toBeNull();
  });

  it("selects a snapshot on first click in collapsed view and only expands it on second click", () => {
    const Harness = () => {
      const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);

      return (
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
          selectedSnapshotId={selectedSnapshotId}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onLoadSequence={vi.fn()}
          onSequenceNameChange={vi.fn()}
          onSequenceDescriptionChange={vi.fn()}
          onSequenceLegatoChange={vi.fn()}
          onSetSnapshotLabelMode={vi.fn()}
          onSelectSnapshot={setSelectedSnapshotId}
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
        />
      );
    };

    render(<Harness />);

    fireEvent.click(screen.getByTitle("Collapse to snapshot view"));
    expect(screen.queryByLabelText("snapshot 1 events")).toBeNull();

    fireEvent.click(screen.getByText("1 note"));
    expect(screen.queryByLabelText("snapshot 1 events")).toBeNull();

    fireEvent.click(screen.getByText("1 note"));
    expect(screen.getByLabelText("snapshot 1 events")).toBeTruthy();
  });

  it("sets the Copy & Insert range from snapshot selection in open and collapsed views", () => {
    const snapshots = [
      {
        id: 10,
        length: 1,
        description: "First",
        notes: [{ id: "a", midicents: 69, displayLabel: "A", start: 0, end: 1 }],
      },
      {
        id: 11,
        length: 1,
        description: "Second",
        notes: [{ id: "b", midicents: 72, displayLabel: "C", start: 0, end: 1 }],
      },
    ];

    const Harness = () => {
      const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);
      return (
        <>
          <button type="button" onClick={() => setSelectedSnapshotId(10)}>
            Select snapshot after action
          </button>
          <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={selectedSnapshotId}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: 0, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onLoadSequence={vi.fn()}
          onSequenceNameChange={vi.fn()}
          onSequenceDescriptionChange={vi.fn()}
          onSequenceLegatoChange={vi.fn()}
          onSetSnapshotLabelMode={vi.fn()}
          onSelectSnapshot={setSelectedSnapshotId}
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
          />
        </>
      );
    };

    render(<Harness />);

    const rangeStart = screen.getByLabelText("copy snapshot range start");
    const rangeEnd = screen.getByLabelText("copy snapshot range end");
    fireEvent.click(screen.getByLabelText("snapshot 2 description"));
    expect(rangeStart.value).toBe("2");
    expect(rangeEnd.value).toBe("2");

    fireEvent.input(rangeStart, { target: { value: "1" } });
    fireEvent.input(rangeEnd, { target: { value: "1" } });
    fireEvent.click(screen.getByTitle("Collapse to snapshot view"));
    fireEvent.click(screen.getByLabelText("snapshot 2 description"));

    expect(rangeStart.value).toBe("2");
    expect(rangeEnd.value).toBe("2");

    fireEvent.input(rangeStart, { target: { value: "1" } });
    fireEvent.input(rangeEnd, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Select snapshot after action" }));
    expect(rangeStart.value).toBe("1");
    expect(rangeEnd.value).toBe("1");
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
    const snapshotTarget = screen.getByLabelText("next snapshot target");
    const cueTarget = screen.getByLabelText("next cue target");
    const playButton = screen.getByLabelText("play current sequence position");
    expect(snapshotTarget.dataset.playFromActive).toBe("true");
    expect(cueTarget.dataset.playFromActive).toBe("false");

    fireEvent.mouseDown(screen.getByLabelText("next sequence marker"));
    fireEvent.click(screen.getByLabelText("next sequence marker"));
    expect(onStepSequenceMarker).toHaveBeenCalledWith(1);
    expect(snapshotTarget.dataset.playFromActive).toBe("false");
    expect(cueTarget.dataset.playFromActive).toBe("true");
    fireEvent.click(playButton);
    expect(onPlayCue).toHaveBeenCalledWith(0);
    expect(onPlaySequence).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("next sequence step"));
    expect(snapshotTarget.dataset.playFromActive).toBe("true");
    expect(cueTarget.dataset.playFromActive).toBe("false");
    fireEvent.click(playButton);
    expect(onPlaySequence).toHaveBeenCalledTimes(1);

    fireEvent.change(container.querySelector('[data-timed-transport-field="bar"]'), {
      target: { value: "1" },
    });
    expect(snapshotTarget.dataset.playFromActive).toBe("false");
    expect(cueTarget.dataset.playFromActive).toBe("true");
    fireEvent.click(playButton);
    expect(onPlayCue).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByLabelText("move sequence playhead to start"));
    expect(onResetSequencePlayhead).toHaveBeenCalledTimes(1);
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
    expect(screen.getByLabelText("bar 1 position").value).toBe("1");
    expect(screen.getByLabelText("bar 2 position").value).toBe("2");
    expect(screen.getAllByText("MIDI¢").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("show expression controls")).not.toBeNull();
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 release midicents")[0].value).toBe("81.000");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).toBe("880.0");
    expect(screen.getAllByLabelText("snapshot 1 release frequency")[0].value).toBe("880.0");
    expect(screen.getAllByLabelText("snapshot 1 attack name").map((node) => node.value)).toContain("A");
    expect(screen.getAllByLabelText("snapshot 1 release name").map((node) => node.value)).toContain("F");
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

  it("moves an event to another snapshot when its snapshot number is committed", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 82,
          length: 1,
          description: "Earlier",
          notes: [],
        },
        {
          id: 83,
          length: 1,
          description: "Later",
          notes: [
            {
              id: "a",
              midicents: 81,
              start: 0.5,
              end: 1,
            },
          ],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={83}
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

    expect(screen.getByLabelText("snapshot 2 attack snapshot").value).toBe("2");
    expect(screen.getByLabelText("snapshot 2 attack offset").value).toBe("0.500");

    fireEvent.input(screen.getByLabelText("snapshot 2 attack snapshot"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    fireEvent.click(screen.getByLabelText("commit snapshot 2 attack sequence placement"));

    expect(screen.queryByLabelText("snapshot 2 attack snapshot")).toBeNull();
    expect(screen.getByLabelText("snapshot 1 attack snapshot").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 attack offset").value).toBe("1.500");
  });

  it("moves an anonymous captured event to another snapshot without duplicating it", () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 82,
          length: 1,
          description: "Earlier",
          notes: [],
        },
        {
          id: 83,
          length: 1,
          description: "Later",
          notes: [
            {
              midicents: 81,
              start: 0.5,
              end: 1,
            },
          ],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
          bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
          snapshotLabelMode="labels"
          selectedSnapshotId={83}
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

    fireEvent.input(screen.getByLabelText("snapshot 2 attack snapshot"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    fireEvent.click(screen.getByLabelText("commit snapshot 2 attack sequence placement"));

    expect(screen.queryByLabelText("snapshot 2 attack snapshot")).toBeNull();
    expect(screen.getByLabelText("snapshot 1 attack snapshot").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 attack offset").value).toBe("1.500");
    expect(screen.getAllByText("on")).toHaveLength(1);
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
    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("A");
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

  it("does not clear snapshot or cue selection by re-dispatching bar selection", () => {
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
    expect(onSelectSequenceBar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("next cue target"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    expect(onSelectSequenceBar).not.toHaveBeenCalled();
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

  it("commits the latest release draft when a note-off is pushed into the next bar", () => {
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

    fireEvent.input(screen.getByLabelText("snapshot 1 release bar"), {
      currentTarget: { value: "2" },
      target: { value: "2" },
    });
    fireEvent.input(screen.getByLabelText("snapshot 1 release beat"), {
      currentTarget: { value: "2" },
      target: { value: "2" },
    });
    fireEvent.input(screen.getByLabelText("snapshot 1 release beat fraction numerator"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    fireEvent.input(screen.getByLabelText("snapshot 1 release beat fraction denominator"), {
      currentTarget: { value: "2" },
      target: { value: "2" },
    });
    fireEvent.click(screen.getByLabelText("commit snapshot 1 release bar-relative timing"));

    expect(onUpdateSnapshot).toHaveBeenLastCalledWith(10, {
      notes: [expect.objectContaining({ id: "a", end: 1.5, endFractionDenominator: 2 })],
    });
  });

  it("preserves a user-edited equivalent denominator like 2/6 after commit and rerender", async () => {
    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
        {
          id: 10,
          length: 1,
          description: "A",
          notes: [
            {
              id: "a",
              midicents: 81,
              start: 0.083333,
              end: 1,
              startFractionDenominator: 3,
            },
          ],
        },
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
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

    expect(screen.getByLabelText("snapshot 1 attack beat fraction numerator").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 attack beat fraction denominator").value).toBe("3");

    fireEvent.input(screen.getByLabelText("snapshot 1 attack beat fraction numerator"), {
      currentTarget: { value: "2" },
      target: { value: "2" },
    });
    fireEvent.input(screen.getByLabelText("snapshot 1 attack beat fraction denominator"), {
      currentTarget: { value: "6" },
      target: { value: "6" },
    });
    fireEvent.click(screen.getByLabelText("commit snapshot 1 attack bar-relative timing"));

    await waitFor(() => {
      expect(screen.getByLabelText("snapshot 1 attack beat fraction numerator").value).toBe("2");
      expect(screen.getByLabelText("snapshot 1 attack beat fraction denominator").value).toBe("6");
    });
  });

  it("records a derived post-commit diagnostic for numeric snapshot ids", async () => {
    localStorage.setItem("hexatone_debug_sequencer_crash", "true");
    sessionStorage.removeItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY);

    const Harness = () => {
      const [snapshots, setSnapshots] = useState([
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
      ]);

      return (
        <Sequencer
          snapshots={snapshots}
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

    fireEvent.input(screen.getByLabelText("snapshot 1 attack beat"), {
      currentTarget: { value: "2" },
      target: { value: "2" },
    });
    fireEvent.input(screen.getByLabelText("snapshot 1 attack beat fraction numerator"), {
      currentTarget: { value: "1" },
      target: { value: "1" },
    });
    fireEvent.input(screen.getByLabelText("snapshot 1 attack beat fraction denominator"), {
      currentTarget: { value: "4" },
      target: { value: "4" },
    });
    fireEvent.click(screen.getByLabelText("commit snapshot 1 attack bar-relative timing"));

    await waitFor(() => {
      const persisted = loadPersistedSequencerCrashDiagnostics();
      const derivedEntry = [...(persisted?.state?.entries ?? [])]
        .reverse()
        .find((entry) => entry?.type === "event-derived-post-commit") ?? null;
      expect(derivedEntry).not.toBeNull();
      expect(derivedEntry?.context).toMatchObject({
        snapshotId: "10",
        noteId: "a",
        resolvedNoteId: "a",
        eventAbsoluteTime: 1.3125,
        derivedBarNumber: 1,
        derivedBeat: 2,
        derivedNumerator: 1,
        derivedDenominator: 4,
      });
    });

    localStorage.removeItem("hexatone_debug_sequencer_crash");
    sessionStorage.removeItem(SEQUENCER_CRASH_DIAGNOSTICS_STORAGE_KEY);
  });

  it("shows exact note-off barlines as the end of the current bar", () => {
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
        onUpdateSnapshot={vi.fn()}
        onResetSnapshotDescription={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("snapshot 1 release bar").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 release beat").value).toBe("4");
    expect(screen.getByLabelText("snapshot 1 release beat fraction numerator").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 release beat fraction denominator").value).toBe("1");
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

  it("clamps bar numerators below 1 to 1 when editing a time signature", () => {
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

    expect(onUpdateBar).toHaveBeenCalledWith(1, { numerator: 1 });
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

    fireEvent.click(screen.getAllByText("Save current sequence")[0]);

    expect(loadUserSequences()[0].bars).toEqual([
      { id: 1, position: 1, numerator: 4, denominator: 4 },
      { id: 2, position: 2, numerator: 3, denominator: 2 },
    ]);
  });

  it("renders imported bar signatures correctly after selecting a stored sequence from a fresh state", async () => {
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

    fireEvent.change(screen.getByLabelText("User sequences"), {
      currentTarget: { value: "FALL" },
      target: { value: "FALL" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("bar 1 beats per bar").value).toBe("1");
      expect(screen.getByLabelText("bar 1 beat unit").value).toBe("1");
      expect(screen.getByLabelText("bar 2 beats per bar").value).toBe("3");
      expect(screen.getByLabelText("bar 2 beat unit").value).toBe("2");
    });
  });

  it("updates the visible snapshot description when the snapshot label mode changes", async () => {
    const Harness = () => {
      const [snapshotLabelMode, setSnapshotLabelMode] = useState("proportion");
      const snapshots = [
        {
          id: 1,
          length: 1,
          description: "stale",
          descriptionManual: false,
          notes: [
            { id: "a", midicents: 69, ratioText: "5/4", displayLabel: "E" },
            { id: "b", midicents: 72, ratioText: "3/2", displayLabel: "G" },
          ],
        },
      ];

      const displaySnapshots = snapshots.map((snapshot) => ({
        ...snapshot,
        description: buildSnapshotDescription(snapshot.notes, snapshotLabelMode),
      }));

      return (
        <Sequencer
          snapshots={snapshots}
          displaySnapshots={displaySnapshots}
          bars={normalizeBarMarkers([{ id: 1, position: 1 }])}
          repeats={[]}
          tempi={normalizeTempoMarkers([{ id: 1, position: 1, bpm: 60, beatLength: 1 }])}
          snapshotLabelMode={snapshotLabelMode}
          activeSequenceName="Test"
          activeSequenceSavedName=""
          activeSequenceDescription=""
          sequenceLegato
          sequenceAutoCreateBars
          selectedSnapshotId={null}
          selectedMarker={null}
          playingSnapshotId={null}
          playhead={{ barIndex: 0, stepIndex: -1, markerIndex: null, stopped: true }}
          onTakeSnapshot={vi.fn()}
          onAddEmptySnapshot={vi.fn()}
          onLoadSequence={vi.fn()}
          onSequenceNameChange={vi.fn()}
          onSequenceDescriptionChange={vi.fn()}
          onSequenceSaved={vi.fn()}
          onSequenceLegatoChange={vi.fn()}
          onSnapSequenceToCurrentTuningChange={vi.fn()}
          onSequenceAutoCreateBarsChange={vi.fn()}
          onSetSnapshotLabelMode={setSnapshotLabelMode}
          onSelectSnapshot={vi.fn()}
          onSelectMarker={vi.fn()}
          onPlaySnapshot={vi.fn()}
          onStopSnapshot={vi.fn()}
          onSelectSequenceBar={vi.fn()}
          onCueSequenceSnapshot={vi.fn()}
          onCueSequenceCue={vi.fn()}
          onStepSequence={vi.fn()}
          onStepSequenceMarker={vi.fn()}
          onJumpSequenceSnapshot={vi.fn()}
          onJumpSequenceCue={vi.fn()}
          onPlaySequence={vi.fn()}
          onPlayCue={vi.fn()}
          onPlayTimedCue={vi.fn()}
          onResetSequencePlayhead={vi.fn()}
          onJumpSequenceEnd={vi.fn()}
          getTimedTransportClockSeconds={() => 0}
          onAddBar={vi.fn()}
          onAddTempo={vi.fn()}
          onAddRepeat={vi.fn()}
          onAddBarsBeforeSnapshots={vi.fn()}
          onDeleteBar={vi.fn()}
          onDeleteTempo={vi.fn()}
          onDeleteRepeat={vi.fn()}
          onUpdateBar={vi.fn()}
          onUpdateTempo={vi.fn()}
          onUpdateRepeat={vi.fn()}
          onMoveBar={vi.fn()}
          onDeleteSnapshot={vi.fn()}
          onDeleteAllSnapshots={vi.fn()}
          onClearSequence={vi.fn()}
          onMoveSnapshot={vi.fn()}
          onDuplicateSnapshot={vi.fn()}
          onUpdateSnapshot={vi.fn()}
          onResetSnapshotDescription={vi.fn()}
        />
      );
    };

    render(<Harness />);

    const descriptionInput = screen.getByLabelText("snapshot 1 description");
    expect(descriptionInput.value).toBe("5:6");

    fireEvent.change(screen.getByLabelText("Snapshot Labels"), {
      currentTarget: { value: "labels" },
      target: { value: "labels" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("snapshot 1 description").value).toBe("E, G");
    });
  });

  it("preserves the fractional offset when the user changes beat", () => {
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
      notes: [expect.objectContaining({ id: "a", start: 0.5, end: 1 })],
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

    expect([...container.querySelectorAll(".sequencer-events-grid .sequencer-event__position")].map((node) => node.value))
      .toEqual(["0.000", "0.100", "1.000", "1.000"]);
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

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack offset");
    positionInputs[1].focus();
    expect(document.activeElement).toBe(positionInputs[1]);
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "0.100000" },
      target: { value: "0.100000" },
    });
    expect(document.activeElement).toBe(positionInputs[1]);
    expect(screen.getByLabelText("commit snapshot 1 attack sequence placement")).toBeTruthy();
    expect(screen.getByLabelText("cancel snapshot 1 attack sequence placement")).toBeTruthy();
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });

    expect([...container.querySelectorAll(".sequencer-events-grid .sequencer-event__position")].map((node) => node.value))
      .toEqual(["0.000", "0.100", "1.000", "1.000"]);
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

    const positionInputs = screen.getAllByLabelText("snapshot 1 attack offset");
    positionInputs[1].focus();
    fireEvent.input(positionInputs[1], {
      currentTarget: { value: "0.200000" },
      target: { value: "0.200000" },
    });
    fireEvent.keyDown(positionInputs[1], { key: "Enter" });

    expect([...container.querySelectorAll(".sequencer-events-grid .sequencer-event__position")].map((node) => node.value))
      .toEqual(["0.000", "0.000", "0.200", "1.000", "1.000", "1.000"]);
    expect([...container.querySelectorAll(".sequencer-event__cue-number")].map((node) => node.textContent))
      .toEqual(["1", "2", "3"]);
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
    expect(Array.from(snapshotTargetSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["1", "(end)"]);
    expect(Array.from(cueTargetSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["1", "2", "(end)"]);
    expect(snapshotTargetSelect.value).toBe("__end__");
    expect(cueTargetSelect.value).toBe("__end__");
    expect(screen.getByLabelText("next sequence step").disabled).toBe(false);
    expect(screen.getByLabelText("next sequence marker").disabled).toBe(false);

    fireEvent.click(screen.getByLabelText("next sequence step"));
    expect(onJumpSequenceSnapshot).toHaveBeenCalledWith(0);

    fireEvent.click(screen.getByLabelText("next sequence marker"));
    expect(onJumpSequenceCue).toHaveBeenCalledWith(0);
  });

  it("shows the next snapshot and cue in brackets when a bar is selected", () => {
    const onStepSequence = vi.fn();
    const onStepSequenceMarker = vi.fn();
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
        onStepSequence={onStepSequence}
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
    expect(screen.getByLabelText("previous sequence step").disabled).toBe(false);
    expect(screen.getByLabelText("previous sequence marker").disabled).toBe(false);

    fireEvent.click(screen.getByLabelText("previous sequence step"));
    fireEvent.click(screen.getByLabelText("next sequence step"));
    expect(onStepSequence.mock.calls.map(([direction]) => direction)).toEqual([-1, 1]);

    fireEvent.click(screen.getByLabelText("previous sequence marker"));
    fireEvent.click(screen.getByLabelText("next sequence marker"));
    expect(onStepSequenceMarker.mock.calls.map(([direction]) => direction)).toEqual([-1, 1]);
  });

  it("shows the selected snapshot and its first cue in brackets when a snapshot is selected", () => {
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
        selectedSnapshotId={11}
        selectedMarker={null}
        pendingTransportSelection={{ snapshotIndex: 1, cueIndex: 1 }}
        playingSnapshotId={null}
        playhead={{ barIndex: 1, stepIndex: 1, markerIndex: null, stopped: true }}
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

  it("shows the selected snapshot in brackets even when the playhead remains off", () => {
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
        selectedSnapshotId={11}
        selectedMarker={null}
        pendingTransportSelection={{ snapshotIndex: 1, cueIndex: 1 }}
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
    expect(Array.from(snapshotTargetSelect.querySelectorAll("option")).map((option) => option.textContent)).toEqual(["1", "(2)"]);
    expect(snapshotTargetSelect.value).toBe("1");
  });

  it("keeps the containing snapshot and selected cue bracketed when a cue is armed", () => {
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
        selectedSnapshotId={11}
        selectedMarker={2}
        pendingTransportSelection={{ snapshotIndex: 1, cueIndex: 1 }}
        playingSnapshotId={null}
        playhead={{ barIndex: 1, stepIndex: 1, markerIndex: 1, stopped: true }}
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
    expect(onAddBar).toHaveBeenCalledWith(2, 3, 2);

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

    expect(screen.getByLabelText("bar 1 position").value).toBe("1");
    expect(screen.getByLabelText("bar 2 position").value).toBe("2");

    const expandedTimes = [...container.querySelectorAll(".sequencer-events-grid .sequencer-event__position")]
      .map((node) => node.value);
    expect(expandedTimes).toEqual(["0.000", "0.750", "1.000", "1.000", "2"]);
  });

  it("defaults the next bar controls to the end of the sequence and inherits the previous meter", () => {
    render(
      <Sequencer
        snapshots={[
          { id: 1, length: 1, description: "A", notes: [] },
          { id: 2, length: 1, description: "B", notes: [] },
          { id: 3, length: 1, description: "C", notes: [] },
        ]}
        bars={[{ id: 1, position: 1, numerator: 3, denominator: 2 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={1}
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
      />,
    );

    expect(screen.getByLabelText("new bar position").value).toBe("4");
    expect(screen.getByLabelText("new bar numerator").value).toBe("3");
    expect(screen.getByLabelText("new bar denominator").value).toBe("2");
  });

  it("advances the next bar defaults after an explicit last bar beyond the snapshot end", () => {
    render(
      <Sequencer
        snapshots={[
          { id: 1, length: 1, description: "A", notes: [] },
          { id: 2, length: 1, description: "B", notes: [] },
          { id: 3, length: 1, description: "C", notes: [] },
        ]}
        bars={[
          { id: 1, position: 1, numerator: 4, denominator: 4 },
          { id: 2, position: 5, numerator: 7, denominator: 8 },
        ]}
        snapshotLabelMode="labels"
        selectedSnapshotId={1}
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
      />,
    );

    expect(screen.getByLabelText("new bar position").value).toBe("6");
    expect(screen.getByLabelText("new bar numerator").value).toBe("7");
    expect(screen.getByLabelText("new bar denominator").value).toBe("8");
  });

  it("keeps a manually typed end-position bar value active until the bar is created, then restores the next suggested hint", () => {
    const onAddBar = vi.fn();

    render(
      <Sequencer
        snapshots={[
          { id: 1, length: 1, description: "A", notes: [] },
          { id: 2, length: 1, description: "B", notes: [] },
          { id: 3, length: 1, description: "C", notes: [] },
        ]}
        bars={[{ id: 1, position: 1, numerator: 4, denominator: 4 }]}
        snapshotLabelMode="labels"
        selectedSnapshotId={1}
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
        onAddBar={onAddBar}
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

    const positionInput = screen.getByLabelText("new bar position");
    expect(positionInput.value).toBe("4");
    expect(positionInput.className).toContain("sequencer-bars-add__position--hint");

    fireEvent.input(positionInput, { target: { value: "4" } });
    expect(positionInput.value).toBe("4");
    expect(positionInput.className).not.toContain("sequencer-bars-add__position--hint");

    fireEvent.click(screen.getByText("Add Bar"));
    expect(onAddBar).toHaveBeenCalledWith(4, 4, 4);
    expect(positionInput.value).toBe("4");
    expect(positionInput.className).toContain("sequencer-bars-add__position--hint");
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

  it("normalizes legacy 0/1 bars to ordinary editable beat-1 timing fields", () => {
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

    expect(screen.getByLabelText("snapshot 1 attack beat").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 attack beat fraction numerator").value).toBe("0");
    expect(screen.getByLabelText("snapshot 1 attack beat fraction denominator").value).toBe("1");
    expect(screen.getByLabelText("snapshot 1 attack beat").disabled).toBe(false);
    expect(screen.getByLabelText("snapshot 1 attack beat fraction numerator").disabled).toBe(false);
    expect(screen.getByLabelText("snapshot 1 attack beat fraction denominator").disabled).toBe(false);
    expect(screen.getByLabelText("tempo beat").value).toBe("1");
    expect(screen.getByLabelText("tempo beat fraction numerator").value).toBe("0");
    expect(screen.getByLabelText("tempo beat fraction denominator").value).toBe("1");
    expect(screen.getByLabelText("tempo beat").disabled).toBe(false);
    expect(screen.getByLabelText("tempo beat fraction numerator").disabled).toBe(false);
    expect(screen.getByLabelText("tempo beat fraction denominator").disabled).toBe(false);
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

    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("edited");
    expect(screen.getByLabelText("restore snapshot 1 attack captured pitch and name")).not.toBeNull();
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("70.500");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).not.toBe("440.0");

    fireEvent.click(screen.getByLabelText("restore snapshot 1 attack captured pitch and name"));

    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("A");
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("69.000");
    expect(screen.getAllByLabelText("snapshot 1 attack frequency")[0].value).toBe("440.0");
  });

  it("allows typing or pasting a custom event Name after pitch edits", () => {
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

    const nameInput = screen.getByLabelText("snapshot 1 attack name");
    fireEvent.focus(nameInput);
    fireEvent.input(nameInput, { currentTarget: { value: "La 441" }, target: { value: "La 441" } });
    fireEvent.blur(nameInput, { currentTarget: { value: "La 441" }, target: { value: "La 441" } });

    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("La 441");
    expect(screen.getByLabelText("restore snapshot 1 attack captured pitch and name")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("restore snapshot 1 attack captured pitch and name"));

    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("A");
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("69.000");
  });

  it("can commit the edited pitch and name as the new snapshot baseline", () => {
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

    const nameInput = screen.getByLabelText("snapshot 1 attack name");
    fireEvent.focus(nameInput);
    fireEvent.input(nameInput, { currentTarget: { value: "La 441" }, target: { value: "La 441" } });
    fireEvent.blur(nameInput, { currentTarget: { value: "La 441" }, target: { value: "La 441" } });

    fireEvent.click(screen.getByLabelText("commit snapshot 1 attack current pitch and name"));

    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("La 441");
    expect(screen.getAllByLabelText("snapshot 1 attack midicents")[0].value).toBe("70.500");
    expect(screen.queryByLabelText("restore snapshot 1 attack captured pitch and name")).toBeNull();
    expect(screen.queryByLabelText("commit snapshot 1 attack current pitch and name")).toBeNull();
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

    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("A");

    fireEvent.blur(screen.getAllByLabelText("snapshot 1 attack frequency")[0], {
      currentTarget: { value: "440.000000" },
      target: { value: "440.000000" },
    });

    expect(screen.getByLabelText("snapshot 1 attack name").value).toBe("A");
  });
});
