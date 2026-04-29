import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Keys from "./keys.js";
import Point from "./point.js";
import { WebMidi } from "webmidi";

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
    midiin_channel: -1,
    midiin_central_degree: 60,
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

function createKeys(settingsOverrides = {}, inputRuntimeOverrides = {}, synth = {}) {
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
      wheelScaleAware: false,
      wheelSemitones: 2,
      bendRange: "64/63",
      bendFlip: false,
      ...inputRuntimeOverrides,
    },
    null,
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
    expect(keys.getModulationState().sourceDegree).toBe(0);
    expect(onModulationArmChange).toHaveBeenCalledWith(true);
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
      { mpeInput: true },
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

    const sourceEntry = { hex: sourceHex, baseCents: sourceHex._baseCents };
    const targetEntry = { hex: targetHex, baseCents: targetHex._baseCents };
    keys._applyMpePitchBend(targetEntry, 3, 9000);
    expect(sourceRetune).not.toHaveBeenCalled();

    keys._applyMpePitchBend(sourceEntry, 2, 11000);
    expect(sourceRetune).toHaveBeenCalledTimes(1);

    keys._applyMpePitchBend(targetEntry, 3, 4096);
    expect(sourceRetune).toHaveBeenCalledTimes(2);

    keys._applyMpePitchBend(sourceEntry, 2, 16383);
    expect(sourceRetune).toHaveBeenCalledTimes(2);

    keys._applyMpePitchBend(targetEntry, 3, 8192);
    expect(sourceRetune).toHaveBeenCalledTimes(3);
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

  it("treats source-to-same-target modulation as a no-op", () => {
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
    keys.hexOn(new Point(0, 0));

    expect(keys.getModulationState().mode).toBe("idle");
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
          midiin_channel: 0,
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
    keys.coordResolver.bestVisibleCoord = vi.fn(() => new Point(4, 0));

    keys.midinoteOn(makeMidiEvent(60, 9));

    expect(keys.controller.resolveScaleInputPitchCents).toHaveBeenCalledWith(9, 60, keys.settings);
    expect(keys.coordResolver.bestVisibleCoord).toHaveBeenCalledWith(1);
    expect(hexOn).toHaveBeenCalledWith(
      new Point(4, 0),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("groups sequential channel transposition by channel pairs when configured", () => {
    const keys = createKeys(
      { midiin_central_degree: 60, equivSteps: 12 },
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
      midiin_channel: 0,
      midiin_controller_override: "tonalplexus",
      lumatone_center_channel: 9,
      lumatone_center_note: 7,
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

  it("applies channel offsets for generic keyboard step arithmetic without a controller map", () => {
    const keys = createKeys(
      {
        midiin_central_degree: 60,
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

  it("applies standard wheel bend immediately without slew when wheel-to-recent is off", () => {
    const keys = createKeys({}, {
      wheelToRecent: false,
    });
    const handleSpy = vi.spyOn(keys, "_handleWheelBend");
    const slewSpy = vi.spyOn(keys, "_setWheelSlewTarget");

    keys._handleIncomingWheelBend(12000);

    expect(handleSpy).toHaveBeenCalledWith(12000);
    expect(slewSpy).not.toHaveBeenCalled();
  });

  it("applies wheel-to-recent bend immediately without rAF slew", () => {
    const keys = createKeys({}, {
      wheelToRecent: true,
      pitchBendMode: "recency",
    });
    const handleSpy = vi.spyOn(keys, "_handleWheelBend");
    const slewSpy = vi.spyOn(keys, "_setWheelSlewTarget");
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    keys._wheelValue14 = 8192;
    keys._handleIncomingWheelBend(12000);

    expect(handleSpy).toHaveBeenCalledWith(12000);
    expect(slewSpy).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(keys._wheelSlew.current).toBe(12000);
    expect(keys._wheelSlew.target).toBe(12000);
  });

  it("does not directly retune non-sample hexes in standard wheel mode", () => {
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
    expect(mpeLikeHex.retune).not.toHaveBeenCalled();
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
        midiin_channel: 0,
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
