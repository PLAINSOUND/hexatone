import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Keys from "./keys.js";
import Point from "./point.js";
import { WebMidi } from "webmidi";
import { rebuildControllerMap } from "../input/keys-midi-listeners.js";
import { parseExactInterval } from "../tuning/interval.js";

const edo12 = Array.from({ length: 12 }, (_, i) => i * 100);

function makeCanvas() {
  const context = {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    clip: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
  };

  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function makeSettings(overrides = {}) {
  return {
    hexSize: 40,
    rSteps: 1,
    drSteps: 1000,
    reference_degree: 0,
    center_degree: 0,
    scale: edo12,
    equivSteps: 12,
    equivInterval: 1200,
    octave_offset: 0,
    rotation: 0,
    fundamental: 440,
    fundamental_color: "ff0000",
    name: "Test",
    sysex_type: 127,
    device_id: 0,
    tuning_map_number: 0,
    output_mts: false,
    sysex_auto: false,
    midi_device: "OFF",
    midi_channel: -1,
    midiin_device: "OFF",
    midiin_modwheel_value: 0,
    midiin_modwheel_source: "",
    midiin_anchor_note: 60,
    midiin_anchor_channel: 1,
    midi_mapping: "MTS_BULK",
    midi_passthrough: false,
    ...overrides,
  };
}

function makeMidiEvent(note, channel = 1, velocity = 96, release = 64) {
  return {
    note: {
      number: note,
      rawAttack: velocity,
      rawRelease: release,
    },
    message: {
      channel,
      dataBytes: [0, 0],
    },
  };
}

function makePitchBendEvent(val14, channel = 1) {
  return {
    message: {
      channel,
      dataBytes: [val14 & 0x7f, (val14 >> 7) & 0x7f],
    },
  };
}

function createKeys(settingsOverrides = {}, inputRuntimeOverrides = {}, synth = {}, initialModulationLibrary = null) {
  const canvas = makeCanvas();
  const keys = new Keys(
    canvas,
    makeSettings(settingsOverrides),
    synth,
    null,
    null,
    null,
    null,
    {
      target: "hex_layout",
      layoutMode: "controller_geometry",
      mpeInput: false,
      seqAnchorNote: 60,
      seqAnchorChannel: 1,
      stepsPerChannel: 0,
      channelGroupSize: 1,
      legacyChannelMode: true,
      scaleTolerance: 50,
      scaleFallback: "discard",
      pitchBendMode: "recency",
      pressureMode: "recency",
      wheelToRecent: false,
      wheelRange: "64/63",
      perChannelExpression: false,
      scaleBendRange: 48,
      wheelUsesInterval: false,
      wheelScaleAware: false,
      wheelSemitones: 2,
      bendRange: "64/63",
      bendFlip: false,
      ...inputRuntimeOverrides,
    },
    null,
    null,
    null,
    initialModulationLibrary,
  );
  return keys;
}

describe("Keys MIDI input integration", () => {
  let drawGridSpy;

  beforeEach(() => {
    drawGridSpy = vi.spyOn(Keys.prototype, "drawGrid").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    drawGridSpy.mockRestore();
  });

  it("maps generic keyboard input through step arithmetic", () => {
    const keys = createKeys({}, { layoutMode: "sequential" });
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 100,
      noteOff: vi.fn(),
    }));
    const hexOff = vi.fn();
    keys.hexOn = hexOn;
    keys.hexOff = hexOff;

    keys.midinoteOn(makeMidiEvent(61));

    expect(hexOn).toHaveBeenCalledTimes(1);
    expect(hexOn.mock.calls[0][0]).toEqual(new Point(1, 0));

    keys.midinoteOff(makeMidiEvent(61));

    expect(hexOff).toHaveBeenCalledWith(new Point(1, 0));
  });

  it("keeps calling the gesture audio callback on repeated touches", () => {
    const onFirstInteraction = vi.fn();
    const keys = new Keys(
      makeCanvas(),
      makeSettings(),
      {},
      null,
      null,
      null,
      null,
      null,
      onFirstInteraction,
      null,
      null,
    );

    keys.handleTouch({
      preventDefault: vi.fn(),
      targetTouches: [],
    });
    keys.handleTouch({
      preventDefault: vi.fn(),
      targetTouches: [],
    });

    expect(onFirstInteraction).toHaveBeenCalledTimes(2);
  });

  it("releases an existing MIDI voice before replacing it on same-note retrigger", () => {
    const keys = createKeys({}, { layoutMode: "sequential" });
    const firstHex = {
      coords: new Point(1, 0),
      cents: 100,
      _baseCents: 100,
      release: false,
      noteOff: vi.fn(function () {
        this.release = true;
      }),
      retune: vi.fn(),
    };
    const secondHex = {
      coords: new Point(1, 0),
      cents: 100,
      _baseCents: 100,
      release: false,
      noteOff: vi.fn(),
      retune: vi.fn(),
    };
    const hexOn = vi
      .fn()
      .mockReturnValueOnce(firstHex)
      .mockReturnValueOnce(secondHex);
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();

    keys.midinoteOn(makeMidiEvent(61));
    keys.midinoteOn(makeMidiEvent(61));

    expect(firstHex.noteOff).toHaveBeenCalledWith(0);
    expect(keys.state.activeMidi.get(61)).toBe(secondHex);
  });

  it("toggles modulation armed state via the Backquote key and reports it", () => {
    const onModulationArmChange = vi.fn();
    const keys = new Keys(
      makeCanvas(),
      makeSettings(),
      {},
      true,
      null,
      onModulationArmChange,
      null,
      {
        target: "hex_layout",
        layoutMode: "controller_geometry",
        mpeInput: false,
        seqAnchorNote: 60,
        seqAnchorChannel: 1,
        stepsPerChannel: 0,
        channelGroupSize: 1,
        legacyChannelMode: true,
        scaleTolerance: 50,
        scaleFallback: "discard",
        pitchBendMode: "recency",
        pressureMode: "recency",
        wheelToRecent: false,
        wheelRange: "64/63",
        wheelScaleAware: false,
        wheelSemitones: 2,
        bendRange: "64/63",
        bendFlip: false,
      },
      null,
      null,
    );

    keys.recencyStack.push({
      coords: new Point(2, 0),
      pressed_interval: 2,
    });
    const preventDefault = vi.fn();
    keys.onKeyDown({ code: "Backquote", repeat: false, preventDefault, metaKey: false, ctrlKey: false, altKey: false });
    keys.onKeyDown({ code: "Backquote", repeat: false, preventDefault, metaKey: false, ctrlKey: false, altKey: false });

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(onModulationArmChange).toHaveBeenNthCalledWith(1, true);
    expect(onModulationArmChange).toHaveBeenNthCalledWith(2, false);
  });

  it("handles Backquote globally even when normal typing input is inactive", () => {
    const onModulationArmChange = vi.fn();
    const keys = new Keys(
      makeCanvas(),
      makeSettings(),
      {},
      false,
      null,
      onModulationArmChange,
      null,
      {
        target: "hex_layout",
        layoutMode: "controller_geometry",
        mpeInput: false,
        seqAnchorNote: 60,
        seqAnchorChannel: 1,
        stepsPerChannel: 0,
        channelGroupSize: 1,
        legacyChannelMode: true,
        scaleTolerance: 50,
        scaleFallback: "discard",
        pitchBendMode: "recency",
        pressureMode: "recency",
        wheelToRecent: false,
        wheelRange: "64/63",
        wheelScaleAware: false,
        wheelSemitones: 2,
        bendRange: "64/63",
        bendFlip: false,
      },
      null,
      null,
    );

    keys.recencyStack.push({
      coords: new Point(2, 0),
      pressed_interval: 2,
    });

    const preventDefault = vi.fn();
    keys.onKeyDown({
      code: "Backquote",
      repeat: false,
      preventDefault,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onModulationArmChange).toHaveBeenCalledWith(true);
  });

  it("also handles IntlBackslash globally for ISO layouts", () => {
    const onModulationArmChange = vi.fn();
    const keys = new Keys(
      makeCanvas(),
      makeSettings(),
      {},
      false,
      null,
      onModulationArmChange,
      null,
      {
        target: "hex_layout",
        layoutMode: "controller_geometry",
        mpeInput: false,
        seqAnchorNote: 60,
        seqAnchorChannel: 1,
        stepsPerChannel: 0,
        channelGroupSize: 1,
        legacyChannelMode: true,
        scaleTolerance: 50,
        scaleFallback: "discard",
        pitchBendMode: "recency",
        pressureMode: "recency",
        wheelToRecent: false,
        wheelRange: "64/63",
        wheelScaleAware: false,
        wheelSemitones: 2,
        bendRange: "64/63",
        bendFlip: false,
      },
      null,
      null,
    );

    keys.recencyStack.push({
      coords: new Point(2, 0),
      pressed_interval: 2,
    });

    const preventDefault = vi.fn();
    keys.onKeyDown({
      code: "IntlBackslash",
      repeat: false,
      preventDefault,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onModulationArmChange).toHaveBeenCalledWith(true);
  });

  it("can toggle modulation armed state directly without affecting sustain latch", () => {
    const onLatchChange = vi.fn();
    const onModulationArmChange = vi.fn();
    const keys = new Keys(
      makeCanvas(),
      makeSettings(),
      {},
      true,
      onLatchChange,
      onModulationArmChange,
      null,
      {
        target: "hex_layout",
        layoutMode: "controller_geometry",
        mpeInput: false,
        seqAnchorNote: 60,
        seqAnchorChannel: 1,
        stepsPerChannel: 0,
        channelGroupSize: 1,
        legacyChannelMode: true,
        scaleTolerance: 50,
        scaleFallback: "discard",
        pitchBendMode: "recency",
        pressureMode: "recency",
        wheelToRecent: false,
        wheelRange: "64/63",
        wheelScaleAware: false,
        wheelSemitones: 2,
        bendRange: "64/63",
        bendFlip: false,
      },
      null,
      null,
    );

    keys.recencyStack.push({
      coords: new Point(2, 0),
      pressed_interval: 2,
    });
    keys.toggleModulationArm();

    expect(onModulationArmChange).toHaveBeenCalledWith(true);
    expect(onLatchChange).not.toHaveBeenCalled();
  });

  it("arms modulation from degree zero when no notes have been played yet", () => {
    const onModulationArmChange = vi.fn();
    const keys = new Keys(
      makeCanvas(),
      makeSettings(),
      {},
      true,
      null,
      onModulationArmChange,
      null,
      {
        target: "hex_layout",
        layoutMode: "controller_geometry",
        mpeInput: false,
        seqAnchorNote: 60,
        seqAnchorChannel: 1,
        stepsPerChannel: 0,
        channelGroupSize: 1,
        legacyChannelMode: true,
        scaleTolerance: 50,
        scaleFallback: "discard",
        pitchBendMode: "recency",
        pressureMode: "recency",
        wheelToRecent: false,
        wheelRange: "64/63",
        wheelScaleAware: false,
        wheelSemitones: 2,
        bendRange: "64/63",
        bendFlip: false,
      },
      null,
      null,
    );

    expect(keys.armModulation()).toBe(true);
    expect(keys.getModulationState().mode).toBe("awaiting_target");
    expect(keys.getModulationState().sourceDegree).toBeNull();
    expect(onModulationArmChange).toHaveBeenCalledWith(true);
  });

  it("does not reuse the last played degree as the modulation source when no notes are sounding", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys({}, {}, synth);
    const sourceCoords = new Point(7, 0);

    const sourceHex = keys.hexOn(sourceCoords);
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    keys.noteOff(sourceHex, 0);
    keys.state.activeKeyboard.delete("KeyA");

    expect(keys.armModulation()).toBe(true);
    expect(keys.getModulationState().sourceHex).toBeNull();
    expect(keys.getModulationState().sourceDegree).toBeNull();
  });

  it("waits for a first note to define the source and requires overlap before moveable-do commits", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys({}, {}, synth);

    expect(keys.armModulation()).toBe(true);
    expect(keys.getModulationState().sourceDegree).toBeNull();

    const sourceHex = keys.hexOn(new Point(0, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);

    expect(keys.getModulationState().mode).toBe("awaiting_target");
    expect(keys.getModulationState().sourceDegree).toBe(0);
    expect(keys.getModulationState().history).toEqual([]);

    keys.noteOff(sourceHex, 0);
    keys.state.activeKeyboard.delete("KeyA");

    expect(keys.getModulationState().mode).toBe("awaiting_target");
    expect(keys.getModulationState().sourceDegree).toBeNull();

    const newSourceHex = keys.hexOn(new Point(2, 0));
    keys.state.activeKeyboard.set("KeyS", newSourceHex);
    expect(keys.getModulationState().sourceDegree).toBe(2);

    const targetHex = keys.hexOn(new Point(3, 0));
    keys.state.activeKeyboard.set("KeyD", targetHex);

    expect(keys.getModulationState().mode).toBe("pending_settlement");
    expect(keys.getModulationState().currentRoute).toMatchObject({
      sourceDegree: 2,
      targetDegree: 3,
    });
  });

  it("commits a source-to-target modulation without rebuilding Keys and keeps labels stable in moveable-surface mode", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {},
      synth,
    );

    const sourceCoords = new Point(2, 0);
    const targetCoords = new Point(5, 0);
    const nextCoords = new Point(6, 0);

    const sourceHex = keys.hexOn(sourceCoords);
    keys.state.activeKeyboard.set("KeyA", sourceHex);

    expect(keys.armModulation()).toBe(true);
    expect(keys.getModulationState().mode).toBe("awaiting_target");

    const targetHex = keys.hexOn(targetCoords);
    keys.state.activeKeyboard.set("KeyB", targetHex);

    expect(keys.getModulationState().mode).toBe("pending_settlement");
    expect(targetHex.cents).toBeCloseTo(200, 5);
    expect(keys.getEffectiveFundamental()).toBeCloseTo(440 * Math.pow(2, -300 / 1200), 5);
    expect(keys.getDisplayLabelAtCoords(targetCoords)).toBe("n5");

    const nextHex = keys.hexOn(nextCoords);
    expect(nextHex.cents).toBeCloseTo(300, 5);
    expect(keys.getDisplayLabelAtCoords(nextCoords)).toBe("n6");
  });

  it("keeps already-sounding notes at their onset pitch during pending-settlement modulation", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        keyCodeToCoords: {},
      },
      {},
      synth,
    );

    const sourceCoords = new Point(2, 0);
    const targetCoords = new Point(5, 0);

    const sourceHex = keys.hexOn(sourceCoords);
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    const sourceCentsBefore = sourceHex.cents;

    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(targetCoords);
    keys.state.activeKeyboard.set("KeyB", targetHex);

    expect(keys.getModulationState().mode).toBe("pending_settlement");
    expect(sourceHex.cents).toBeCloseTo(sourceCentsBefore, 5);
  });

  it("retunes sustained legacy notes in place when the fundamental changes during pending-settlement modulation", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        fundamental: 440,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        keyCodeToCoords: {},
      },
      {},
      synth,
    );

    const sourceHex = keys.hexOn(new Point(0, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    keys.sustainOn();
    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(new Point(7, 0));
    keys.state.activeKeyboard.set("KeyB", targetHex);
    expect(keys.getModulationState().mode).toBe("pending_settlement");

    keys.state.activeKeyboard.delete("KeyA");
    keys.state.sustainedNotes.push([sourceHex, 0]);
    keys.state.sustainedCoords.add("0,0");

    expect(keys.state.sustainedNotes).toHaveLength(1);
    expect(sourceHex._onsetFrameId).toBe(keys.getModulationState().oldFrame?.id);
    expect(sourceHex._noteContext?.frameId).toBe(keys.getModulationState().oldFrame?.id);
    const futurePitchBefore = keys.hexCoordsToLiveCents(new Point(0, 0))[0];

    keys.previewFundamental(50);
    expect(keys._liveCentsForHex(sourceHex)[0]).toBeCloseTo(50, 5);
    expect(keys.hexCoordsToLiveCents(new Point(0, 0))[0]).toBeCloseTo(futurePitchBefore + 50, 5);

    const newFundamental = 440 * Math.pow(2, 50 / 1200);
    keys.updateFundamental(newFundamental);

    expect(sourceHex.cents).toBeCloseTo(0, 5);
    expect(keys.hexCoordsToLiveCents(new Point(0, 0))[0]).toBeCloseTo(futurePitchBefore, 5);
    expect(sourceHex.fundamental).toBeCloseTo(newFundamental, 8);
  });

  it("keeps old sustained notes in the old frame while a new pending-frame note retunes separately", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        fundamental: 440,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        keyCodeToCoords: {},
      },
      {},
      synth,
    );

    const oldA = keys.hexOn(new Point(0, 0));
    const oldB = keys.hexOn(new Point(4, 0));
    keys.state.activeKeyboard.set("KeyA", oldA);
    keys.state.activeKeyboard.set("KeyB", oldB);
    keys.sustainOn();

    expect(keys.armModulation()).toBe(true);
    const targetHex = keys.hexOn(new Point(7, 0));
    keys.state.activeKeyboard.set("KeyC", targetHex);
    expect(keys.getModulationState().mode).toBe("pending_settlement");

    keys.state.activeKeyboard.delete("KeyA");
    keys.state.activeKeyboard.delete("KeyB");
    keys.state.sustainedNotes.push([oldA, 0], [oldB, 0]);
    keys.state.sustainedCoords.add("0,0");
    keys.state.sustainedCoords.add("4,0");

    const newHex = keys.hexOn(new Point(1, 0));
    keys.state.activeKeyboard.set("KeyD", newHex);

    expect(oldA._onsetFrameId).toBe(keys.getModulationState().oldFrame?.id);
    expect(oldB._onsetFrameId).toBe(keys.getModulationState().oldFrame?.id);
    expect(newHex._onsetFrameId).toBe(keys.getModulationState().pendingFrame?.id);
    expect(newHex._noteContext?.frameId).toBe(keys.getModulationState().pendingFrame?.id);
    expect(newHex._noteContext?.transpositionCents).toBe(keys.getModulationState().pendingFrame?.transpositionCents);

    keys.previewFundamental(50);

    expect(keys._liveCentsForHex(oldA)[0]).toBeCloseTo(50, 5);
    expect(keys._liveCentsForHex(oldB)[0]).toBeCloseTo(450, 5);
    const newHexPreview = keys._liveCentsForHex(newHex)[0];

    const newFundamental = 440 * Math.pow(2, 50 / 1200);
    keys.updateFundamental(newFundamental);

    expect(oldA.cents).toBeCloseTo(0, 5);
    expect(oldB.cents).toBeCloseTo(400, 5);
    expect(newHex.cents).toBeCloseTo(newHexPreview - 50, 5);
  });

  it("stores cumulative rational modulation identity in new note contexts when available", () => {
    const keys = createKeys();
    const exactInterval = parseExactInterval("15/8");
    keys._modulationState.history = [
      { sourceDegree: 0, targetDegree: 1, count: 1, transpositionRatioText: "3/2" },
      { sourceDegree: 1, targetDegree: 2, count: 1, transpositionRatioText: "5/4" },
    ];

    const noteContext = keys._createNoteContext({
      id: "frame:rational",
      transpositionCents: exactInterval.cents,
      effectiveFundamental: 440 * Math.pow(2, exactInterval.cents / 1200),
    });

    expect(noteContext?.ratioText).toBe("15/8");
    expect(noteContext?.monzo).toEqual([-3, 1, 1]);
  });

  it("redraws sustained notes from their stored onset frame during pending settlement", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
      },
      {},
      synth,
    );
    const drawHexSpy = vi.spyOn(keys, "drawHex");

    const sourceHex = keys.hexOn(new Point(0, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    keys.sustainOn();
    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(new Point(7, 0));
    keys.state.activeKeyboard.set("KeyB", targetHex);
    expect(keys.getModulationState().mode).toBe("pending_settlement");

    keys.noteOff(sourceHex, 0);

    const lastCall = drawHexSpy.mock.calls.at(-1);
    expect(lastCall?.[4]?.frame?.id).toBe(keys.getModulationState().oldFrame?.id);
    expect(lastCall?.[4]?.geometryMode).toBe(sourceHex._noteContext?.geometryMode);
  });

  it("redraws the non-sounding canvas immediately when modulation history changes under a held note", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys({}, {}, synth, [
      {
        sourceDegree: 0,
        targetDegree: 7,
        strategy: "retune_surface_to_source",
        count: 0,
        transpositionDeltaCents: -700,
      },
    ]);
    const redrawSpy = vi.spyOn(keys, "scheduleImmediateGridRedraw");

    const sourceHex = keys.hexOn(new Point(0, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    expect(keys.getModulationState().mode).toBe("idle");

    redrawSpy.mockClear();
    expect(keys.setModulationRouteCount(0, 2)).toBe(true);
    expect(redrawSpy).toHaveBeenCalledTimes(1);
  });

  it("requires overlap and suppresses the target note for fixed-do sequential modulation", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      synth,
    );

    keys.midinoteOn(makeMidiEvent(60));
    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(62));

    expect(keys.getModulationState().mode).toBe("pending_settlement");
    expect(keys.getModulationState().lastDecision?.articulation).toBe("reanchor_hold_source");
    expect(keys.state.activeMidi.get(62)).toBeUndefined();
    expect(keys._suppressedMidiNotes.has(62)).toBe(true);
    expect(keys.settings.midiin_anchor_note).toBe(60);
    expect(keys.getModulationState().pendingFrame.geometryShiftRSteps).toBe(2);
    expect(keys.getModulationState().pendingFrame.geometryShiftDrSteps).toBe(0);
    expect(keys.state.activeMidi.get(60)?.cents).toBeCloseTo(0, 5);

    const shifted61 = keys.coordResolver.coordForSteps(
      keys.coordResolver.noteToSteps(63, 1),
    );
    keys.midinoteOn(makeMidiEvent(61));
    expect(keys.state.activeMidi.get(61)?.coords).toEqual(shifted61);

    keys.midinoteOff(makeMidiEvent(62));
    expect(keys._suppressedMidiNotes.has(62)).toBe(false);
    expect(keys.state.activeMidi.get(60)).toBeTruthy();
  });

  it("keeps fixed-do armed and redefines the source when no overlap is present", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      synth,
    );

    const sourceHex = keys.hexOn(new Point(0, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    keys.noteOff(sourceHex, 0);
    keys.state.activeKeyboard.delete("KeyA");

    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(62));

    expect(keys.getModulationState().mode).toBe("awaiting_target");
    expect(keys.getModulationState().sourceDegree).toBe(2);
    expect(keys.state.activeMidi.get(62)).toBeTruthy();
    expect(keys.settings.midiin_anchor_note).toBe(60);
  });

  it("replays fixed-do geometry shifts when stepping modulation history and resetting counts", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      synth,
    );

    keys.midinoteOn(makeMidiEvent(60));
    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(62));
    keys.noteOff(keys.state.activeMidi.get(60), 0);
    keys.state.activeMidi.delete(60);
    keys._maybeSettleModulation();

    expect(keys.getModulationState().mode).toBe("idle");
    expect(keys.settings.midiin_anchor_note).toBe(60);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(2);

    expect(keys.stepModulationHistory(-1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(0);

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(2);

    expect(keys.resetModulationRouteCounts()).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(0);
  });

  it("replays the same saved modulation route as moveable or fixed depending on current style", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        modulation_style: "moveable_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      synth,
      [
        {
          sourceDegree: 0,
          targetDegree: 2,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: -200,
          deltaRSteps: 2,
          deltaDrSteps: 0,
        },
      ],
    );

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(0);

    expect(keys.stepModulationHistory(-1)).toBe(true);
    keys.updateInputRuntime(keys.inputRuntime, { modulation_style: "fixed_do" });
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(0);

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(2);

    keys.updateInputRuntime(keys.inputRuntime, { modulation_style: "moveable_do" });
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(0);
  });

  it("captures the surface delta for reusable fixed-do history replay", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      synth,
    );

    keys.midinoteOn(makeMidiEvent(60));
    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(62));

    expect(keys.getModulationState().history.at(-1)).toMatchObject({
      sourceDegree: 0,
      targetDegree: 2,
      deltaRSteps: 2,
      deltaDrSteps: 0,
    });
  });

  it("stores the exact geometry shift for large fixed-do sequential intervals", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(function () {
            this.release = true;
          }),
          retune(newCents) {
            this.cents = newCents;
          },
        })),
      },
    );

    keys.midinoteOn(makeMidiEvent(60));
    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(79));

    expect(keys.settings.midiin_anchor_note).toBe(60);
    expect(keys.state.activeMidi.get(60)?.cents).toBeCloseTo(0, 5);
    const shifted61 = keys.coordResolver.coordForSteps(
      keys.coordResolver.noteToSteps(80, 1),
    );
    keys.midinoteOn(makeMidiEvent(61));
    expect(keys.state.activeMidi.get(61)?.coords).toEqual(shifted61);
    expect(keys.getModulationState().history.at(-1)).toMatchObject({
      sourceDegree: 0,
      targetDegree: 7,
      deltaRSteps: 19,
      deltaDrSteps: 0,
      transpositionDeltaCents: -1900,
    });
  });

  it("keeps the source sequential controller key on the same frequency after fixed-do modulation", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(function () {
            this.release = true;
          }),
          retune(newCents) {
            this.cents = newCents;
          },
        })),
      },
    );

    const sourceCoords = keys.coordResolver.coordForSteps(
      keys.coordResolver.noteToSteps(60, 1),
    );
    const targetCoords = keys.coordResolver.coordForSteps(
      keys.coordResolver.noteToSteps(62, 1),
    );
    keys.midinoteOn(makeMidiEvent(60));
    expect(keys.state.activeMidi.get(60)?.coords).toEqual(sourceCoords);
    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(62));

    keys.midinoteOff(makeMidiEvent(60));
    keys.midinoteOff(makeMidiEvent(62));
    keys.midinoteOn(makeMidiEvent(60));

    expect(keys.state.activeMidi.get(60)?.coords).toEqual(targetCoords);
  });

  it("replays fixed-do history from the stored geometry delta", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
        rSteps: 1,
        drSteps: 2,
      },
      {
        layoutMode: "sequential",
      },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 2,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: -200,
          deltaRSteps: 1,
          deltaDrSteps: 1,
        },
      ],
    );

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(1);
    expect(keys.getModulationState().currentFrame.geometryShiftDrSteps).toBe(1);
  });

  it("replays routes without stored geometry delta as moveable-do even in fixed-do mode", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 7,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: 500,
        },
      ],
    );

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(0);
    expect(keys.getModulationState().currentFrame.transpositionCents).toBe(500);
  });

  it("accumulates the stored geometry shift on each additional fixed-do replay step", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 7,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: 500,
          deltaRSteps: 5,
          deltaDrSteps: 0,
        },
      ],
    );

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(5);

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(10);

    expect(keys.stepModulationHistory(-2)).toBe(true);
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(0);
  });

  it("keeps the controller map static while fixed-do history shifts the interpreted lattice on LinnStrument", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "linnstrument",
        midiin_device: "test-input",
        midiin_anchor_note: 2,
        midiin_anchor_note: 2,
        midiin_anchor_channel: 4,
      },
      { layoutMode: "controller_geometry" },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 7,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: 500,
          deltaRSteps: 1,
          deltaDrSteps: 0,
        },
      ],
    );
    keys.midiin_data = {
      name: "LinnStrument 128",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    rebuildControllerMap.call(keys);

    expect(keys.controller?.id).toBe("linnstrument");
    expect(keys.controllerMap.get("4.1")).toEqual(new Point(-1, 0));

    expect(keys.stepModulationRoute(0, 1)).toBe(true);
    expect(keys.settings.midiin_anchor_note).toBe(2);
    expect(keys.controllerMap.get("4.1")).toEqual(new Point(-1, 0));
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(1);
    expect(keys.settings.runtime_display_offset_x).toBe(1);

    expect(keys.stepModulationRoute(0, 1)).toBe(true);
    expect(keys.settings.midiin_anchor_note).toBe(2);
    expect(keys.controllerMap.get("4.1")).toEqual(new Point(-1, 0));
    expect(keys.getModulationState().currentFrame.geometryShiftRSteps).toBe(2);
    expect(keys.settings.runtime_display_offset_x).toBe(2);
  });

  it("keeps the controller map static while fixed-do history shifts the interpreted lattice on Lumatone", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "lumatone",
        midiin_device: "test-input",
        midiin_anchor_note: 0,
        midiin_anchor_note: 0,
        midiin_anchor_channel: 3,
      },
      { layoutMode: "controller_geometry" },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 7,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: 500,
          deltaRSteps: 0,
          deltaDrSteps: 1,
        },
      ],
    );
    keys.midiin_data = {
      name: "Lumatone MIDI Function",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    rebuildControllerMap.call(keys);

    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.controllerMap.get("3.0")).toEqual(new Point(0, 0));

    expect(keys.stepModulationRoute(0, 1)).toBe(true);
    expect(keys.settings.midiin_anchor_note).toBe(0);
    expect(keys.controllerMap.get("3.0")).toEqual(new Point(0, 0));
    expect(keys.getModulationState().currentFrame.geometryShiftDrSteps).toBe(1);
    expect(keys.settings.runtime_display_offset_y).toBe(1);

    expect(keys.stepModulationRoute(0, 1)).toBe(true);
    expect(keys.settings.midiin_anchor_note).toBe(0);
    expect(keys.controllerMap.get("3.0")).toEqual(new Point(0, 0));
    expect(keys.getModulationState().currentFrame.geometryShiftDrSteps).toBe(2);
    expect(keys.settings.runtime_display_offset_y).toBe(2);

    expect(keys.stepModulationRoute(0, 4)).toBe(true);
    expect(keys.settings.midiin_anchor_note).toBe(0);
    expect(keys.controllerMap.get("3.0")).toEqual(new Point(0, 0));
    expect(keys.getModulationState().currentFrame.geometryShiftDrSteps).toBe(6);
  });

  it("keeps the source Lumatone controller key on the same frequency after fixed-do modulation", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "lumatone",
        midiin_device: "test-input",
      },
      { layoutMode: "controller_geometry" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(function () {
            this.release = true;
          }),
          retune(newCents) {
            this.cents = newCents;
          },
        })),
      },
    );
    keys.midiin_data = {
      name: "Lumatone MIDI Function",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    rebuildControllerMap.call(keys);

    const sourceCoords = keys.controllerMap.get("3.26");
    const targetCoords = keys.controllerMap.get("3.27");
    keys.midinoteOn(makeMidiEvent(26, 3));
    expect(keys.state.activeMidi.get(26 + 128 * (3 - 1))?.coords).toEqual(sourceCoords);
    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(27, 3));

    keys.midinoteOff(makeMidiEvent(26, 3));
    keys.midinoteOff(makeMidiEvent(27, 3));
    keys.midinoteOn(makeMidiEvent(26, 3));

    expect(keys.state.activeMidi.get(26 + 128 * (3 - 1))?.coords).toEqual(targetCoords);
  });

  it("auto-syncs Lumatone controller colors when fixed-do history changes", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "lumatone",
        midiin_device: "test-input",
        lumatone_led_sync: true,
      },
      { layoutMode: "controller_geometry" },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 7,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: 500,
          deltaRSteps: 0,
          deltaDrSteps: 1,
        },
      ],
    );
    keys.midiin_data = {
      name: "Lumatone MIDI Function",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    rebuildControllerMap.call(keys);
    keys.autoSyncLumatoneLEDs = vi.fn();

    expect(keys.stepModulationRoute(0, 1)).toBe(true);
    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("auto-syncs Lumatone controller colors when a live fixed-do modulation is committed", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "lumatone",
        midiin_device: "test-input",
        lumatone_led_sync: true,
      },
      { layoutMode: "controller_geometry" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(function () {
            this.release = true;
          }),
          retune(newCents) {
            this.cents = newCents;
          },
        })),
      },
    );
    keys.midiin_data = {
      name: "Lumatone MIDI Function",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    rebuildControllerMap.call(keys);
    keys.autoSyncLumatoneLEDs = vi.fn();

    keys.midinoteOn(makeMidiEvent(38, 3));
    expect(keys.armModulation()).toBe(true);
    keys.midinoteOn(makeMidiEvent(39, 3));

    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });
 
  it("redraws normally when fixed-do history replay changes geometry with sounding notes held", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
        midiin_controller_override: "generic",
      },
      {
        layoutMode: "sequential",
      },
      synth,
      [
        {
          sourceDegree: 0,
          targetDegree: 2,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: -200,
        },
      ],
    );
    const redraw = vi.spyOn(keys, "scheduleImmediateGridRedraw");

    keys.midinoteOn(makeMidiEvent(60));
    expect(keys.state.activeMidi.get(60)).toBeTruthy();

    expect(keys.stepModulationHistory(1)).toBe(true);

    expect(redraw).toHaveBeenCalled();
  });

  it("settles a takeover modulation when the source key is released so stored-route arrows remain usable", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function () {
          this.release = true;
        }),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = new Keys(
      makeCanvas(),
      makeSettings({
        keyCodeToCoords: {
          KeyA: { x: 2, y: 0 },
          KeyB: { x: 5, y: 0 },
        },
      }),
      synth,
      true,
      null,
      null,
      null,
      {
        target: "hex_layout",
        layoutMode: "controller_geometry",
        mpeInput: false,
        seqAnchorNote: 60,
        seqAnchorChannel: 1,
        stepsPerChannel: 0,
        channelGroupSize: 1,
        legacyChannelMode: true,
        scaleTolerance: 50,
        scaleFallback: "discard",
        pitchBendMode: "recency",
        pressureMode: "recency",
        wheelToRecent: false,
        wheelRange: "64/63",
        wheelScaleAware: false,
        wheelSemitones: 2,
        bendRange: "64/63",
        bendFlip: false,
      },
      null,
      null,
    );

    const sourceHex = keys.hexOn(new Point(2, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    keys.state.pressedKeys.add("KeyA");
    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(new Point(5, 0));
    keys.state.activeKeyboard.set("KeyB", targetHex);
    keys.state.pressedKeys.add("KeyB");
    expect(keys.getModulationState().mode).toBe("pending_settlement");

    keys.onKeyUp({ code: "KeyA" });

    expect(keys.getModulationState().mode).toBe("idle");
    expect(keys.stepModulationRoute(0, -1)).toBe(true);
    expect(keys.getModulationState().history[0].count).toBe(0);
  });

  it("can step modulation history back home and forward again without rebuilding Keys", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {},
      synth,
    );

    const sourceCoords = new Point(2, 0);
    const targetCoords = new Point(5, 0);

    const sourceHex = keys.hexOn(sourceCoords);
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(targetCoords);
    keys.state.activeKeyboard.set("KeyB", targetHex);
    sourceHex.noteOff(0);
    targetHex.noteOff(0);
    keys.state.activeKeyboard.clear();
    keys._maybeSettleModulation();

    expect(keys.getModulationState().mode).toBe("idle");
    expect(keys.getModulationState().historyIndex).toBe(1);
    expect(keys.getEffectiveFundamental()).toBeCloseTo(440 * Math.pow(2, -300 / 1200), 5);

    expect(keys.stepModulationHistory(-1)).toBe(true);
    expect(keys.getModulationState().historyIndex).toBe(0);
    expect(keys.getEffectiveFundamental()).toBeCloseTo(440, 5);

    expect(keys.stepModulationHistory(1)).toBe(true);
    expect(keys.getModulationState().historyIndex).toBe(1);
    expect(keys.getEffectiveFundamental()).toBeCloseTo(440 * Math.pow(2, -300 / 1200), 5);

    expect(keys.clearModulationHistory()).toBe(false);
    expect(keys.stepModulationHistory(-1)).toBe(true);
    expect(keys.clearModulationHistory()).toBe(true);
    expect(keys.getModulationState().history).toEqual([]);
    expect(keys.getModulationState().historyIndex).toBe(0);
    expect(keys.getEffectiveFundamental()).toBeCloseTo(440, 5);
  });

  it("can reset all modulation route counts to zero while preserving the history rows", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys({}, {}, synth, [
      { sourceDegree: 2, targetDegree: 5, strategy: "retune_surface_to_source", count: 1 },
      { sourceDegree: 5, targetDegree: 9, strategy: "retune_surface_to_source", count: -1 },
    ]);

    expect(keys.getModulationState().history.map((entry) => entry.count)).toEqual([1, -1]);
    expect(keys.resetModulationRouteCounts()).toBe(true);
    expect(keys.getModulationState().history.map((entry) => entry.count)).toEqual([0, 0]);
    expect(keys.getModulationState().historyIndex).toBe(0);
    expect(keys.getEffectiveFundamental()).toBeCloseTo(440, 5);
  });

  it("keeps scale-cents labels pinned to the committed degree-0 frame under modulation", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        key_labels: "cents",
        cents: true,
        no_labels: false,
        keyCodeToCoords: {},
      },
      {},
      synth,
    );

    const sourceCoords = new Point(2, 0);
    const targetCoords = new Point(5, 0);

    const sourceHex = keys.hexOn(sourceCoords);
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(targetCoords);
    keys.state.activeKeyboard.set("KeyB", targetHex);
    sourceHex.noteOff(0);
    targetHex.noteOff(0);
    keys.state.activeKeyboard.clear();
    keys._maybeSettleModulation();

    expect(keys.getModulationState().mode).toBe("idle");
    expect(keys.getDisplayLabelAtCoords(new Point(0, 0))).toBe("0.");
    expect(keys.getDisplayLabelAtCoords(new Point(5, 0))).toBe("500.");
  });

  it("hydrates a saved modulation library with zero-count routes that can be stepped immediately", () => {
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {},
      {},
      [
        {
          sourceDegree: 2,
          targetDegree: 5,
          strategy: "retune_surface_to_source",
          count: 0,
        },
      ],
    );

    expect(keys.getModulationState().history).toEqual([
      {
        sourceDegree: 2,
        targetDegree: 5,
        strategy: "retune_surface_to_source",
        count: 0,
      },
    ]);
    expect(keys.getModulationState().mode).toBe("idle");
    expect(keys.stepModulationRoute(0, 1)).toBe(true);
    expect(keys.getModulationState().history[0].count).toBe(1);
  });

  it("keeps already-sounding notes stable when modulation palette route counts change", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        keyCodeToCoords: {},
      },
      {},
      synth,
      [
        {
          sourceDegree: 0,
          targetDegree: 7,
          strategy: "retune_surface_to_source",
          count: 0,
          transpositionDeltaCents: 700,
        },
      ],
    );

    const hex = keys.hexOn(new Point(0, 0));
    keys.state.activeKeyboard.set("KeyA", hex);
    const before = hex.cents;

    expect(keys.stepModulationRoute(0, 1)).toBe(true);

    expect(hex.cents).toBe(before);

    const nextHex = keys.hexOn(new Point(1, 0));
    expect(nextHex.cents).not.toBe(100);
  });

  it("keeps active modulation applied when the fundamental is previewed and committed", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        fundamental: 440,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        keyCodeToCoords: {},
      },
      {},
      synth,
      [
        {
          sourceDegree: 0,
          targetDegree: 7,
          strategy: "retune_surface_to_source",
          count: 1,
          transpositionDeltaCents: 700,
        },
      ],
    );

    const hex = keys.hexOn(new Point(0, 0));
    keys.state.activeKeyboard.set("KeyA", hex);
    const modulatedCents = hex.cents;

    keys.previewFundamental(50);
    expect(keys.hexCoordsToLiveCents(new Point(0, 0))[0]).toBeCloseTo(modulatedCents + 50, 5);

    const newFundamental = 440 * Math.pow(2, 50 / 1200);
    keys.updateFundamental(newFundamental);

    expect(hex.cents).toBeCloseTo(modulatedCents, 5);
    expect(hex.fundamental).toBeCloseTo(newFundamental, 8);
    expect(keys.getEffectiveFundamental()).toBeCloseTo(
      newFundamental * Math.pow(2, 700 / 1200),
      8,
    );
  });

  it("measures scale-cents labels from degree 0 instead of reference_degree", () => {
    const keys = createKeys({
      key_labels: "cents",
      cents: true,
      no_labels: false,
      reference_degree: 9,
      keyCodeToCoords: {},
    });

    expect(keys.getDisplayLabelAtCoords(new Point(0, 0))).toBe("0.");
    expect(keys.getDisplayLabelAtCoords(new Point(5, 0))).toBe("500.");
    expect(keys.getDisplayLabelAtCoords(new Point(9, 0))).toBe("900.");
  });

  it("returns to the starting surface when an inverse modulation pair is applied", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {},
      synth,
    );

    const firstSource = keys.hexOn(new Point(4, 0));
    keys.state.activeKeyboard.set("KeyA", firstSource);
    expect(keys.armModulation()).toBe(true);
    const firstTarget = keys.hexOn(new Point(7, 0));
    keys.state.activeKeyboard.set("KeyB", firstTarget);
    firstSource.noteOff(0);
    firstTarget.noteOff(0);
    keys.state.activeKeyboard.clear();
    keys._maybeSettleModulation();

    const afterFirst = keys.getEffectiveFundamental();
    expect(afterFirst).not.toBeCloseTo(440, 5);

    const secondSource = keys.hexOn(new Point(7, 0));
    keys.state.activeKeyboard.set("KeyC", secondSource);
    expect(keys.armModulation()).toBe(true);
    const secondTarget = keys.hexOn(new Point(4, 0));
    keys.state.activeKeyboard.set("KeyD", secondTarget);
    secondSource.noteOff(0);
    secondTarget.noteOff(0);
    keys.state.activeKeyboard.clear();
    keys._maybeSettleModulation();

    expect(keys.getEffectiveFundamental()).toBeCloseTo(440, 5);
    expect(keys.hexCoordsToCents(new Point(0, 0))[0]).toBeCloseTo(0, 5);
    expect(keys.hexCoordsToCents(new Point(4, 0))[0]).toBeCloseTo(400, 5);
    expect(keys.hexCoordsToCents(new Point(7, 0))[0]).toBeCloseTo(700, 5);
  });

  it("takes over the sustaining source voice at the target without rearticulating", () => {
    const sourceNoteOn = vi.fn();
    const sourceNoteOff = vi.fn();
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: sourceNoteOn,
        noteOff: sourceNoteOff,
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {},
      synth,
    );

    const sourceHex = keys.hexOn(new Point(2, 0));
    expect(sourceNoteOn).toHaveBeenCalledTimes(1);
    keys.state.activeKeyboard.set("KeyA", sourceHex);

    expect(keys.armModulation()).toBe(true);
    const targetHex = keys.hexOn(new Point(5, 0));
    keys.state.activeKeyboard.set("KeyB", targetHex);

    expect(synth.makeHex).toHaveBeenCalledTimes(1);
    expect(sourceNoteOn).toHaveBeenCalledTimes(1);
    expect(targetHex).not.toBe(sourceHex);
    expect(targetHex._noteContext?.frameId).toBe(keys.getModulationState().pendingFrame?.id);
    expect(targetHex.coords).toEqual(new Point(5, 0));

    keys.noteOff(sourceHex, 0);
    expect(sourceNoteOff).not.toHaveBeenCalled();

    keys.noteOff(targetHex, 0);
    expect(sourceNoteOff).toHaveBeenCalledTimes(1);
  });

  it("soft-handoffs transferred poly aftertouch from source to target pressure", () => {
    const sourceAftertouch = vi.fn();
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
        aftertouch: sourceAftertouch,
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {},
      synth,
    );

    const sourceHex = keys.hexOn(new Point(2, 0));
    sourceHex._lastAftertouch = 80;
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(new Point(5, 0));
    keys.state.activeKeyboard.set("KeyB", targetHex);
    sourceAftertouch.mockClear();

    keys._applyPolyAftertouch(targetHex, 20);
    expect(sourceAftertouch).not.toHaveBeenCalled();

    keys._applyPolyAftertouch(sourceHex, 90);
    expect(sourceAftertouch).toHaveBeenLastCalledWith(90);

    keys._applyPolyAftertouch(targetHex, 90);
    expect(sourceAftertouch).toHaveBeenLastCalledWith(90);

    keys._applyPolyAftertouch(sourceHex, 127);
    expect(sourceAftertouch).toHaveBeenCalledTimes(2);

    keys._applyPolyAftertouch(targetHex, 60);
    expect(sourceAftertouch).toHaveBeenLastCalledWith(60);
  });

  it("soft-handoffs transferred MPE CC74 and pitch bend expression", () => {
    const sourceCC74 = vi.fn();
    const sourceRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune: sourceRetune,
        cc74: sourceCC74,
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      { mpeInput: true, bendRange: "2/1" },
      synth,
    );

    const sourceHex = keys.hexOn(new Point(2, 0));
    sourceHex._lastCC74 = 80;
    sourceHex._lastPitchBend14 = 12000;
    sourceHex._lastPitchBendCents = sourceHex.cents + 50;
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    expect(keys.armModulation()).toBe(true);

    const targetHex = keys.hexOn(new Point(5, 0));
    keys.state.activeKeyboard.set("KeyB", targetHex);
    sourceCC74.mockClear();
    sourceRetune.mockClear();

    keys._applyTimbreCC74(targetHex, 20);
    expect(sourceCC74).not.toHaveBeenCalled();

    keys._applyTimbreCC74(sourceHex, 90);
    expect(sourceCC74).toHaveBeenLastCalledWith(90);

    keys._applyTimbreCC74(targetHex, 90);
    expect(sourceCC74).toHaveBeenLastCalledWith(90);

    keys._applyTimbreCC74(sourceHex, 127);
    expect(sourceCC74).toHaveBeenCalledTimes(2);

    keys._applyTimbreCC74(targetHex, 60);
    expect(sourceCC74).toHaveBeenLastCalledWith(60);

    // NOTE: pitch bend routing through the modulation transfer proxy cannot be
    // directly tested via _applyMpePitchBend here because these hexes were
    // activated via keyboard (hexOn), not MIDI, so activeMidiByChannel is empty.
    // The transfer proxy (_transferProxy/_transferSourcePitchBend) is installed
    // on sourceHex when armModulation+hexOn creates the target, but the
    // applyMpePitchBend path routes through activeMidiByChannel entries.
    // Transferred pitch bend expression is covered by the existing note-transfer
    // integration tests and by the end-to-end MPE listener tests.
  });

  it("moves recency pitch-wheel bend onto the transferred target proxy", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {
        wheelToRecent: true,
        pitchBendMode: "recency",
      },
      synth,
    );

    const sourceHex = keys.hexOn(new Point(2, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    keys._handleWheelBend(12000);
    expect(keys._wheelTarget).toBe(sourceHex);

    expect(keys.armModulation()).toBe(true);
    const targetHex = keys.hexOn(new Point(5, 0));

    expect(keys._wheelTarget).toBe(targetHex);
    expect(targetHex.cents).toBeCloseTo((targetHex._baseCents ?? 0) + keys._wheelBend, 5);
  });

  it("preserves an in-flight non-MPE wheel bend when a transferred source key releases", () => {
    const sourceRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune: sourceRetune,
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {
        wheelToRecent: true,
        pitchBendMode: "recency",
      },
      synth,
    );

    const sourceHex = keys.hexOn(new Point(2, 0));
    keys.state.activeKeyboard.set("KeyA", sourceHex);
    keys._handleIncomingWheelBend(12000);

    expect(keys.armModulation()).toBe(true);
    const targetHex = keys.hexOn(new Point(5, 0));
    keys.state.activeKeyboard.set("KeyB", targetHex);
    const expectedBentCents = targetHex._lastPitchBendCents;
    sourceRetune.mockClear();

    keys.noteOff(sourceHex, 64);

    expect(sourceRetune).toHaveBeenCalled();
    expect(sourceRetune).toHaveBeenLastCalledWith(expectedBentCents, true);
  });

  it("uses the first played note as the source when modulation was armed without one", () => {
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        retune(newCents) {
          this.cents = newCents;
        },
      })),
    };
    const keys = createKeys(
      {
        key_labels: "note_names",
        note: true,
        no_labels: false,
        keyCodeToCoords: {},
        note_names: ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11"],
      },
      {},
      synth,
    );

    expect(keys.armModulation()).toBe(true);
    const sourceHex = keys.hexOn(new Point(0, 0));

    expect(sourceHex).toBeTruthy();
    expect(keys.getModulationState().mode).toBe("awaiting_target");
    expect(keys.getModulationState().sourceDegree).toBe(0);
    expect(keys.getModulationState().history).toEqual([]);
    expect(keys.getModulationState().currentRoute).toBeNull();
    expect(keys.getEffectiveFundamental()).toBeCloseTo(440, 5);
  });

  it("does not throw when a MIDI port is selected while WebMidi is temporarily disabled", () => {
    const enabledDescriptor = Object.getOwnPropertyDescriptor(WebMidi, "enabled");
    const getInputSpy = vi.spyOn(WebMidi, "getInputById");
    try {
      Object.defineProperty(WebMidi, "enabled", {
        configurable: true,
        get: () => false,
      });

      let keys;
      expect(() => {
        keys = createKeys({
          midiin_device: "test-input",
        });
      }).not.toThrow();
      expect(getInputSpy).toHaveBeenCalledWith("test-input");
      expect(keys.midiin_data).toBeNull();
    } finally {
      if (enabledDescriptor) {
        Object.defineProperty(WebMidi, "enabled", enabledDescriptor);
      } else {
        delete WebMidi.enabled;
      }
    }
  });

  it("does not bootstrap fixed-do history through live MIDI rebuild before geometry is ready", () => {
    expect(() =>
      createKeys(
        {
          midiin_device: "test-input",
          midiin_controller_override: "generic",
        },
        {},
        {},
        [
          {
            sourceDegree: 0,
            targetDegree: 2,
            strategy: "retune_surface_to_source",
            count: 1,
            transpositionDeltaCents: -200,
          },
        ],
      )).not.toThrow();
  });

  it("uses controller-provided scale pitch cents in nearest-scale mode", () => {
    const keys = createKeys({}, { target: "scale" });
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 100,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.controller = {
      resolveScaleInputPitchCents: vi.fn(() => 100),
    };
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(4, 0));

    keys.midinoteOn(makeMidiEvent(60, 9));

    expect(keys.controller.resolveScaleInputPitchCents).toHaveBeenCalledWith(9, 60, keys.settings);
    expect(keys.coordResolver.coordForSteps).toHaveBeenCalledWith(1);
    expect(hexOn).toHaveBeenCalledWith(
      new Point(4, 0),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      { liveInputAddress: null },
    );
  });

  it("keeps nearest-scale note identity fixed under modulation when fixed-do is enabled", () => {
    const keys = createKeys(
      {
        modulation_style: "fixed_do",
      },
      { target: "scale" },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 5,
          strategy: "retune_surface_in_place",
          count: 1,
          transpositionDeltaCents: 500,
        },
      ],
    );
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 0,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.controller = {
      resolveScaleInputPitchCents: vi.fn(() => 500),
    };
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));

    keys.midinoteOn(makeMidiEvent(60, 9));

    expect(keys.getModulationState().currentFrame.transpositionCents).toBe(500);
    expect(keys.coordResolver.coordForSteps).toHaveBeenCalledWith(0);
    expect(hexOn).toHaveBeenCalledWith(
      new Point(0, 0),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      { liveInputAddress: null },
    );
  });

  it("still follows the modulated nearest degree in scale mode when moveable-do is enabled", () => {
    const keys = createKeys(
      {
        modulation_style: "moveable_do",
      },
      { target: "scale" },
      {},
      [
        {
          sourceDegree: 0,
          targetDegree: 5,
          strategy: "retune_surface_to_source",
          count: 1,
          transpositionDeltaCents: 500,
        },
      ],
    );
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 500,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.controller = {
      resolveScaleInputPitchCents: vi.fn(() => 500),
    };
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(5, 0));

    keys.midinoteOn(makeMidiEvent(60, 9));

    expect(keys.getModulationState().currentFrame.transpositionCents).toBe(500);
    expect(keys.coordResolver.coordForSteps).toHaveBeenCalledWith(5);
  });

  it("uses the dedicated MPE pitch-bend semitone range when resolving pre-bent MPE nearest-scale note-ons", () => {
    const keys = createKeys({}, {
      target: "scale",
      mpeInput: true,
      scaleBendRange: 12,
      bendRange: "4/1",
    });
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 600,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(-3, 0));
    keys._scaleModePreBend.set(9, 12288);

    keys.midinoteOn(makeMidiEvent(60, 9));

    expect(keys.coordResolver.coordForSteps).toHaveBeenCalledWith(-3);
    expect(hexOn).toHaveBeenCalledWith(
      new Point(-3, 0),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      {
        liveInputAddress: {
          channel: 9,
          note: 60,
        },
      },
    );
  });

  it("anchors Continuum nearest-scale bend at the snapped onset note instead of reapplying absolute bend from center", () => {
    const makeHex = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) {
        this.cents = newCents;
      }),
    }));
    const keys = createKeys(
      {},
      {
        target: "scale",
        mpeInput: true,
        scaleBendRange: 48,
        bendRange: "2/1",
        hakenXGlideMode: "pitch_bending",
      },
      { makeHex },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(-3, 0));
    keys._scaleModePreBend.set(9, 12288);
    keys._mpeInputBendByChannel.set(9, 12288);

    keys.midinoteOn(makeMidiEvent(60, 9));

    const hex = makeHex.mock.results[0].value;
    expect(hex.retune).not.toHaveBeenCalled();
    expect(hex._scaleModeBendAnchor14).toBe(12288);

    // bend14=13312, anchor=12288 → norm=(13312-12288)/8192=0.125
    // scaleFactor=1 (default), shaping=0 → bentCents = baseCents + 0.125 * 4800 = baseCents + 600
    const entry = keys.state.activeMidiByChannel.get(9);
    const baseCents = hex._baseCents ?? hex.cents;
    keys._applyMpePitchBend(entry, 9, 13312);
    expect(hex.retune).toHaveBeenCalledTimes(1);
    expect(hex.retune.mock.calls[0][0]).toBeCloseTo(baseCents + 600, 5);
    expect(hex.retune.mock.calls[0][1]).toBe(true);
  });

  it("routes Continuum raster X glide through discrete retrigger handling instead of continuous retune", () => {
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "scale",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
      },
    );
    keys.controller = { id: "hakenaudio" };
    const entry = {
      hex: {
        release: false,
      },
      baseCents: 0,
    };
    const rasterSpy = vi.spyOn(keys, "_hakenRasterBend").mockImplementation(() => {});

    keys._applyMpePitchBend(entry, 9, 12288);

    expect(rasterSpy).toHaveBeenCalledTimes(1);
    expect(rasterSpy).toHaveBeenCalledWith(entry, 9, 12288, true);
  });

  it("derives Continuum raster nearest-scale retriggers from absolute incoming note plus bend", () => {
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "scale",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        scaleBendRange: 48,
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.noteOff = vi.fn();
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn((steps) => new Point(steps, 0));
    const newHex = {
      coords: new Point(12, 0),
      cents: 1200,
      _baseCents: 1200,
      release: false,
    };
    keys.hexOn = vi.fn(() => newHex);
    const baseHz = 440 * Math.pow(2, (60 - 69) / 12);
    const pitchCentsSpy = vi
      .spyOn(keys, "_resolveScaleInputPitchCents")
      .mockImplementation((_channel, _note, fallbackPitchHz) => {
        expect(fallbackPitchHz).toBeCloseTo(baseHz * 2, 8);
        return 1200;
      });

    const oldHex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 99999,
      _notePlayed: 60,
      _velocityPlayed: 96,
      _lastAftertouch: 127,
      _rasterSteps: 0,
      noteOff: vi.fn(),
      release: false,
    };
    const entry = {
      hex: oldHex,
      baseCents: oldHex._baseCents,
      hexes: new Set([oldHex]),
    };
    keys.state.activeMidi.set(60, oldHex);
    keys.state.activeMidiByChannel.set(5, entry);

    // With a 48-semitone MPE bend range, +12 semitones corresponds to val14=10240.
    keys._hakenRasterBend(entry, 5, 10240, true);

    expect(pitchCentsSpy).toHaveBeenCalledTimes(1);
    expect(keys.hexOn).toHaveBeenCalledTimes(1);
    expect(keys.hexOn.mock.calls[0][0]).toEqual(new Point(12, 0));
    expect(keys.state.activeMidi.get(60)).toBe(newHex);
  });

  it("uses continuous Continuum X bend in nearest-scale raster mode so non-12edo degrees can be selected", () => {
    const keys = createKeys(
      {
        midiin_controller_override: "hakenaudio",
        scale: [0, 30, 130],
        equivSteps: 3,
        equivInterval: 1200,
      },
      {
        target: "scale",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        scaleBendRange: 12,
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.noteOff = vi.fn();
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn((steps) => new Point(steps, 0));
    vi.spyOn(keys, "_resolveScaleInputPitchCents").mockReturnValue(70);
    const newHex = {
      coords: new Point(1, 0),
      cents: 30,
      _baseCents: 30,
      release: false,
    };
    keys.hexOn = vi.fn(() => newHex);

    const oldHex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      _notePlayed: 60,
      _velocityPlayed: 96,
      _lastAftertouch: 127,
      _rasterSteps: 0,
      noteOff: vi.fn(),
      release: false,
    };
    const entry = {
      hex: oldHex,
      baseCents: oldHex._baseCents,
      hexes: new Set([oldHex]),
    };
    keys.state.activeMidi.set(60, oldHex);
    keys.state.activeMidiByChannel.set(5, entry);

    // About +70 cents with a 12-semitone bend range.
    // Continuous pitch should snap to scale degree 30c (step 1),
    // whereas semitone rounding would incorrectly jump to 130c (step 2).
    keys._hakenRasterBend(entry, 5, 8670, true);

    expect(keys.coordResolver.coordForSteps).toHaveBeenCalledWith(1);
    expect(keys.hexOn.mock.calls[0][0]).toEqual(new Point(1, 0));
    expect(keys.state.activeMidi.get(60)).toBe(newHex);
  });

  it("momentarily flips Continuum pitch bending and raster modes with the space bar", () => {
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "pitch_bending",
      },
    );
    keys.controller = { id: "hakenaudio" };
    const hex = { release: false };
    const entry = { hex, baseCents: 0, hexes: new Set([hex]) };
    keys.state.activeMidiByChannel.set(5, entry);
    keys._mpeInputBendByChannel.set(5, 10240);
    const bendSpy = vi.spyOn(keys, "_applyMpePitchBend").mockImplementation(() => {});

    keys.onKeyDown({
      code: "Space",
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    });

    expect(keys.inputRuntime.hakenSpaceGlideFlip).toBe(true);
    expect(bendSpy).toHaveBeenCalledWith(entry, 5, 10240);

    keys.onKeyUp({
      code: "Space",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    });

    expect(keys.inputRuntime.hakenSpaceGlideFlip).toBe(false);
    expect(bendSpy).toHaveBeenCalledTimes(2);
  });

  it("reanchors Continuum nearest-scale glide to the current rastered note when leaving raster mode", () => {
    const keys = createKeys(
      {
        midiin_controller_override: "hakenaudio",
        scale: [0, 100, 300, 610],
        equivSteps: 4,
        equivInterval: 1200,
      },
      {
        target: "scale",
        mpeInput: true,
        hakenXGlideMode: "pitch_bending",
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.inputRuntime.hakenSpaceGlideFlip = true;
    const hex = {
      coords: new Point(3, 0),
      cents: 300,
      _baseCents: 300,
      _rasterOnsetSteps: 0,
      _scaleModeBendAnchor14: 8192,
      release: false,
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    };
    const entry = { hex, baseCents: 300, hexes: new Set([hex]) };
    keys.state.activeMidiByChannel.set(5, entry);
    keys._mpeInputBendByChannel.set(5, 12288);
    keys.hexCoordsToCents = vi.fn(() => [300, 0, 2]);

    keys.onKeyUp({
      code: "Space",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    });

    expect(keys.inputRuntime.hakenSpaceGlideFlip).toBe(false);
    expect(hex._scaleModeBendAnchor14).toBe(12288);
    expect(hex._continuumPitchAnchor14).toBe(12288);
    expect(hex._continuumPitchAnchorSteps).toBe(2);
    expect(hex.retune).toHaveBeenCalledTimes(1);
    expect(hex.retune.mock.calls[0][0]).toBeCloseTo(300, 5);
  });

  it("reanchors Continuum hex-layout glide to the current rastered note when leaving raster mode", () => {
    const irregularScale = [0, 70, 300, 610];
    const keys = createKeys(
      {
        midiin_controller_override: "hakenaudio",
        scale: irregularScale,
        equivSteps: irregularScale.length,
        equivInterval: 1200,
      },
      {
        target: "hex_layout",
        mpeInput: true,
        scaleBendRange: 4,
        hakenXGlideMode: "pitch_bending",
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.inputRuntime.hakenSpaceGlideFlip = true;
    const hex = {
      coords: new Point(1, 0),
      cents: 300,
      _baseCents: 300,
      _rasterOnsetSteps: 0,
      release: false,
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    };
    const entry = { hex, baseCents: 300, hexes: new Set([hex]) };
    keys.state.activeMidiByChannel.set(5, entry);
    keys._mpeInputBendByChannel.set(5, 10240); // current rastered note is already offset
    keys.hexCoordsToCents = vi.fn(() => [300, 0, 2]);

    keys.onKeyUp({
      code: "Space",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    });

    expect(keys.inputRuntime.hakenSpaceGlideFlip).toBe(false);
    expect(hex._continuumPitchAnchor14).toBe(10240);
    expect(hex._continuumPitchAnchorSteps).toBe(2);
    expect(hex.retune).toHaveBeenCalledTimes(1);
    expect(hex.retune.mock.calls[0][0]).toBeCloseTo(300, 5);
  });

  it("varies Continuum raster retrigger velocities around onset attack according to current pressure", () => {
    const makeEntry = () => {
      const oldHex = {
        coords: new Point(0, 0),
        cents: 0,
        _baseCents: 0,
        _notePlayed: 60,
        _velocityPlayed: 96,
        _lastAftertouch: 40,
        _pressureSeenSinceOnset: true,
        _rasterOnsetSteps: 0,
        _rasterSteps: 0,
        noteOff: vi.fn(),
        release: false,
      };
      return {
        oldHex,
        entry: {
          hex: oldHex,
          baseCents: oldHex._baseCents,
          hexes: new Set([oldHex]),
        },
      };
    };

    const keysFlat = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        scaleBendRange: 48,
        hakenPressureVelocity: 0,
      },
    );
    keysFlat.controller = { id: "hakenaudio" };
    keysFlat.noteOff = vi.fn();
    keysFlat.hexOff = vi.fn();
    keysFlat.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    const flatNewHex = { coords: new Point(1, 0), cents: 100, _baseCents: 100, release: false };
    keysFlat.hexOn = vi.fn(() => flatNewHex);
    const { oldHex: oldHexFlat, entry: entryFlat } = makeEntry();
    keysFlat.state.activeMidi.set(60, oldHexFlat);
    keysFlat.state.activeMidiByChannel.set(5, entryFlat);

    keysFlat._hakenRasterBend(entryFlat, 5, 9045, false);

    expect(keysFlat.noteOff).toHaveBeenCalledWith(oldHexFlat, 96);
    expect(keysFlat.hexOn.mock.calls[0][2]).toBe(96);

    const keysPressure = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        scaleBendRange: 48,
        hakenPressureVelocity: 127,
      },
    );
    keysPressure.controller = { id: "hakenaudio" };
    keysPressure.noteOff = vi.fn();
    keysPressure.hexOff = vi.fn();
    keysPressure.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    const pressureNewHex = {
      coords: new Point(1, 0),
      cents: 100,
      _baseCents: 100,
      release: false,
    };
    keysPressure.hexOn = vi.fn(() => pressureNewHex);
    const { oldHex: oldHexPressure, entry: entryPressure } = makeEntry();
    keysPressure.state.activeMidi.set(60, oldHexPressure);
    keysPressure.state.activeMidiByChannel.set(5, entryPressure);

    keysPressure._hakenRasterBend(entryPressure, 5, 9045, false);

    expect(keysPressure.noteOff).toHaveBeenCalledWith(oldHexPressure, 40);
    expect(keysPressure.hexOn.mock.calls[0][2]).toBe(40);
  });

  it("keeps Continuum raster retrigger velocity at the raw onset attack until this touch has received pressure", () => {
    const oldHex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      _notePlayed: 60,
      _velocityPlayed: 96,
      _lastAftertouch: 0,
      _pressureSeenSinceOnset: false,
      _rasterOnsetSteps: 0,
      _rasterSteps: 0,
      noteOff: vi.fn(),
      release: false,
    };
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        scaleBendRange: 48,
        hakenPressureVelocity: 127,
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.noteOff = vi.fn();
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    const newHex = { coords: new Point(1, 0), cents: 100, _baseCents: 100, release: false };
    keys.hexOn = vi.fn(() => newHex);
    const entry = {
      hex: oldHex,
      baseCents: oldHex._baseCents,
      hexes: new Set([oldHex]),
    };
    keys.state.activeMidi.set(60, oldHex);
    keys.state.activeMidiByChannel.set(5, entry);

    keys._hakenRasterBend(entry, 5, 9045, false);

    expect(keys.noteOff).toHaveBeenCalledWith(oldHex, 96);
    expect(keys.hexOn.mock.calls[0][2]).toBe(96);
  });

  it("primes fresh per-channel Continuum Y/Z onto a new note onset", () => {
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "hex_layout", mpeInput: true },
    );
    keys.controller = { id: "hakenaudio" };
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    const hex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(),
      aftertouch: vi.fn(),
      cc74: vi.fn(),
    };
    keys.hexOn = vi.fn(() => hex);
    const applyAftertouchSpy = vi.spyOn(keys, "_applyPolyAftertouch");
    const applyCc74Spy = vi.spyOn(keys, "_applyTimbreCC74");
    const now = Date.now();
    keys._mpeInputAftertouchByChannel.set(5, { value: 88, time: now });
    keys._mpeInputCC74ByChannel.set(5, { value: 17, time: now });

    keys.midinoteOn(makeMidiEvent(60, 5));

    expect(applyAftertouchSpy).toHaveBeenCalledWith(hex, 88);
    expect(applyCc74Spy).toHaveBeenCalledWith(hex, 17);
    expect(hex._pressureSeenSinceOnset).toBe(true);
  });

  it("does not prime stale per-channel Continuum Y/Z onto a new note onset", () => {
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "hex_layout", mpeInput: true },
    );
    keys.controller = { id: "hakenaudio" };
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    const hex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(),
      aftertouch: vi.fn(),
      cc74: vi.fn(),
    };
    keys.hexOn = vi.fn(() => hex);
    const applyAftertouchSpy = vi.spyOn(keys, "_applyPolyAftertouch");
    const applyCc74Spy = vi.spyOn(keys, "_applyTimbreCC74");
    const staleTime = Date.now() - 500;
    keys._mpeInputAftertouchByChannel.set(5, { value: 88, time: staleTime });
    keys._mpeInputCC74ByChannel.set(5, { value: 17, time: staleTime });

    keys.midinoteOn(makeMidiEvent(60, 5));

    expect(applyAftertouchSpy).not.toHaveBeenCalledWith(hex, 88);
    expect(applyCc74Spy).not.toHaveBeenCalledWith(hex, 17);
    expect(hex._pressureSeenSinceOnset).toBe(false);
  });

  it("holds auto-generated Continuum raster notes only until the configured minimum duration is reached", () => {
    vi.useFakeTimers();
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        hakenNoteOffDelay: 40,
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    const newHex = { coords: new Point(1, 0), cents: 100, _baseCents: 100, release: false };
    keys.hexOn = vi.fn(() => newHex);
    const oldHex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      _notePlayed: 60 + 128 * 4,
      _velocityPlayed: 96,
      _lastAftertouch: 127,
      _rasterStartedAt: Date.now(),
      _rasterOnsetSteps: 0,
      _rasterSteps: 0,
      noteOff: vi.fn(),
      release: false,
    };
    const entry = {
      hex: oldHex,
      baseCents: oldHex._baseCents,
      hexes: new Set([oldHex]),
    };
    keys.state.activeMidi.set(60, oldHex);
    keys.state.activeMidiByChannel.set(5, entry);

    keys._hakenRasterBend(entry, 5, 9045, false);

    expect(oldHex.noteOff).not.toHaveBeenCalled();
    vi.advanceTimersByTime(39);
    expect(oldHex.noteOff).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(oldHex.noteOff).toHaveBeenCalledWith(96);
  });

  it("releases an auto-generated Continuum raster note immediately once it has already satisfied the minimum duration", () => {
    vi.useFakeTimers();
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        hakenNoteOffDelay: 40,
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    const newHex = { coords: new Point(1, 0), cents: 100, _baseCents: 100, release: false };
    keys.hexOn = vi.fn(() => newHex);
    const oldHex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      _notePlayed: 60 + 128 * 4,
      _velocityPlayed: 96,
      _lastAftertouch: 127,
      _rasterStartedAt: Date.now(),
      _rasterOnsetSteps: 0,
      _rasterSteps: 0,
      noteOff: vi.fn(),
      release: false,
    };
    const entry = {
      hex: oldHex,
      baseCents: oldHex._baseCents,
      hexes: new Set([oldHex]),
    };
    keys.state.activeMidi.set(60, oldHex);
    keys.state.activeMidiByChannel.set(5, entry);

    vi.advanceTimersByTime(50);
    keys._hakenRasterBend(entry, 5, 9045, false);

    expect(oldHex.noteOff).toHaveBeenCalledWith(96);
  });

  it("flushes pending Continuum raster auto-releases immediately when a real note-off arrives", () => {
    vi.useFakeTimers();
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
        hakenNoteOffDelay: 100,
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    const newHex = {
      coords: new Point(1, 0),
      cents: 100,
      _baseCents: 100,
      noteOff: vi.fn(),
      release: false,
    };
    keys.hexOn = vi.fn(() => newHex);
    const oldHex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      _notePlayed: 60 + 128 * 4,
      _velocityPlayed: 96,
      _lastAftertouch: 127,
      _rasterOnsetSteps: 0,
      _rasterSteps: 0,
      noteOff: vi.fn(),
      release: false,
    };
    const entry = {
      hex: oldHex,
      baseCents: oldHex._baseCents,
      hexes: new Set([oldHex]),
    };
    keys.state.activeMidi.set(60 + 128 * 4, oldHex);
    keys.state.activeMidiByChannel.set(5, entry);
    const actualCurrentHex = {
      coords: new Point(1, 0),
      cents: 100,
      _baseCents: 100,
      noteOff: vi.fn(),
      release: false,
    };

    keys._hakenRasterBend(entry, 5, 9045, false);

    keys.state.activeMidi.set(60 + 128 * 4, actualCurrentHex);
    keys.state.activeMidiByChannel.set(5, { hex: actualCurrentHex, baseCents: 100, hexes: new Set([actualCurrentHex]) });
    keys.noteOff = vi.fn();

    keys.midinoteOff(makeMidiEvent(60, 5, 96, 55));

    expect(oldHex.noteOff).toHaveBeenCalledWith(96);
    expect(actualCurrentHex.noteOff).not.toHaveBeenCalled();
    expect(keys.noteOff).toHaveBeenCalledWith(actualCurrentHex, 55);
    vi.advanceTimersByTime(100);
    expect(oldHex.noteOff).toHaveBeenCalledTimes(1);
  });

  it("applies current Continuum Y and Z expression immediately to raster retriggered notes", () => {
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      {
        target: "hex_layout",
        mpeInput: true,
        hakenXGlideMode: "raster_to_notes",
      },
    );
    keys.controller = { id: "hakenaudio" };
    keys.noteOff = vi.fn();
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    const aftertouch = vi.fn();
    const cc74 = vi.fn();
    const newHex = {
      coords: new Point(1, 0),
      cents: 100,
      _baseCents: 100,
      release: false,
      aftertouch,
      cc74,
    };
    keys.hexOn = vi.fn(() => newHex);
    const oldHex = {
      coords: new Point(0, 0),
      cents: 0,
      _baseCents: 0,
      _notePlayed: 60,
      _velocityPlayed: 96,
      _lastAftertouch: 53,
      _lastCC74: 91,
      _rasterOnsetSteps: 0,
      _rasterSteps: 0,
      noteOff: vi.fn(),
      release: false,
    };
    const entry = {
      hex: oldHex,
      baseCents: oldHex._baseCents,
      hexes: new Set([oldHex]),
    };
    keys.state.activeMidi.set(60, oldHex);
    keys.state.activeMidiByChannel.set(5, entry);

    keys._hakenRasterBend(entry, 5, 9045, false);

    expect(aftertouch).toHaveBeenCalledWith(53);
    expect(cc74).toHaveBeenCalledWith(91);
    expect(newHex._lastAftertouch).toBe(53);
    expect(newHex._lastCC74).toBe(91);
  });

  it("applies Continuum nearest-scale X glide shaping after snap", () => {
    const makeHex = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) {
        this.cents = newCents;
      }),
    }));
    const keys = createKeys(
      {
        midiin_controller_override: "hakenaudio",
      },
      {
        target: "scale",
        mpeInput: true,
        scaleBendRange: 48,
        bendRange: "2/1",
        hakenXGlideShaping: 100,
        hakenXGlideMode: "pitch_bending",
      },
      { makeHex },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(-3, 0));
    keys._scaleModePreBend.set(9, 12288);
    keys._mpeInputBendByChannel.set(9, 12288);

    keys.midinoteOn(makeMidiEvent(60, 9));

    const hex = makeHex.mock.results[0].value;
    const entry = keys.state.activeMidiByChannel.get(9);
    keys._applyMpePitchBend(entry, 9, 13312);

    expect(hex.retune).toHaveBeenCalledTimes(1);
    const bent = hex.retune.mock.calls[0][0];
    expect(bent).toBeGreaterThan(hex._baseCents ?? hex.cents);
  });

  it("Continuum bend is symmetric: equal magnitude up and down from anchor", () => {
    const makeHexUp = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keysUp = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "scale", mpeInput: true, scaleBendRange: 48, bendRange: "2/1", hakenXGlideShaping: 0, hakenXGlideMode: "pitch_bending" },
      { makeHex: makeHexUp },
    );
    keysUp.controller = { id: "hakenaudio" };
    keysUp.hexOff = vi.fn();
    keysUp.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    keysUp._scaleModePreBend.set(5, 8192);
    keysUp._mpeInputBendByChannel.set(5, 8192);
    keysUp.midinoteOn(makeMidiEvent(60, 5));
    const hexUp = makeHexUp.mock.results[0].value;
    const entryUp = keysUp.state.activeMidiByChannel.get(5);
    const baseCentsUp = hexUp._baseCents ?? hexUp.cents;
    keysUp._applyMpePitchBend(entryUp, 5, 8192 + 1024); // +1024 up
    const upDelta = hexUp.retune.mock.calls[0][0] - baseCentsUp;

    const makeHexDown = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keysDown = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "scale", mpeInput: true, scaleBendRange: 48, bendRange: "2/1", hakenXGlideShaping: 0, hakenXGlideMode: "pitch_bending" },
      { makeHex: makeHexDown },
    );
    keysDown.controller = { id: "hakenaudio" };
    keysDown.hexOff = vi.fn();
    keysDown.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    keysDown._scaleModePreBend.set(5, 8192);
    keysDown._mpeInputBendByChannel.set(5, 8192);
    keysDown.midinoteOn(makeMidiEvent(60, 5));
    const hexDown = makeHexDown.mock.results[0].value;
    const entryDown = keysDown.state.activeMidiByChannel.get(5);
    const baseCentsDown = hexDown._baseCents ?? hexDown.cents;
    keysDown._applyMpePitchBend(entryDown, 5, 8192 - 1024); // -1024 down
    const downDelta = hexDown.retune.mock.calls[0][0] - baseCentsDown;

    expect(Math.abs(upDelta)).toBeCloseTo(Math.abs(downDelta), 5);
    expect(upDelta).toBeGreaterThan(0);
    expect(downDelta).toBeLessThan(0);
  });

  it("Continuum shaped bend remains symmetric up and down from anchor", () => {
    const makeHexUp = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keysUp = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "scale", mpeInput: true, scaleBendRange: 48, bendRange: "2/1", hakenXGlideShaping: 100, hakenXGlideMode: "pitch_bending" },
      { makeHex: makeHexUp },
    );
    keysUp.controller = { id: "hakenaudio" };
    keysUp.hexOff = vi.fn();
    keysUp.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    keysUp._scaleModePreBend.set(5, 8192);
    keysUp._mpeInputBendByChannel.set(5, 8192);
    keysUp.midinoteOn(makeMidiEvent(60, 5));
    const hexUp = makeHexUp.mock.results[0].value;
    const entryUp = keysUp.state.activeMidiByChannel.get(5);
    const baseCentsUp = hexUp._baseCents ?? hexUp.cents;
    keysUp._applyMpePitchBend(entryUp, 5, 8192 + 1024);
    const upDelta = hexUp.retune.mock.calls[0][0] - baseCentsUp;

    const makeHexDown = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keysDown = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "scale", mpeInput: true, scaleBendRange: 48, bendRange: "2/1", hakenXGlideShaping: 100, hakenXGlideMode: "pitch_bending" },
      { makeHex: makeHexDown },
    );
    keysDown.controller = { id: "hakenaudio" };
    keysDown.hexOff = vi.fn();
    keysDown.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    keysDown._scaleModePreBend.set(5, 8192);
    keysDown._mpeInputBendByChannel.set(5, 8192);
    keysDown.midinoteOn(makeMidiEvent(60, 5));
    const hexDown = makeHexDown.mock.results[0].value;
    const entryDown = keysDown.state.activeMidiByChannel.get(5);
    const baseCentsDown = hexDown._baseCents ?? hexDown.cents;
    keysDown._applyMpePitchBend(entryDown, 5, 8192 - 1024);
    const downDelta = hexDown.retune.mock.calls[0][0] - baseCentsDown;

    expect(Math.abs(upDelta)).toBeCloseTo(Math.abs(downDelta), 5);
    expect(upDelta).toBeGreaterThan(0);
    expect(downDelta).toBeLessThan(0);
  });

  it("Continuum X glide shaping creates more stability near note centers", () => {
    const makeHexFlat = vi.fn((coords, cents) => ({
      coords, cents, release: false, noteOn: vi.fn(), noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keysFlat = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "scale", mpeInput: true, scaleBendRange: 5, bendRange: "2/1", hakenXGlideShaping: 0, hakenXGlideMode: "pitch_bending" },
      { makeHex: makeHexFlat },
    );
    keysFlat.controller = { id: "hakenaudio" };
    keysFlat.hexOff = vi.fn();
    keysFlat.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    keysFlat._scaleModePreBend.set(5, 8192);
    keysFlat._mpeInputBendByChannel.set(5, 8192);
    keysFlat.midinoteOn(makeMidiEvent(60, 5));
    const hexFlat = makeHexFlat.mock.results[0].value;
    const entryFlat = keysFlat.state.activeMidiByChannel.get(5);
    const baseCentsFlat = hexFlat._baseCents ?? hexFlat.cents;
    keysFlat._applyMpePitchBend(entryFlat, 5, 10240);
    const flatBend = Math.abs(hexFlat.retune.mock.calls[0][0] - baseCentsFlat);

    const makeHexShaped = vi.fn((coords, cents) => ({
      coords, cents, release: false, noteOn: vi.fn(), noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keysShaped = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "scale", mpeInput: true, scaleBendRange: 5, bendRange: "2/1", hakenXGlideShaping: 100, hakenXGlideMode: "pitch_bending" },
      { makeHex: makeHexShaped },
    );
    keysShaped.controller = { id: "hakenaudio" };
    keysShaped.hexOff = vi.fn();
    keysShaped.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    keysShaped._scaleModePreBend.set(5, 8192);
    keysShaped._mpeInputBendByChannel.set(5, 8192);
    keysShaped.midinoteOn(makeMidiEvent(60, 5));
    const hexShaped = makeHexShaped.mock.results[0].value;
    const entryShaped = keysShaped.state.activeMidiByChannel.get(5);
    const baseCentsShaped = hexShaped._baseCents ?? hexShaped.cents;
    keysShaped._applyMpePitchBend(entryShaped, 5, 10240);
    const shapedBend = Math.abs(hexShaped.retune.mock.calls[0][0] - baseCentsShaped);

    // At a quarter of the way to the next note, shaping should hold the pitch
    // closer to the current note than the linear response does.
    expect(shapedBend).toBeLessThan(flatBend);
  });

  it("Continuum pitch bending follows scale degrees in MIDI to Hex Layout", () => {
    const irregularScale = [0, 70, 300, 610];
    const makeHex = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keys = createKeys(
      {
        midiin_controller_override: "hakenaudio",
        scale: irregularScale,
        equivSteps: irregularScale.length,
        equivInterval: 1200,
      },
      {
        target: "hex_layout",
        mpeInput: true,
        scaleBendRange: 4,
        hakenXGlideShaping: 0,
        hakenXGlideMode: "pitch_bending",
      },
      { makeHex },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.midinoteOn(makeMidiEvent(60, 5));
    const hex = makeHex.mock.results[0].value;
    const entry = keys.state.activeMidiByChannel.get(5);
    const baseCents = hex._baseCents ?? hex.cents;
    keys._applyMpePitchBend(entry, 5, 10240); // norm 0.25 => +1 scale degree

    expect(hex.retune).toHaveBeenCalledTimes(1);
    expect(hex.retune.mock.calls[0][0]).toBeCloseTo(baseCents + 70, 5);
  });

  it("Continuum nearest-scale pitch bending follows incoming bend range while staying scale-aware", () => {
    const irregularScale = [0, 70, 300, 610];
    const makeHex = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keys = createKeys(
      {
        midiin_controller_override: "hakenaudio",
        scale: irregularScale,
        equivSteps: irregularScale.length,
        equivInterval: 1200,
      },
      {
        target: "scale",
        mpeInput: true,
        scaleBendRange: 4,
        bendRange: "2/1",
        hakenXGlideShaping: 0,
        hakenXGlideMode: "pitch_bending",
      },
      { makeHex },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    keys._scaleModePreBend.set(5, 8192);
    keys._mpeInputBendByChannel.set(5, 8192);

    keys.midinoteOn(makeMidiEvent(60, 5));

    const hex = makeHex.mock.results[0].value;
    const entry = keys.state.activeMidiByChannel.get(5);
    const baseCents = hex._baseCents ?? hex.cents;
    keys._applyMpePitchBend(entry, 5, 10240); // norm 0.25 with span 4 => +1 scale degree

    expect(hex.retune).toHaveBeenCalledTimes(1);
    expect(hex.retune.mock.calls[0][0]).toBeCloseTo(baseCents + 100, 5);
  });

  it("Continuum nearest-scale X glide shaping holds near the same snapped scale degree as raster mode", () => {
    const irregularScale = [0, 70, 300, 610];
    const makeHex = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keys = createKeys(
      {
        midiin_controller_override: "hakenaudio",
        scale: irregularScale,
        equivSteps: irregularScale.length,
        equivInterval: 1200,
      },
      {
        target: "scale",
        mpeInput: true,
        scaleBendRange: 4,
        bendRange: "2/1",
        hakenXGlideShaping: 100,
        hakenXGlideMode: "pitch_bending",
      },
      { makeHex },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(1, 0));
    keys._scaleModePreBend.set(5, 8192);
    keys._mpeInputBendByChannel.set(5, 8192);

    keys.midinoteOn(makeMidiEvent(60, 5));

    const hex = makeHex.mock.results[0].value;
    const entry = keys.state.activeMidiByChannel.get(5);
    keys._applyMpePitchBend(entry, 5, 10240); // quarter bend: still nearer the lower snapped degree

    expect(hex.retune).toHaveBeenCalledTimes(1);
    const bent = hex.retune.mock.calls[0][0];
    expect(bent).toBeLessThan(170);
    expect(Math.abs(bent - 70)).toBeLessThan(Math.abs(bent - 300));
  });

  it("Continuum scale mode does not apply retune when bend is exactly at anchor", () => {
    const makeHex = vi.fn((coords, cents) => ({
      coords, cents, release: false, noteOn: vi.fn(), noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) { this.cents = newCents; }),
    }));
    const keys = createKeys(
      { midiin_controller_override: "hakenaudio" },
      { target: "scale", mpeInput: true, scaleBendRange: 48, bendRange: "2/1", hakenXGlideMode: "pitch_bending" },
      { makeHex },
    );
    keys.controller = { id: "hakenaudio" };
    keys.hexOff = vi.fn();
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(0, 0));
    keys._scaleModePreBend.set(5, 10000);
    keys._mpeInputBendByChannel.set(5, 10000);

    keys.midinoteOn(makeMidiEvent(60, 5));
    const hex = makeHex.mock.results[0].value;
    const entry = keys.state.activeMidiByChannel.get(5);
    const baseCents = hex._baseCents ?? hex.cents;

    // Sending same value as anchor → norm=0 → no pitch change
    keys._applyMpePitchBend(entry, 5, 10000);
    expect(hex.retune).toHaveBeenCalledTimes(1);
    expect(hex.retune.mock.calls[0][0]).toBeCloseTo(baseCents, 5);
  });

  it("Continuum channel filter does not block notes on the global channel (ch 1) outside MPE zone", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] = typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Haken Audio Continuum",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const hexOn = vi.fn((coords) => ({
      coords, cents: 0, _baseCents: 0, noteOn: vi.fn(), noteOff: vi.fn(), release: false,
    }));
    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "hakenaudio",
        midiin_mpe_lo_ch: 2,
        midiin_mpe_hi_ch: 14,
      },
      { layoutMode: "sequential", mpeInput: true },
      { makeHex: hexOn, rememberControllerState: vi.fn() },
    );
    keys.hexOn = hexOn;

    // ch 16 is outside zone — should be filtered
    listeners.noteon(makeMidiEvent(60, 16));
    // ch 2 is inside zone — should pass
    listeners.noteon(makeMidiEvent(60, 2));
    // ch 3 is inside zone — should pass
    listeners.noteon(makeMidiEvent(61, 3));

    expect(keys.controller?.id).toBe("hakenaudio");
    expect(hexOn).toHaveBeenCalledTimes(2);
  });

  it("releases the originally lit hex in nearest-scale mode even if pitch has changed since note-on", () => {
    const keys = createKeys({}, { target: "scale", mpeInput: true });
    const originalCoords = new Point(3, 4);
    const recomputedCoords = new Point(9, 9);
    const releaseHex = {
      coords: originalCoords,
      cents: 0,
      noteOff: vi.fn(),
      release: false,
    };

    keys.state.activeMidi.set(60 + 128, releaseHex);
    keys.noteOff = vi.fn();
    keys.hexOff = vi.fn();
    keys._resolveScaleInputPitchCents = vi.fn(() => 100);
    keys.coordResolver.stepsToVisibleCoords = vi.fn(() => [recomputedCoords]);

    keys.midinoteOff(makeMidiEvent(60, 2, 96, 55));

    expect(keys.noteOff).toHaveBeenCalledWith(releaseHex, 55);
    expect(keys.hexOff).toHaveBeenCalledWith(originalCoords);
    expect(keys.hexOff).not.toHaveBeenCalledWith(recomputedCoords);
  });

  it("releases the originally lit hex in hex-layout mode instead of recomputing release coords", () => {
    const keys = createKeys({}, {
      target: "hex_layout",
      mpeInput: true,
      layoutMode: "controller_geometry",
    });
    const originalCoords = new Point(8, -3);
    const recomputedCoords = new Point(2, 11);
    const releaseHex = {
      coords: originalCoords,
      cents: 0,
      noteOff: vi.fn(),
      release: false,
    };

    keys.state.activeMidi.set(60 + 128, releaseHex);
    keys.noteOff = vi.fn();
    keys.hexOff = vi.fn();
    keys.coordResolver.noteToCoords = vi.fn(() => recomputedCoords);

    keys.midinoteOff(makeMidiEvent(60, 2, 96, 55));

    expect(keys.noteOff).toHaveBeenCalledWith(releaseHex, 55);
    expect(keys.hexOff).toHaveBeenCalledWith(originalCoords);
    expect(keys.hexOff).not.toHaveBeenCalledWith(recomputedCoords);
  });

  it("does not keep a hex visually active when only a released MIDI hex remains at those coords", () => {
    const keys = createKeys();
    const coords = new Point(2, 3);
    const releasedHex = {
      coords,
      release: true,
    };
    keys.state.activeMidi.set(60, releasedHex);
    const colorSpy = vi.spyOn(keys, "centsToColor").mockReturnValue(["base", "text"]);
    keys.drawHex = vi.fn();

    keys.hexOff(coords);

    expect(colorSpy).toHaveBeenCalledWith(expect.any(Number), false, expect.anything());
  });

  it("does not retarget global recency wheel state when releasing one MPE nearest-scale note", () => {
    const keys = createKeys({}, {
      target: "scale",
      mpeInput: true,
      wheelToRecent: true,
      pitchBendMode: "recency",
    });
    const aHex = {
      coords: new Point(3, 4),
      cents: 100,
      _baseCents: 100,
      _inputChannel: 2,
      retune: vi.fn(function retune(newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };
    const bHex = {
      coords: new Point(6, 7),
      cents: 200,
      _baseCents: 200,
      _inputChannel: 3,
      retune: vi.fn(function retune(newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };

    keys.state.activeMidi.set(60 + 128, aHex);
    keys.state.activeMidi.set(60 + 256, bHex);
    keys.state.activeMidiByChannel.set(2, { hex: aHex, baseCents: 100, hexes: new Set([aHex]) });
    keys.state.activeMidiByChannel.set(3, { hex: bHex, baseCents: 200, hexes: new Set([bHex]) });
    keys.recencyStack.push(aHex);
    keys.recencyStack.push(bHex);
    keys._wheelTarget = bHex;
    keys._wheelValue14 = 12000;
    keys._wheelBend = 37;
    keys.hexOff = vi.fn();

    keys.midinoteOff(makeMidiEvent(60, 3, 96, 55));

    expect(keys._wheelTarget).toBe(null);
    expect(aHex.retune).not.toHaveBeenCalled();
    expect(bHex.retune).not.toHaveBeenCalled();
  });

  it("falls back to synthesized off-screen coords for high nearest-scale targets", () => {
    const keys = createKeys({}, { target: "scale" });
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 2400,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.controller = {
      resolveScaleInputPitchCents: vi.fn(() => 2400),
    };
    keys.coordResolver.coordForSteps = vi.fn(() => new Point(24, 0));

    keys.midinoteOn(makeMidiEvent(60, 9));

    expect(keys.coordResolver.coordForSteps).toHaveBeenCalledWith(24);
    expect(hexOn).toHaveBeenCalledWith(
      new Point(24, 0),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      { liveInputAddress: null },
    );
  });

  it("groups sequential channel transposition by channel pairs when configured", () => {
    const keys = createKeys(
      { midiin_anchor_note: 60, equivSteps: 12 },
      {
        layoutMode: "sequential",
        seqAnchorChannel: 10,
        stepsPerChannel: null,
        channelGroupSize: 2,
        legacyChannelMode: false,
      },
    );

    expect(keys.coordResolver.noteToSteps(60, 9)).toBe(0);
    expect(keys.coordResolver.noteToSteps(60, 10)).toBe(0);
    expect(keys.coordResolver.noteToSteps(60, 11)).toBe(12);
    expect(keys.coordResolver.noteToSteps(60, 12)).toBe(12);
    expect(keys.coordResolver.noteToSteps(60, 7)).toBe(-12);
    expect(keys.coordResolver.noteToSteps(60, 8)).toBe(-12);
  });

  it("updates sequential MIDI transposition runtime without rebuilding Keys", () => {
    const keys = createKeys(
      { midiin_anchor_note: 60, equivSteps: 12 },
      {
        layoutMode: "sequential",
        seqAnchorChannel: 1,
        stepsPerChannel: 0,
        channelGroupSize: 1,
        legacyChannelMode: false,
      },
    );

    const nextRuntime = {
      ...keys.inputRuntime,
      seqAnchorChannel: 10,
      stepsPerChannel: null,
      channelGroupSize: 2,
      legacyChannelMode: false,
    };
    keys.updateInputRuntime(nextRuntime, {
      midiin_anchor_channel: 10,
      midiin_steps_per_channel: null,
      midiin_channel_group_size: 2,
      midiin_channel_legacy: false,
    });

    expect(keys.inputRuntime).toBe(nextRuntime);
    expect(keys.coordResolver.inputRuntime).toBe(nextRuntime);
    expect(keys.coordResolver.noteToSteps(60, 9)).toBe(0);
    expect(keys.coordResolver.noteToSteps(60, 10)).toBe(0);
    expect(keys.coordResolver.noteToSteps(60, 11)).toBe(12);
    expect(keys.coordResolver.noteToSteps(60, 8)).toBe(-12);
  });

  it("uses controller geometry maps directly for known controller input", () => {
    const keys = createKeys();
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 300200,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.controller = { multiChannel: false };
    keys.controllerMap = new Map([["1.64", new Point(2, 3)]]);

    keys.midinoteOn(makeMidiEvent(64));

    expect(hexOn).toHaveBeenCalledTimes(1);
    expect(hexOn.mock.calls[0][0]).toEqual(new Point(2, 3));
  });

  it("does not drop known-controller keys just because their coords are off the visible grid", () => {
    const keys = createKeys();
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 300200,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.controller = { multiChannel: false };
    keys.controllerMap = new Map([["1.64", new Point(200, 200)]]);

    keys.midinoteOn(makeMidiEvent(64));

    expect(hexOn).toHaveBeenCalledTimes(1);
    expect(hexOn.mock.calls[0][0]).toEqual(new Point(200, 200));
  });

  it("honors manual controller override even when the MIDI port name is unknown", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "USB MIDI Interface",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "tonalplexus",
      midiin_anchor_channel: 9,
      midiin_anchor_note: 7,
    });

    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 300200,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();

    keys.midinoteOn(makeMidiEvent(7, 9));

    expect(keys.controller?.id).toBe("tonalplexus");
    expect(hexOn).toHaveBeenCalledTimes(1);
  });

  it("rebuilds controller maps live when the controller anchor changes", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "USB MIDI Interface",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "axis49",
      midiin_anchor_note: 53,
    });
    const initialMap = keys.controllerMap;
    const initialAnchorCoords = keys.controllerMap.get("1.53");

    keys.updateInputRuntime(
      { ...keys.inputRuntime, seqAnchorNote: 60 },
      { midiin_anchor_note: 60 },
    );

    expect(keys.controller?.id).toBe("axis49");
    expect(keys.controllerMap).not.toBe(initialMap);
    expect(keys.controllerMap.get("1.60")).toEqual(initialAnchorCoords);
  });

  it("syncs Lumatone colors after a live anchor-map change in 2D geometry", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "MIDI Function",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midi_passthrough: false,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
      lumatone_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    keys.autoSyncLumatoneLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, seqAnchorNote: 30, seqAnchorChannel: 4 },
      {
        midiin_anchor_note: 30,
        midiin_anchor_channel: 4,
        midiin_anchor_note: 30,
      },
    );

    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("auto-sends Lumatone colors for manual Lumatone 2D geometry override", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "MIDI Function",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
      lumatone_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    keys.autoSyncLumatoneLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, seqAnchorNote: 30, seqAnchorChannel: 4 },
      {
        midiin_anchor_note: 30,
        midiin_anchor_channel: 4,
        midiin_anchor_note: 30,
      },
    );

    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("does not auto-send Lumatone colors for manual geometry on an unrelated input", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "USB MIDI Interface",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
      lumatone_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    keys.autoSyncLumatoneLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, seqAnchorNote: 30, seqAnchorChannel: 4 },
      {
        midiin_anchor_note: 30,
        midiin_anchor_channel: 4,
        midiin_anchor_note: 30,
      },
    );

    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.autoSyncLumatoneLEDs).not.toHaveBeenCalled();
  });

  it("auto-sends Lumatone colors when returning from Generic Keyboard to Lumatone 2D geometry", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "MIDI Function",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "generic",
      midi_passthrough: true,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
      lumatone_led_sync: true,
    }, { layoutMode: "sequential" });
    expect(keys.controller?.id).toBe("generic");
    keys.autoSyncLumatoneLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "controller_geometry", seqAnchorNote: 26, seqAnchorChannel: 3 },
      {
        midiin_controller_override: "lumatone",
        midi_passthrough: false,
        midiin_anchor_note: 26,
        midiin_anchor_channel: 3,
        midiin_anchor_note: 26,
      },
    );

    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.controllerMap).toBeInstanceOf(Map);
    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("auto-sends Lumatone colors when returning from Generic Keyboard bypass semantics without passthrough toggled", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "MIDI Function",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "generic",
      midi_passthrough: false,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
      lumatone_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    expect(keys.controller?.id).toBe("generic");
    keys.autoSyncLumatoneLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "controller_geometry", seqAnchorNote: 26, seqAnchorChannel: 3 },
      {
        midiin_controller_override: "lumatone",
        midi_passthrough: false,
        midiin_anchor_note: 26,
        midiin_anchor_channel: 3,
        midiin_anchor_note: 26,
      },
    );

    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.controllerMap).toBeInstanceOf(Map);
    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("allows manual Lumatone Send Colours for manual 2D geometry override", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "USB MIDI Interface",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
      lumatone_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    keys.lumatoneLEDs = { sendAll: vi.fn() };
    keys._buildLumatoneColorEntries = vi.fn(() => [{ board: 3, key: 26, hexColor: "#ffffff" }]);

    keys.autoSyncLumatoneLEDs();
    expect(keys.lumatoneLEDs.sendAll).not.toHaveBeenCalled();

    keys.syncLumatoneLEDs();
    expect(keys.lumatoneLEDs.sendAll).toHaveBeenCalledWith([
      { board: 3, key: 26, hexColor: "#ffffff" },
    ]);
  });

  it("does not auto-send Lumatone colors when geometry is bypassed", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "MIDI Function",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midi_passthrough: true,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
      lumatone_led_sync: true,
    }, { layoutMode: "sequential" });
    keys.autoSyncLumatoneLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "sequential", seqAnchorNote: 30, seqAnchorChannel: 4 },
      {
        midiin_anchor_note: 30,
        midiin_anchor_channel: 4,
        midiin_anchor_note: 30,
      },
    );

    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.autoSyncLumatoneLEDs).not.toHaveBeenCalled();
  });

  it("syncs Exquis colors after a live anchor-map change when auto-send is enabled", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "Intuitive Instruments Exquis",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midi_passthrough: false,
      midiin_anchor_note: 19,
      exquis_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    keys.syncExquisLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, seqAnchorNote: 24 },
      {
        midiin_anchor_note: 24,
      },
    );

    expect(keys.controller?.id).toBe("exquis");
    expect(keys.syncExquisLEDs).toHaveBeenCalledTimes(1);
  });

  it("auto-sends Exquis colors for manual 2D geometry override", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "Intuitive Instruments Exquis",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "exquis",
      midi_passthrough: false,
      midiin_anchor_note: 19,
      exquis_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    keys.syncExquisLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, seqAnchorNote: 24 },
      {
        midiin_anchor_note: 24,
      },
    );

    expect(keys.controller?.id).toBe("exquis");
    expect(keys.syncExquisLEDs).toHaveBeenCalledTimes(1);
  });

  it("auto-sends Exquis colors when returning from Generic Keyboard to Exquis 2D geometry", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "Intuitive Instruments Exquis",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "generic",
      midi_passthrough: true,
      midiin_anchor_note: 60,
      exquis_led_sync: true,
    }, { layoutMode: "sequential" });
    expect(keys.controller?.id).toBe("generic");
    keys.syncExquisLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "controller_geometry", seqAnchorNote: 19 },
      {
        midiin_controller_override: "exquis",
        midi_passthrough: false,
        midiin_anchor_note: 19,
      },
    );

    expect(keys.controller?.id).toBe("exquis");
    expect(keys.controllerMap).toBeInstanceOf(Map);
    expect(keys.syncExquisLEDs).toHaveBeenCalledTimes(1);
  });

  it("syncs LinnStrument colors after a live anchor-map change when auto-send is enabled", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "Roger Linn Design LinnStrument 128",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midi_passthrough: false,
      midiin_anchor_channel: 4,
      midiin_anchor_note: 9,
      linnstrument_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    keys.syncLinnstrumentLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, seqAnchorNote: 12, seqAnchorChannel: 5 },
      {
        midiin_anchor_note: 12,
        midiin_anchor_channel: 5,
        midiin_anchor_note: 12,
      },
    );

    expect(keys.controller?.id).toBe("linnstrument");
    expect(keys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1);
  });

  it("auto-sends LinnStrument colors when returning from Generic Keyboard to LinnStrument 2D geometry", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "Roger Linn Design LinnStrument 128",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "generic",
      midi_passthrough: true,
      midiin_anchor_channel: 4,
      midiin_anchor_note: 9,
      linnstrument_led_sync: true,
    }, { layoutMode: "sequential" });
    expect(keys.controller?.id).toBe("generic");
    keys.syncLinnstrumentLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "controller_geometry", seqAnchorNote: 9, seqAnchorChannel: 4 },
      {
        midiin_controller_override: "linnstrument",
        midi_passthrough: false,
        midiin_anchor_note: 9,
        midiin_anchor_channel: 4,
        midiin_anchor_note: 9,
      },
    );

    expect(keys.controller?.id).toBe("linnstrument");
    expect(keys.controllerMap).toBeInstanceOf(Map);
    expect(keys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1);
  });

  it("auto-sends LinnStrument colors when returning from Generic Keyboard bypass semantics without passthrough toggled", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "Roger Linn Design LinnStrument 128",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "generic",
      midi_passthrough: false,
      midiin_anchor_channel: 4,
      midiin_anchor_note: 9,
      linnstrument_led_sync: true,
    }, { layoutMode: "controller_geometry" });
    expect(keys.controller?.id).toBe("generic");
    keys.syncLinnstrumentLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "controller_geometry", seqAnchorNote: 9, seqAnchorChannel: 4 },
      {
        midiin_controller_override: "linnstrument",
        midi_passthrough: false,
        midiin_anchor_note: 9,
        midiin_anchor_channel: 4,
        midiin_anchor_note: 9,
      },
    );

    expect(keys.controller?.id).toBe("linnstrument");
    expect(keys.controllerMap).toBeInstanceOf(Map);
    expect(keys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1);
  });

  it("does not auto-send LinnStrument colors when geometry is bypassed", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "Roger Linn Design LinnStrument 128",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midi_passthrough: true,
      midiin_anchor_channel: 4,
      midiin_anchor_note: 9,
      linnstrument_led_sync: true,
    }, { layoutMode: "sequential" });
    keys.syncLinnstrumentLEDs = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "sequential", seqAnchorNote: 12, seqAnchorChannel: 5 },
      {
        midiin_anchor_note: 12,
        midiin_anchor_channel: 5,
        midiin_anchor_note: 12,
      },
    );

    expect(keys.controller?.id).toBe("linnstrument");
    expect(keys.syncLinnstrumentLEDs).not.toHaveBeenCalled();
  });

  it("does not rebuild controller maps for unrelated input runtime changes", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "USB MIDI Interface",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "axis49",
      midiin_anchor_note: 53,
    });
    const initialMap = keys.controllerMap;

    keys.updateInputRuntime(
      { ...keys.inputRuntime, pitchBendMode: "all" },
      { midiin_pitchbend_mode: "all" },
    );

    expect(keys.controllerMap).toBe(initialMap);
  });

  it("clears the geometry map when switching from Lumatone to Generic Keyboard", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "MIDI Function",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
    });
    expect(keys.controller?.id).toBe("lumatone");
    expect(keys.controllerMap).toBeInstanceOf(Map);

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "sequential", seqAnchorNote: 60 },
      {
        midiin_controller_override: "generic",
        midi_passthrough: true,
        midiin_anchor_note: 60,
        midiin_anchor_channel: 1,
      },
    );

    expect(keys.controller?.id).toBe("generic");
    expect(keys.controllerMap).toBeNull();
  });

  it("releases active MIDI notes before switching controller routing", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "MIDI Function",
      addListener: vi.fn(),
    });
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "lumatone",
      midi_passthrough: false,
      midiin_anchor_channel: 3,
      midiin_anchor_note: 26,
    });
    keys.allnotesOff = vi.fn();

    keys.updateInputRuntime(
      { ...keys.inputRuntime, layoutMode: "sequential", seqAnchorNote: 60 },
      {
        midiin_controller_override: "generic",
        midi_passthrough: true,
        midiin_anchor_note: 60,
        midiin_anchor_channel: 1,
      },
    );

    expect(keys.allnotesOff).toHaveBeenCalledTimes(1);
  });

  it("uses step arithmetic for Generic Keyboard even if passthrough is false", () => {
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({
      name: "USB MIDI Interface",
      addListener: vi.fn(),
    });
    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "generic",
        midi_passthrough: false,
        midiin_anchor_note: 60,
      },
      { layoutMode: "controller_geometry", seqAnchorNote: 60 },
    );
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 100,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.coordResolver.bestVisibleCoord = vi.fn(() => new Point(0, 0));

    keys.midinoteOn(makeMidiEvent(60));

    expect(keys.controller?.id).toBe("generic");
    expect(keys.controllerMap).toBeNull();
    expect(keys.coordResolver.bestVisibleCoord).toHaveBeenCalledWith(0);
    expect(hexOn).toHaveBeenCalledTimes(1);
  });

  it("rebinds MIDI input listeners live when the selected input device changes", () => {
    const oldInput = {
      name: "Old Input",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    const newInput = {
      name: "C-Thru AXIS-49 2A",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    vi.spyOn(WebMidi, "getInputById").mockImplementation((id) =>
      id === "input-new" ? newInput : oldInput,
    );
    const keys = createKeys({
      midiin_device: "input-old",
      midiin_controller_override: "auto",
    });

    keys.updateInputRuntime(
      { ...keys.inputRuntime },
      { midiin_device: "input-new" },
    );

    expect(oldInput.removeListener).toHaveBeenCalledWith("noteon");
    expect(oldInput.removeListener).toHaveBeenCalledWith("pitchbend");
    expect(newInput.addListener).toHaveBeenCalledWith("noteon", expect.any(Function));
    expect(newInput.addListener).toHaveBeenCalledWith("pitchbend", expect.any(Function));
    expect(keys.midiin_data).toBe(newInput);
    expect(keys.controller?.id).toBe("axis49");
  });

  it("rebinds MIDI input listeners when runtime refresh finds a previously missing selected device", () => {
    const input = {
      name: "Roger Linn Design LinnStrument 128",
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    const getInputById = vi
      .spyOn(WebMidi, "getInputById")
      .mockReturnValueOnce(null)
      .mockReturnValue(input);
    const keys = createKeys({
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      linnstrument_led_sync: true,
    });
    keys.syncLinnstrumentLEDs = vi.fn();

    expect(keys.midiin_data).toBeNull();
    expect(keys.controllerMap).toBeNull();

    keys.updateInputRuntime(
      { ...keys.inputRuntime },
      {
        midiin_device: "input-1",
        midiin_controller_override: "auto",
      },
    );

    expect(getInputById).toHaveBeenCalledTimes(2);
    expect(input.addListener).toHaveBeenCalledWith("noteon", expect.any(Function));
    expect(input.addListener).toHaveBeenCalledWith("pitchbend", expect.any(Function));
    expect(keys.midiin_data).toBe(input);
    expect(keys.controller?.id).toBe("linnstrument");
    expect(keys.controllerMap).toBeInstanceOf(Map);
    expect(keys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1);
  });

  it("applies channel offsets for generic keyboard step arithmetic without a controller map", () => {
    const keys = createKeys(
      {
        midiin_anchor_note: 60,
        midiin_anchor_channel: 4,
      },
      {
        stepsPerChannel: null,
        seqAnchorChannel: 4,
      },
    );
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 100,
      noteOff: vi.fn(),
    }));
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys.controller = null;
    keys.controllerMap = null;
    keys.coordResolver.noteToSteps = vi.fn(() => 12);
    keys.coordResolver.bestVisibleCoord = vi.fn(() => new Point(12, 0));

    keys.midinoteOn(makeMidiEvent(60, 5));

    expect(hexOn).toHaveBeenCalledTimes(1);
    expect(keys.coordResolver.noteToSteps).toHaveBeenCalledWith(60, 5);
    expect(keys.coordResolver.bestVisibleCoord).toHaveBeenCalledWith(12);
    expect(hexOn.mock.calls[0][0]).toEqual(new Point(12, 0));
  });

  it("replays remembered controller state to a newly swapped synth", () => {
    const oldSynth = {
      rememberControllerState: vi.fn(),
      applyControllerState: vi.fn(),
    };
    const keys = createKeys({}, {}, oldSynth);

    keys._controllerCCValues.set(1, 93);
    keys._channelPressureValue = 54;
    keys._wheelValue14 = 12000;

    const newSynth = {
      rememberControllerState: vi.fn(),
      applyControllerState: vi.fn(),
    };

    keys.updateLiveOutputState(null, newSynth);

    expect(newSynth.rememberControllerState).toHaveBeenCalledWith({
      ccValues: { 1: 93 },
      channelPressure: 54,
      pitchBend14: 12000,
    });
    expect(newSynth.applyControllerState).toHaveBeenCalledWith({
      ccValues: { 1: 93 },
      channelPressure: 54,
      pitchBend14: 12000,
    });
  });

  it("restores persisted mod wheel state on refresh for the same MIDI input device", () => {
    const synth = {
      rememberControllerState: vi.fn(),
      applyControllerState: vi.fn(),
    };
    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_modwheel_value: 91,
        midiin_modwheel_source: "input-1",
      },
      {},
      synth,
    );

    keys.updateLiveOutputState(null, synth);

    expect(synth.rememberControllerState).toHaveBeenCalledWith({
      ccValues: { 1: 91 },
      channelPressure: 0,
      pitchBend14: 8192,
    });
    expect(synth.applyControllerState).toHaveBeenCalledWith({
      ccValues: { 1: 91 },
      channelPressure: 0,
      pitchBend14: 8192,
    });
  });

  it("uses the configured standard wheel semitone range when wheel-to-recent is off", () => {
    const standardWheelRetuneA = vi.fn();
    const standardWheelRetuneB = vi.fn();
    const keys = createKeys(
      {},
      {
        wheelToRecent: false,
        wheelSemitones: 12,
      },
    );
    const hexA = {
      release: false,
      _baseCents: 1000,
      cents: 1000,
      standardWheelRetune: standardWheelRetuneA,
    };
    const hexB = {
      release: false,
      _baseCents: 2200,
      cents: 2200,
      standardWheelRetune: standardWheelRetuneB,
    };
    keys.state.activeMidi.set(60, hexA);
    keys.state.activeMidi.set(61, hexB);

    keys._handleWheelBend(16383);

    expect(standardWheelRetuneA).toHaveBeenCalledTimes(1);
    expect(standardWheelRetuneB).toHaveBeenCalledTimes(1);
    expect(standardWheelRetuneA.mock.calls[0][0]).toBeCloseTo(2200, 0);
    expect(standardWheelRetuneB.mock.calls[0][0]).toBeCloseTo(3400, 0);
  });

  it("applies standard wheel bend immediately when wheel-to-recent is off", () => {
    const keys = createKeys({}, {
      wheelToRecent: false,
    });
    const handleSpy = vi.spyOn(keys, "_handleWheelBend");
    const applySpy = vi.spyOn(keys, "_applyWheelInputNow");

    keys._handleIncomingWheelBend(12000);

    expect(handleSpy).toHaveBeenCalledWith(12000);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("applies wheel-to-recent bend immediately without rAF scheduling", () => {
    const keys = createKeys({}, {
      wheelToRecent: true,
      pitchBendMode: "recency",
    });
    const handleSpy = vi.spyOn(keys, "_handleWheelBend");
    const applySpy = vi.spyOn(keys, "_applyWheelInputNow");
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    keys._wheelValue14 = 8192;
    keys._handleIncomingWheelBend(12000);

    expect(handleSpy).toHaveBeenCalledWith(12000);
    expect(applySpy).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(keys._wheelInputState.current).toBe(12000);
    expect(keys._wheelInputState.target).toBe(12000);
  });

  it("falls back to direct retune for non-sample hexes in standard wheel mode", () => {
    const standardWheelRetune = vi.fn();
    const retune = vi.fn();
    const keys = createKeys(
      {},
      {
        wheelToRecent: false,
        wheelSemitones: 2,
      },
    );
    const sampleLikeHex = {
      release: false,
      _baseCents: 1000,
      cents: 1000,
      standardWheelRetune,
      retune,
    };
    const mpeLikeHex = {
      release: false,
      _baseCents: 1500,
      cents: 1500,
      retune: vi.fn(),
    };
    keys.state.activeMidi.set(60, sampleLikeHex);
    keys.state.activeMidi.set(61, mpeLikeHex);

    keys._handleWheelBend(16383);

    expect(standardWheelRetune).toHaveBeenCalledTimes(1);
    expect(retune).not.toHaveBeenCalled();
    expect(mpeLikeHex.retune).toHaveBeenCalledTimes(1);
    expect(mpeLikeHex.retune.mock.calls[0][0]).toBeCloseTo(1700, 0);
    expect(mpeLikeHex.retune.mock.calls[0][1]).toBe(true);
  });

  it("primes new standard-wheel notes before note-on for retune-based outputs", () => {
    const makeHex = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) {
        this.cents = newCents;
      }),
    }));
    const keys = createKeys(
      {},
      {
        wheelToRecent: false,
        wheelSemitones: 2,
      },
      { makeHex },
    );

    keys._handleWheelBend(16383);
    keys.hexOn(new Point(1, 0), 60, 96, 0);

    expect(makeHex).toHaveBeenCalledTimes(1);
    const createdHex = makeHex.mock.results[0].value;
    expect(createdHex.retune).toHaveBeenCalledTimes(1);
    expect(createdHex.retune.mock.calls[0][0]).toBeCloseTo(300, 0);
    expect(createdHex.retune.mock.calls[0][1]).toBe(true);
    expect(createdHex.noteOn).toHaveBeenCalledTimes(1);
  });

  it("primes pre-note-on per-channel bend before note-on for retune-based outputs", () => {
    const makeHex = vi.fn((coords, cents) => ({
      coords,
      cents,
      release: false,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      retune: vi.fn(function retune(newCents) {
        this.cents = newCents;
      }),
    }));
    const keys = createKeys(
      {},
      {
        mpeInput: true,
        bendRange: "9/8",
      },
      { makeHex },
    );

    const bend14 = 12288;
    keys._mpeInputBendByChannel.set(3, bend14);
    keys.midinoteOn(makeMidiEvent(60, 3));

    expect(makeHex).toHaveBeenCalledTimes(1);
    const createdHex = makeHex.mock.results[0].value;
    expect(createdHex.retune).toHaveBeenCalledTimes(1);
    expect(createdHex.retune.mock.calls[0][0]).toBeCloseTo(101.955, 3);
    expect(createdHex.retune.mock.calls[0][1]).toBe(true);
    expect(createdHex.noteOn).toHaveBeenCalledTimes(1);
  });

  it("does not directly retune passthrough-only standard-wheel outputs", () => {
    const retune = vi.fn();
    const keys = createKeys(
      {},
      {
        wheelToRecent: false,
        wheelSemitones: 2,
      },
      {
        makeHex: vi.fn(() => ({
          coords: new Point(1, 0),
          cents: 100,
          release: false,
          standardWheelPassthroughOnly: true,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          retune,
        })),
      },
    );

    keys._handleWheelBend(16383);
    keys.hexOn(new Point(1, 0), 60, 96, 0);

    expect(retune).not.toHaveBeenCalled();
  });

  it("does not passthrough raw pitch bend in wheel-to-recent mode", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Lumatone MIDI Function",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune(newCents) {
          this.cents = newCents;
        },
      })),
      rememberControllerState: vi.fn(),
    };

    const keys = createKeys(
      {
        midiin_device: "input-1",
      },
      {
        wheelToRecent: true,
        pitchBendMode: "recency",
      },
      synth,
    );

    const passthroughSpy = vi.spyOn(keys, "_passthroughPitchBend");
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    keys.hexOn(new Point(1, 0), 60, 96, 0);

    listeners.pitchbend(makePitchBendEvent(12000));

    expect(passthroughSpy).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(keys._wheelBend).not.toBe(0);
  });

  it("routes LinnStrument bypass single-channel CC1, poly aftertouch, and pitch bend as generic input", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const modwheel = vi.fn();
    const aftertouch = vi.fn();
    const standardWheelRetune = vi.fn(function standardWheelRetune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        modwheel,
        aftertouch,
        standardWheelRetune,
      })),
      rememberControllerState: vi.fn(),
    };

    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        midi_passthrough: true,
      },
      {
        layoutMode: "sequential",
        wheelToRecent: false,
        wheelRange: "2/1",
        wheelUsesInterval: true,
        mpeInput: false,
      },
      synth,
    );

    listeners.noteon(makeMidiEvent(60, 1));
    const hex = keys.state.activeMidi.get(60);
    const baseCents = hex._baseCents;

    listeners.controlchange({ message: { channel: 1, dataBytes: [1, 64] } });
    listeners.keyaftertouch({ message: { channel: 1, dataBytes: [60, 80] } });
    listeners.pitchbend(makePitchBendEvent(16383, 1));

    expect(keys.controller?.id).toBe("linnstrument");
    expect(keys.controllerMap).toBeNull();
    expect(modwheel).toHaveBeenCalledWith(64);
    expect(aftertouch).toHaveBeenCalledWith(80);
    expect(standardWheelRetune).toHaveBeenCalledTimes(1);
    expect(standardWheelRetune.mock.calls[0][0]).toBeCloseTo(baseCents + 1200, 0);
  });

  it("ignores Continuum note input on reserved non-member channels outside the selected MPE zone", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Haken Audio Continuum",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 0,
      _baseCents: 0,
      noteOn: vi.fn(),
      noteOff: vi.fn(),
      release: false,
    }));

    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "hakenaudio",
        midiin_mpe_lo_ch: 2,
        midiin_mpe_hi_ch: 14,
      },
      {
        layoutMode: "sequential",
        mpeInput: true,
      },
      { makeHex: hexOn, rememberControllerState: vi.fn() },
    );

    keys.hexOn = hexOn;

    listeners.noteon(makeMidiEvent(60, 1));
    listeners.noteon(makeMidiEvent(60, 15));
    listeners.noteon(makeMidiEvent(60, 2));

    expect(keys.controller?.id).toBe("hakenaudio");
    expect(hexOn).toHaveBeenCalledTimes(1);
  });

  it("ignores Continuum per-channel expression outside the selected member-channel range", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Haken Audio Continuum",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const cc74 = vi.fn();
    const aftertouch = vi.fn();
    const retune = vi.fn();
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        cc74,
        aftertouch,
        retune,
      })),
      rememberControllerState: vi.fn(),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "hakenaudio",
        midiin_mpe_lo_ch: 2,
        midiin_mpe_hi_ch: 14,
      },
      {
        layoutMode: "sequential",
        mpeInput: true,
        bendRange: "2/1",
      },
      synth,
    );

    listeners.noteon(makeMidiEvent(60, 2));
    listeners.controlchange({ message: { channel: 1, dataBytes: [74, 80] } });
    listeners.channelaftertouch({ message: { channel: 1, dataBytes: [70] } });
    listeners.pitchbend(makePitchBendEvent(16383, 1));
    listeners.controlchange({ message: { channel: 2, dataBytes: [74, 81] } });
    listeners.channelaftertouch({ message: { channel: 2, dataBytes: [71] } });
    listeners.pitchbend(makePitchBendEvent(16383, 2));

    expect(cc74).toHaveBeenCalledTimes(1);
    expect(cc74).toHaveBeenCalledWith(81);
    expect(aftertouch).toHaveBeenCalledTimes(1);
    expect(aftertouch).toHaveBeenCalledWith(71);
    expect(retune).toHaveBeenCalledTimes(1);
  });

  it("routes LinnStrument channel-per-row bend to all active notes on that row channel", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const createdHexes = [];
    const synth = {
      makeHex: vi.fn((coords, cents) => {
        const hex = {
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune: vi.fn(function retune(newCents) {
            this.cents = newCents;
          }),
        };
        createdHexes.push(hex);
        return hex;
      }),
      rememberControllerState: vi.fn(),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        midi_passthrough: true,
      },
      {
        layoutMode: "sequential",
        mpeInput: false,
        perChannelExpression: true,
        bendRange: "2/1",
      },
      synth,
    );

    listeners.noteon(makeMidiEvent(60, 2));
    listeners.noteon(makeMidiEvent(61, 3));
    const row2First = createdHexes[0];
    const row3 = createdHexes[1];

    listeners.pitchbend(makePitchBendEvent(16383, 2));
    expect(row2First.retune).toHaveBeenCalledTimes(1);
    expect(row3.retune).not.toHaveBeenCalled();

    listeners.noteon(makeMidiEvent(62, 2));
    const row2Second = createdHexes[2];
    listeners.pitchbend(makePitchBendEvent(12000, 2));
    expect(row2Second.retune).toHaveBeenCalledTimes(2);
    expect(row2First.retune).toHaveBeenCalledTimes(2);

    listeners.noteoff(makeMidiEvent(62, 2));
    listeners.pitchbend(makePitchBendEvent(4096, 2));
    expect(row2First.retune).toHaveBeenCalledTimes(3);
    expect(row2Second.retune).toHaveBeenCalledTimes(2);
  });

  it("ignores LinnStrument UF X-data bend when row glide is off", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "off",
      },
      { layoutMode: "controller_geometry" },
      synth,
    );

    keys.midinoteOn(makeMidiEvent(9, 4));
    listeners.controlchange({ message: { channel: 4, dataBytes: [41, 0] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [9, 12] } });

    expect(keys.controller?.id).toBe("linnstrument");
    expect(retune).not.toHaveBeenCalled();
  });

  it("applies LinnStrument UF X-data bend when row glide follows scale/geometry", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    keys.midinoteOn(makeMidiEvent(9, 4));
    listeners.controlchange({ message: { channel: 4, dataBytes: [41, 0] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [9, 12] } });

    expect(keys.controller?.id).toBe("linnstrument");
    expect(retune).toHaveBeenCalledTimes(1);
  });

  it("parses LinnStrument UF X-data when MSB arrives before LSB", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    keys.midinoteOn(makeMidiEvent(12, 4));
    listeners.controlchange({ message: { channel: 4, dataBytes: [12, 12] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [44, 0] } });

    expect(keys.controller?.id).toBe("linnstrument");
    expect(retune).toHaveBeenCalledTimes(2);
  });

  it("updates LinnStrument UF bend from MSB changes using the latest known LSB", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(12, 4));
    listeners.controlchange({ message: { channel: 4, dataBytes: [44, 64] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [12, 12] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [12, 13] } });

    expect(retune).toHaveBeenCalledTimes(1);
  });

  it("does not bend a new LinnStrument UF note until one fresh X pair has arrived", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(12, 4));
    listeners.controlchange({ message: { channel: 4, dataBytes: [12, 12] } });
    expect(retune).not.toHaveBeenCalled();

    listeners.controlchange({ message: { channel: 4, dataBytes: [44, 64] } });
    expect(retune).toHaveBeenCalledTimes(1);
  });

  it("suppresses single-sample LinnStrument UF X spikes while keeping nearby updates", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(7, 7));
    listeners.keyaftertouch({ message: { channel: 7, dataBytes: [7, 80] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 16] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [7, 9] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 30] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 17] } });
    expect(retune).toHaveBeenCalledTimes(2);
  });

  it("applies a large LinnStrument UF X move after a confirming second sample", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(7, 7));
    listeners.keyaftertouch({ message: { channel: 7, dataBytes: [7, 80] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 16] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [7, 9] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 30] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 31] } });
    expect(retune).toHaveBeenCalledTimes(2);
  });

  it("uses a stricter LinnStrument UF X outlier threshold at low aftertouch", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
        aftertouch(value) {
          this._lastAftertouch = value;
        },
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(7, 7));
    listeners.keyaftertouch({ message: { channel: 7, dataBytes: [7, 18] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 16] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [7, 9] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 30] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 31] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 30] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 16] } });
    expect(retune).toHaveBeenCalledTimes(2);
  });

  it("can disable LinnStrument UF X spike reduction for raw-data testing", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
        aftertouch(value) {
          this._lastAftertouch = value;
        },
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_x_spike_reduction: 0,
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(7, 7));
    listeners.keyaftertouch({ message: { channel: 7, dataBytes: [7, 18] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 16] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [7, 9] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 30] } });
    expect(retune).toHaveBeenCalledTimes(2);
  });

  it("uses the strongest LinnStrument UF X spike reduction to collapse fine X motion into the MSB bucket", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
        aftertouch(value) {
          this._lastAftertouch = value;
        },
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_x_spike_reduction: 100,
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(7, 7));
    listeners.keyaftertouch({ message: { channel: 7, dataBytes: [7, 18] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 16] } });
    listeners.controlchange({ message: { channel: 7, dataBytes: [7, 9] } });
    expect(retune).toHaveBeenCalledTimes(1);
    const coarseOnlyCents = retune.mock.calls.at(-1)[0];
    retune.mockClear();

    listeners.controlchange({ message: { channel: 7, dataBytes: [39, 30] } });
    expect(retune).toHaveBeenCalledTimes(1);
    expect(Math.abs(retune.mock.calls.at(-1)[0] - coarseOnlyCents)).toBeLessThan(0.1);
  });

  it("can smooth accepted LinnStrument UF X input without timers", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const unsmoothedRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const unsmoothedKeys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 0,
        linnstrument_x_spike_reduction: 0,
        linnstrument_x_input_smoothing: 0,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune: unsmoothedRetune,
          aftertouch(value) {
            this._lastAftertouch = value;
          },
        })),
      },
    );

    unsmoothedKeys.midinoteOn(makeMidiEvent(1, 1));
    const unsmoothedBaseCents = unsmoothedKeys.state.activeMidi.get(1)?._baseCents ?? 0;
    listeners.keyaftertouch({ message: { channel: 1, dataBytes: [1, 18] } });
    listeners.controlchange({ message: { channel: 1, dataBytes: [33, 76] } });
    listeners.controlchange({ message: { channel: 1, dataBytes: [1, 1] } });
    const unsmoothedInitialCents = unsmoothedRetune.mock.calls.at(-1)[0];
    listeners.controlchange({ message: { channel: 1, dataBytes: [33, 16] } });
    const unsmoothedMovedCents = unsmoothedRetune.mock.calls.at(-1)[0];

    const smoothedListeners = {};
    const smoothedInput = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        smoothedListeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(smoothedInput);

    const smoothedRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const smoothedKeys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 0,
        linnstrument_x_spike_reduction: 0,
        linnstrument_x_input_smoothing: 100,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune: smoothedRetune,
          aftertouch(value) {
            this._lastAftertouch = value;
          },
        })),
      },
    );

    smoothedKeys.midinoteOn(makeMidiEvent(1, 1));
    const smoothedBaseCents = smoothedKeys.state.activeMidi.get(1)?._baseCents ?? 0;
    smoothedListeners.keyaftertouch({ message: { channel: 1, dataBytes: [1, 18] } });
    smoothedListeners.controlchange({ message: { channel: 1, dataBytes: [33, 76] } });
    smoothedListeners.controlchange({ message: { channel: 1, dataBytes: [1, 1] } });
    const smoothedInitialCents = smoothedRetune.mock.calls.at(-1)[0];
    smoothedListeners.controlchange({ message: { channel: 1, dataBytes: [33, 16] } });
    const smoothedMovedCents = smoothedRetune.mock.calls.at(-1)[0];

    expect(Math.abs(unsmoothedMovedCents - unsmoothedInitialCents)).toBeGreaterThan(0);
    expect(Math.abs(smoothedMovedCents - smoothedInitialCents)).toBeLessThan(
      Math.abs(unsmoothedMovedCents - unsmoothedInitialCents),
    );
    expect(Math.abs(smoothedMovedCents - smoothedBaseCents)).toBeLessThanOrEqual(
      Math.abs(unsmoothedMovedCents - unsmoothedBaseCents),
    );
  });

  it("widens the initial LinnStrument UF quantize window when X smoothing is active, then ramps bend back in", () => {
    const now = { value: 0 };
    vi.spyOn(performance, "now").mockImplementation(() => now.value);

    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 50,
        linnstrument_x_spike_reduction: 0,
        linnstrument_x_input_smoothing: 100,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune,
          aftertouch(value) {
            this._lastAftertouch = value;
          },
        })),
      },
    );

    keys.midinoteOn(makeMidiEvent(1, 1));
    const baseCents = keys.state.activeMidi.get(1)?._baseCents ?? 0;
    listeners.keyaftertouch({ message: { channel: 1, dataBytes: [1, 40] } });
    listeners.controlchange({ message: { channel: 1, dataBytes: [33, 112] } });
    listeners.controlchange({ message: { channel: 1, dataBytes: [1, 1] } });
    const attackCents = retune.mock.calls.at(-1)[0];

    now.value = 400;
    listeners.controlchange({ message: { channel: 1, dataBytes: [33, 112] } });
    const laterCents = retune.mock.calls.at(-1)[0];

    expect(Math.abs(attackCents - baseCents)).toBeLessThan(
      Math.abs(laterCents - baseCents),
    );
  });

  it("holds the last LinnStrument UF bent pitch through low-pressure release motion until note-off", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(function noteOff() {
          this.release = true;
        }),
        release: false,
        retune,
        aftertouch(value) {
          this._lastAftertouch = value;
        },
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(8, 4));
    listeners.keyaftertouch({ message: { channel: 4, dataBytes: [8, 30] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [40, 74] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [8, 10] } });
    expect(retune).toHaveBeenCalledTimes(1);
    const bentCents = retune.mock.calls.at(-1)[0];

    listeners.keyaftertouch({ message: { channel: 4, dataBytes: [8, 12] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [40, 56] } });

    expect(retune).toHaveBeenCalledTimes(1);
    expect(retune.mock.calls.at(-1)[0]).toBe(bentCents);
  });

  it("updates LinnStrument UF glide shape at runtime without rebuilding Keys", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function runtimeShapeRetune(newCents) {
      this.cents = newCents;
    });
    const keys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 0,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune,
        })),
      },
    );

    keys.midinoteOn(makeMidiEvent(1, 1));
    const lowShapeBaseCents = keys.state.activeMidi.get(1)?._baseCents ?? 0;
    listeners.controlchange({ message: { channel: 1, dataBytes: [33, 76] } });
    listeners.controlchange({ message: { channel: 1, dataBytes: [1, 0] } });
    const lowShapeCents = retune.mock.calls.at(-1)[0];

    keys.updateInputRuntime(keys.inputRuntime, {
      linnstrument_pitch_bend_shape: 100,
    });
    keys.midinoteOff(makeMidiEvent(1, 1));
    retune.mockClear();

    keys.midinoteOn(makeMidiEvent(1, 1));
    const highShapeBaseCents = keys.state.activeMidi.get(1)?._baseCents ?? 0;
    listeners.controlchange({ message: { channel: 1, dataBytes: [33, 76] } });
    listeners.controlchange({ message: { channel: 1, dataBytes: [1, 0] } });
    const highShapeCents = retune.mock.calls.at(-1)[0];

    expect(Math.abs(lowShapeCents - lowShapeBaseCents)).toBeGreaterThanOrEqual(
      Math.abs(highShapeCents - highShapeBaseCents),
    );
  });

  it("clears LinnStrument UF cached X state on note-off before a repeated press", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const retune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const synth = {
      makeHex: vi.fn((coords, cents) => ({
        coords,
        cents,
        _baseCents: cents,
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        release: false,
        retune,
      })),
    };

    createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
      },
      { layoutMode: "controller_geometry", wheelRange: "64/63" },
      synth,
    );

    listeners.noteon(makeMidiEvent(12, 4));
    listeners.controlchange({ message: { channel: 4, dataBytes: [44, 64] } });
    listeners.controlchange({ message: { channel: 4, dataBytes: [12, 12] } });
    expect(retune).toHaveBeenCalledTimes(1);

    listeners.noteoff(makeMidiEvent(12, 4));
    listeners.noteon(makeMidiEvent(12, 4));
    listeners.controlchange({ message: { channel: 4, dataBytes: [12, 12] } });

    expect(retune).toHaveBeenCalledTimes(1);
  });

  it("uses LinnStrument row glide shape to control the bend curve", () => {
    const listeners = {};
    const input = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        listeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(input);

    const lowShapeRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const highShapeRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });

    const lowShapeKeys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 0,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune: lowShapeRetune,
        })),
      },
    );

    lowShapeKeys.midinoteOn(makeMidiEvent(1, 1));
    const lowShapeBaseCents = lowShapeKeys.state.activeMidi.get(1)?._baseCents ?? 0;
    listeners.controlchange({ message: { channel: 1, dataBytes: [33, 76] } });
    listeners.controlchange({ message: { channel: 1, dataBytes: [1, 0] } });
    expect(lowShapeRetune).not.toHaveBeenCalledTimes(0);
    const lowShapeCents = lowShapeRetune.mock.calls.at(-1)[0];

    const highShapeListeners = {};
    const highShapeInput = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        highShapeListeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(highShapeInput);

    const highShapeKeys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 100,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune: highShapeRetune,
        })),
      },
    );

    highShapeKeys.midinoteOn(makeMidiEvent(1, 1));
    const highShapeBaseCents = highShapeKeys.state.activeMidi.get(1)?._baseCents ?? 0;
    highShapeListeners.controlchange({ message: { channel: 1, dataBytes: [33, 76] } });
    highShapeListeners.controlchange({ message: { channel: 1, dataBytes: [1, 0] } });
    expect(highShapeRetune).not.toHaveBeenCalledTimes(0);
    const highShapeCents = highShapeRetune.mock.calls.at(-1)[0];

    expect(Math.abs(lowShapeCents - lowShapeBaseCents)).toBeGreaterThanOrEqual(
      Math.abs(highShapeCents - highShapeBaseCents),
    );
  });

  it("extends LinnStrument UF edge glide toward virtual off-grid columns", () => {
    const leftListeners = {};
    const leftInput = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        leftListeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(leftInput);

    const leftRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const leftKeys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 0,
        linnstrument_x_spike_reduction: 0,
        linnstrument_x_input_smoothing: 0,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune: leftRetune,
        })),
      },
    );

    leftListeners.noteon(makeMidiEvent(1, 1));
    const leftBaseCents = leftKeys.state.activeMidi.get(1)?._baseCents ?? 0;
    leftListeners.controlchange({ message: { channel: 1, dataBytes: [33, 0] } });
    leftListeners.controlchange({ message: { channel: 1, dataBytes: [1, 0] } });
    const leftEdgeCents = leftRetune.mock.calls.at(-1)?.[0];

    expect(leftRetune).toHaveBeenCalledTimes(1);
    expect(leftEdgeCents).toBeLessThan(leftBaseCents);

    const rightListeners = {};
    const rightInput = {
      addListener: vi.fn((eventName, maybeOptions, maybeHandler) => {
        rightListeners[eventName] =
          typeof maybeOptions === "function" ? maybeOptions : maybeHandler;
      }),
      removeListener: vi.fn(),
      name: "Roger Linn Design LinnStrument 128",
    };
    vi.spyOn(WebMidi, "getInputById").mockReturnValue(rightInput);

    const rightRetune = vi.fn(function retune(newCents) {
      this.cents = newCents;
    });
    const rightKeys = createKeys(
      {
        midiin_device: "input-1",
        midiin_controller_override: "linnstrument",
        linnstrument_pitch_bend_mode: "follow_scale_geometry",
        linnstrument_pitch_bend_shape: 0,
        linnstrument_x_spike_reduction: 0,
        linnstrument_x_input_smoothing: 0,
      },
      { layoutMode: "controller_geometry", wheelRange: "2/1" },
      {
        makeHex: vi.fn((coords, cents) => ({
          coords,
          cents,
          _baseCents: cents,
          noteOn: vi.fn(),
          noteOff: vi.fn(),
          release: false,
          retune: rightRetune,
        })),
      },
    );

    rightListeners.noteon(makeMidiEvent(16, 1));
    const rightBaseCents = rightKeys.state.activeMidi.get(16)?._baseCents ?? 0;
    rightListeners.controlchange({ message: { channel: 1, dataBytes: [48, 39] } });
    rightListeners.controlchange({ message: { channel: 1, dataBytes: [16, 21] } });
    const rightEdgeCents = rightRetune.mock.calls.at(-1)?.[0];

    expect(rightRetune).toHaveBeenCalledTimes(1);
    expect(rightEdgeCents).toBeGreaterThan(rightBaseCents);
  });

  it("keeps sustained MIDI notes lit until sustain is released", () => {
    const keys = createKeys({}, { layoutMode: "sequential" });
    const hexNoteOff = vi.fn();
    const hexOn = vi.fn((coords) => ({
      coords,
      cents: 100,
      noteOff: hexNoteOff,
    }));
    const hexOff = vi.fn();

    keys.hexOn = hexOn;
    keys.hexOff = hexOff;
    keys.drawHex = vi.fn();

    keys.midinoteOn(makeMidiEvent(61));
    keys.sustainOn();
    keys.midinoteOff(makeMidiEvent(61, 1, 96, 55));

    expect(keys.state.activeMidi.size).toBe(0);
    expect(hexNoteOff).not.toHaveBeenCalled();
    expect(keys.state.sustainedNotes).toHaveLength(1);
    expect(hexOff).not.toHaveBeenCalled();

    keys.sustainOff();

    expect(hexNoteOff).toHaveBeenCalledWith(55);
    expect(keys.state.sustainedNotes).toHaveLength(0);
  });

  it("does not note-off MIDI-held notes when sustain is toggled off", () => {
    const keys = createKeys({ midi_velocity: 72 });
    const drawHex = vi.fn();
    const noteOff = vi.fn();
    const hex = {
      coords: new Point(0, 0),
      cents: 0,
      noteOff,
    };
    keys.drawHex = drawHex;
    keys.state.activeMidi.set(60, hex);
    keys.recencyStack.push(hex);
    keys.state.sustainedNotes.push([hex, 31]);
    keys.state.sustainedCoords.add("0,0");

    keys.sustainOff();

    expect(noteOff).not.toHaveBeenCalled();
    expect(keys.state.activeMidi.get(60)).toBe(hex);
    expect(keys.state.sustainedNotes).toHaveLength(0);
    expect(keys.recencyStack.front).toBe(hex);
    expect(drawHex).toHaveBeenCalled();
  });

  it("captures snapshot attack velocity from active hexes", () => {
    const keys = createKeys({ midi_velocity: 72 });
    keys.state.activeMidi.set(60, {
      coords: new Point(0, 0),
      cents: 0,
      velocity: 118,
      release: false,
    });

    const snapshot = keys.getSnapshot();

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      attackVelocity: 118,
      releaseVelocity: 118,
      velocity: 118,
    });
  });

  it("captures sustained snapshot release velocity separately from attack velocity", () => {
    const keys = createKeys({ midi_velocity: 72 });
    const hex = {
      coords: new Point(0, 0),
      cents: 0,
      velocity_played: 104,
      release: false,
    };
    keys.state.sustainedNotes.push([hex, 37]);

    const snapshot = keys.getSnapshot();

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      attackVelocity: 104,
      releaseVelocity: 37,
      velocity: 104,
    });
  });

  it("plays snapshots with captured attack velocity and stops with release velocity", () => {
    const noteOff = vi.fn();
    const synth = {
      makeHex: vi.fn(() => ({
        coords: new Point(9000, 9000),
        cents: 0,
        noteOn: vi.fn(),
        noteOff,
      })),
    };
    const keys = createKeys({}, {}, synth);

    keys.playSnapshot([{ midicents: 69, attackVelocity: 111, releaseVelocity: 39 }]);
    keys.stopSnapshot();

    expect(synth.makeHex.mock.calls[0][8]).toBe(111);
    expect(noteOff).toHaveBeenCalledWith(39);
  });

  it("keeps sounding static-bulk notes as the heard reference during immediate OCT", () => {
    const directOut = { id: "direct-out" };
    vi.spyOn(WebMidi, "getOutputById").mockReturnValue(directOut);

    const keys = createKeys({
      output_mts_bulk: true,
      mts_bulk_mode: "static",
      mts_bulk_device: "direct-out",
      mts_bulk_channel: 0,
    });
    const hex = {
      coords: new Point(1, 0),
      cents: 100,
      retune: vi.fn(),
      noteOff: vi.fn(),
      mts: [61, 61, 0, 0],
      _baseCents: 2500,
    };
    keys.state.activeMidi.set(61, hex);
    keys.mtsSendMap = vi.fn();

    keys.shiftOctave(1, false);

    expect(hex.retune).toHaveBeenCalledWith(3700);
    expect(hex._baseCents).toBe(3700);
    expect(keys.mtsSendMap).toHaveBeenCalledWith(directOut, false, false);
    expect(keys._deferredBulkMapRefresh).toBe(false);
  });

  it("sends a protected static bulk map immediately in deferred OCT mode", () => {
    const directOut = { id: "direct-out" };
    vi.spyOn(WebMidi, "getOutputById").mockReturnValue(directOut);

    const keys = createKeys({
      output_mts_bulk: true,
      mts_bulk_mode: "static",
      mts_bulk_device: "direct-out",
      mts_bulk_channel: 0,
    });
    const hex = {
      coords: new Point(1, 0),
      cents: 100,
      retune: vi.fn(),
      noteOff: vi.fn(),
      mts: [61, 61, 0, 0],
    };
    keys.state.activeMidi.set(61, hex);
    keys.mtsSendMap = vi.fn();

    keys.shiftOctave(1, true);

    expect(hex.retune).not.toHaveBeenCalled();
    expect(keys.mtsSendMap).toHaveBeenCalledWith(directOut, true, false);
    expect(keys._deferredBulkMapRefresh).toBe(false);

    keys.state.activeMidi.delete(61);
    keys.noteOff(hex, 64);

    expect(hex.noteOff).toHaveBeenCalledWith(64);
    expect(keys.mtsSendMap).toHaveBeenCalledTimes(1);
  });

  it("also resends the bulk map for dynamic MTS bulk octave shifts", () => {
    const directOut = { id: "direct-out" };
    vi.spyOn(WebMidi, "getOutputById").mockReturnValue(directOut);

    const keys = createKeys({
      output_mts_bulk: true,
      mts_bulk_mode: "dynamic",
      mts_bulk_device: "direct-out",
      mts_bulk_channel: 0,
    });
    keys.mtsSendMap = vi.fn();

    keys.shiftOctave(1, true);

    expect(keys.mtsSendMap).toHaveBeenCalledWith(directOut, false, true);
  });

  it("protects recently released dynamic MTS bulk notes from OCT bulk-map resends during release tails", () => {
    vi.useFakeTimers();
    const directOut = { id: "direct-out" };
    vi.spyOn(WebMidi, "getOutputById").mockReturnValue(directOut);

    const keys = createKeys({
      output_mts_bulk: true,
      mts_bulk_mode: "dynamic",
      mts_bulk_device: "direct-out",
      mts_bulk_channel: 0,
    });
    const hex = {
      coords: new Point(1, 0),
      cents: 100,
      retune: vi.fn(),
      noteOff: vi.fn(),
      mts: [61, 61, 0, 0],
    };
    keys.mtsSendMap = vi.fn();

    keys.noteOff(hex, 64);
    keys.shiftOctave(1, false);

    expect(keys.mtsSendMap).toHaveBeenCalledWith(directOut, true, true);

    keys.mtsSendMap.mockClear();
    vi.advanceTimersByTime(800);
    keys.shiftOctave(1, false);

    expect(keys.mtsSendMap).toHaveBeenCalledWith(directOut, false, true);
  });

  it("updates the wheel target base after immediate OCT so older sustained notes do not snap back", () => {
    const keys = createKeys();
    const oldHex = {
      coords: new Point(1, 0),
      cents: 2500,
      _baseCents: 2500,
      retune: vi.fn(),
      noteOff: vi.fn(),
      release: false,
    };
    const newHex = {
      coords: new Point(2, 0),
      cents: 100,
      retune: vi.fn(),
      noteOff: vi.fn(),
      release: false,
    };

    keys.state.sustainedNotes = [[oldHex, 0]];
    keys.recencyStack.push(oldHex);
    keys._wheelTarget = oldHex;
    keys._wheelBaseCents = 2500;

    keys.shiftOctave(1, false);
    expect(keys._wheelBaseCents).toBe(3700);

    oldHex.retune.mockClear();
    keys.recencyStack.push(newHex);
    keys._updateWheelTarget();

    expect(oldHex.retune).not.toHaveBeenCalled();
    expect(oldHex.cents).toBe(2500);
    expect(keys._wheelTarget).toBe(newHex);
  });

  it("keeps the previous recency target at its current bent pitch when a new note takes over", () => {
    const keys = createKeys({}, {
      wheelToRecent: true,
      pitchBendMode: "recency",
    });
    const oldHex = {
      coords: new Point(1, 0),
      cents: 1000,
      _baseCents: 1000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };
    const newHex = {
      coords: new Point(2, 0),
      cents: 2000,
      _baseCents: 2000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };

    keys.recencyStack.push(oldHex);
    keys._updateWheelTarget();
    keys._handleWheelBend(12000);
    const frozenBentPitch = oldHex.cents;

    oldHex.retune.mockClear();
    keys.recencyStack.push(newHex);
    keys._updateWheelTarget();

    expect(oldHex.retune).not.toHaveBeenCalled();
    expect(oldHex.cents).toBeCloseTo(frozenBentPitch, 5);
    expect(newHex.cents).toBeCloseTo(2000 + keys._wheelBend, 5);
  });

  it("reapplies recency wheel bend from the note base when an older note becomes front again", () => {
    const keys = createKeys({}, {
      wheelToRecent: true,
      pitchBendMode: "recency",
    });
    const oldHex = {
      coords: new Point(1, 0),
      cents: 1000,
      _baseCents: 1000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };
    const newHex = {
      coords: new Point(2, 0),
      cents: 2000,
      _baseCents: 2000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };

    keys.recencyStack.push(oldHex);
    keys._updateWheelTarget();
    keys._handleWheelBend(12000);
    const oldFrozenPitch = oldHex.cents;

    keys.recencyStack.push(newHex);
    keys._updateWheelTarget();
    keys._handleWheelBend(14000);
    const currentWheelBend = keys._wheelBend;

    oldHex.retune.mockClear();
    keys.recencyStack.remove(newHex);
    keys._updateWheelTarget();

    expect(oldHex.retune).toHaveBeenCalledTimes(1);
    expect(oldHex.cents).toBeCloseTo(1000 + currentWheelBend, 5);
    expect(oldHex.cents).not.toBeCloseTo(oldFrozenPitch + currentWheelBend, 5);
  });

  it("does not overwrite note base with an already-bent pitch when wheel is moved before note-on", () => {
    const keys = createKeys({}, {
      wheelToRecent: true,
      pitchBendMode: "recency",
    });
    const aHex = {
      coords: new Point(1, 0),
      cents: 1000,
      _baseCents: 1000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };
    const bHex = {
      coords: new Point(2, 0),
      cents: 2000,
      _baseCents: 2000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };
    const hexOn = vi
      .fn()
      .mockReturnValueOnce(aHex)
      .mockReturnValueOnce(bHex);
    keys.hexOn = hexOn;
    keys.hexOff = vi.fn();
    keys._wheelValue14 = 12000;
    keys._wheelBend = 0;

    keys.midinoteOn(makeMidiEvent(61));
    const aPitchAfterOnset = aHex.cents;
    expect(aHex._baseCents).toBe(1000);

    keys.midinoteOn(makeMidiEvent(62));
    keys.midinoteOff(makeMidiEvent(62));

    expect(aHex._baseCents).toBe(1000);
    expect(aHex.cents).toBeCloseTo(aPitchAfterOnset, 5);
  });

  it("glides the previous held note to the current wheel position when recency returns to it", () => {
    const keys = createKeys({}, {
      wheelToRecent: true,
      pitchBendMode: "recency",
    });
    const aHex = {
      coords: new Point(1, 0),
      cents: 1000,
      _baseCents: 1000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };
    const bHex = {
      coords: new Point(2, 0),
      cents: 2000,
      _baseCents: 2000,
      retune: vi.fn(function (newCents) {
        this.cents = newCents;
      }),
      noteOff: vi.fn(),
      release: false,
    };

    keys.recencyStack.push(aHex);
    keys.recencyStack.push(bHex);
    keys._wheelTarget = bHex;
    keys._wheelValue14 = 12000;

    const queueSpy = vi.spyOn(keys, "_queueRetuneGlide");
    const kickSpy = vi.spyOn(keys, "_kickRetuneGlides");

    keys.recencyStack.remove(bHex);
    keys._updateWheelTarget(true);

    expect(queueSpy).toHaveBeenCalledWith(aHex, 1000, true);
    expect(kickSpy).toHaveBeenCalled();
    expect(aHex.retune).not.toHaveBeenCalled();
  });

  it("keeps the main MTS output on real-time transport even if sysex_type is stale at 126", () => {
    const output = {
      id: "mts-out",
      sendSysex: vi.fn(),
      send: vi.fn(),
    };
    vi.spyOn(WebMidi, "getOutputById").mockReturnValue(output);

    const keys = createKeys({
      output_mts: true,
      sysex_auto: false,
      midi_device: "mts-out",
      midi_channel: 0,
      midi_mapping: "MTS1",
      sysex_type: 126,
    });
    keys.midiout_data = output;

    keys.mtsSendMap();

    expect(output.sendSysex).toHaveBeenCalledTimes(128);
    expect(output.send).not.toHaveBeenCalled();
  });
});
