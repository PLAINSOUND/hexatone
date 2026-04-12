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
  };

  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => context,
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
    midiin_channel: -1,
    midiin_central_degree: 60,
    midi_mapping: "DIRECT",
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

function createKeys(settingsOverrides = {}, inputRuntimeOverrides = {}, synth = {}) {
  const canvas = makeCanvas();
  const keys = new Keys(
    canvas,
    makeSettings(settingsOverrides),
    synth,
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
    vi.restoreAllMocks();
    drawGridSpy.mockRestore();
  });

  it("maps generic keyboard input through step arithmetic", () => {
    const keys = createKeys(
      {},
      { layoutMode: "sequential" },
    );
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

  it("uses controller-provided scale pitch cents in nearest-scale mode", () => {
    const keys = createKeys(
      {},
      { target: "scale" },
    );
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
    expect(hexOn).toHaveBeenCalledWith(new Point(4, 0), expect.any(Number), expect.any(Number), expect.any(Number));
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
    vi.spyOn(WebMidi, "getInputById").mockReturnValue({ name: "USB MIDI Interface", addListener: vi.fn() });
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

  it("uses the configured standard wheel semitone range when wheel-to-recent is off", () => {
    const standardWheelRetuneA = vi.fn();
    const standardWheelRetuneB = vi.fn();
    const keys = createKeys({}, {
      wheelToRecent: false,
      wheelSemitones: 12,
    });
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

  it("does not directly retune non-sample hexes in standard wheel mode", () => {
    const standardWheelRetune = vi.fn();
    const retune = vi.fn();
    const keys = createKeys({}, {
      wheelToRecent: false,
      wheelSemitones: 2,
    });
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

  it("keeps sustained MIDI notes lit until sustain is released", () => {
    const keys = createKeys(
      {},
      { layoutMode: "sequential" },
    );
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
      output_direct: true,
      direct_mode: "static",
      direct_device: "direct-out",
      direct_channel: 0,
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
      output_direct: true,
      direct_mode: "static",
      direct_device: "direct-out",
      direct_channel: 0,
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

  it("also resends the bulk map for dynamic DIRECT octave shifts", () => {
    const directOut = { id: "direct-out" };
    vi.spyOn(WebMidi, "getOutputById").mockReturnValue(directOut);

    const keys = createKeys({
      output_direct: true,
      direct_mode: "dynamic",
      direct_device: "direct-out",
      direct_channel: 0,
    });
    keys.mtsSendMap = vi.fn();

    keys.shiftOctave(1, true);

    expect(keys.mtsSendMap).toHaveBeenCalledWith(directOut, false, true);
  });

  it("protects recently released dynamic DIRECT notes from OCT bulk-map resends during release tails", () => {
    vi.useFakeTimers();
    const directOut = { id: "direct-out" };
    vi.spyOn(WebMidi, "getOutputById").mockReturnValue(directOut);

    const keys = createKeys({
      output_direct: true,
      direct_mode: "dynamic",
      direct_device: "direct-out",
      direct_channel: 0,
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

    expect(oldHex.retune).toHaveBeenCalledWith(3700);
    expect(keys._wheelTarget).toBe(newHex);
  });
});
