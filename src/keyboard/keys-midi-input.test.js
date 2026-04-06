import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Keys from "./keys.js";
import Point from "./point.js";

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

function createKeys(settingsOverrides = {}, inputRuntimeOverrides = {}) {
  const canvas = makeCanvas();
  const keys = new Keys(
    canvas,
    makeSettings(settingsOverrides),
    {},
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
});
