/**
 * Tests for src/app.jsx
 *
 * The App component has deep dependencies (WebMidi, AudioContext, canvas,
 * SVG imports) that make full integration testing expensive. These tests
 * cover what can be verified without a real browser environment:
 *
 * - The Loading spinner component renders
 * - The useQuery extractors used by App work correctly (covered in use-query.test.js)
 *
 * Broader App rendering tests (settings panel toggle, keyboard visibility)
 * require a more complete browser mock and are left as todos for future work.
 */

import { render, waitFor, screen } from "@testing-library/preact";

vi.mock("./keyboard", () => ({
  default: () => <div data-testid="keyboard">Keyboard Stub</div>,
}));
vi.mock("./settings", () => ({
  default: () => <div data-testid="settings">Settings Stub</div>,
}));
vi.mock("./blurb", () => ({
  default: () => <div>Blurb Stub</div>,
}));
vi.mock("./settings/preset_values", () => ({ presets: [] }));
vi.mock("./sample_synth/instruments", () => ({ instruments: [] }));
vi.mock("./settings/keycodes", () => ({ default: {} }));
vi.mock("./normalize-settings.js", () => ({
  normalizeColors: (s) => s,
  normalizeStructural: (s) => s,
}));

const synthWiringState = {
  synth: null,
  midi: null,
  midiAccess: "none",
  midiAccessError: null,
  ensureMidiAccess: vi.fn(),
  midiTick: 0,
  loading: 0,
  midiLearnActive: false,
  setMidiLearnActive: vi.fn(),
  octaveTranspose: 0,
  setOctaveTranspose: vi.fn(),
  octaveDeferred: false,
  shiftOctave: vi.fn(),
  toggleOctaveDeferred: vi.fn(),
  onVolumeChange: vi.fn(),
  onAnchorLearn: vi.fn(),
  lumatoneRawPorts: null,
  exquisRawPorts: null,
};

const settings = {
  rSteps: 1,
  drSteps: 5,
  hexSize: 60,
  rotation: 0,
  scale: ["100.", "200.", "1200."],
  equivSteps: 3,
  note_names: ["A", "B", "C"],
  note_colors: ["#ffffff", "#eeeeee", "#dddddd"],
  key_labels: "no_labels",
  spectrum_colors: false,
  fundamental_color: "#ffffff",
  reference_degree: 0,
  center_degree: 0,
  fundamental: 440,
  instrument: "OFF",
  output_sample: false,
  output_mts: false,
  output_mpe: false,
  output_direct: false,
  output_osc: false,
  midiin_device: "OFF",
  midiin_controller_override: "auto",
  midiin_mapping_target: "hex_layout",
  midiin_anchor_channel: 1,
  midiin_central_degree: 60,
  midiin_channel_group_size: 1,
  midiin_channel_legacy: false,
  midiin_scale_tolerance: 25,
  midiin_scale_fallback: "accept",
  midiin_pitchbend_mode: "recency",
  midiin_pressure_mode: "recency",
  wheel_to_recent: false,
  midiin_bend_range: "64/63",
  wheel_scale_aware: false,
  midi_wheel_semitones: 2,
  midiin_bend_flip: false,
  midiin_scale_bend_range: 48,
  midi_passthrough: false,
  midiin_mpe_input: false,
  midiin_steps_per_channel: 0,
  lumatone_center_channel: 1,
  lumatone_center_note: 60,
};

vi.mock("./use-query", () => ({
  useQuery: () => [settings, vi.fn()],
  ExtractInt: {},
  ExtractString: {},
  ExtractFloat: {},
  ExtractBool: {},
  ExtractJoinedString: {},
}));
vi.mock("./use-presets.js", () => ({
  default: () => ({
    activeSource: "",
    activePresetName: "",
    isPresetDirty: false,
    persistOnReload: false,
    setPersistOnReload: vi.fn(),
    presetChanged: vi.fn(),
    onLoadCustomPreset: vi.fn(),
    onClearUserPresets: vi.fn(),
    onRevertBuiltin: vi.fn(),
    onRevertUser: vi.fn(),
    onUserScaleEdit: vi.fn(),
  }),
  SCALE_KEYS_TO_CLEAR: [],
}));
vi.mock("./use-import.js", () => ({
  default: () => ({
    onImport: vi.fn(),
    importCount: 0,
    bumpImportCount: vi.fn(),
  }),
}));
vi.mock("./use-settings-change.js", () => ({
  default: () => ({
    onChange: vi.fn(),
    onAtomicChange: vi.fn(),
  }),
}));
vi.mock("./use-synth-wiring.js", () => ({
  default: () => synthWiringState,
}));
vi.mock("./use-midi-guardian.js", () => ({
  useMidiGuardian: () => ({ panic: vi.fn() }),
}));
vi.mock("./persistence/settings-registry.js", () => ({
  buildQuerySpec: () => ({}),
  buildRegistryDefaults: () => ({}),
  PRESET_SKIP_KEYS: [],
}));
vi.mock("./session-defaults.js", () => ({ default: {} }));
vi.mock("./controllers/exquis-leds.js", () => ({ ExquisLEDs: class {} }));
vi.mock("./controllers/lumatone-leds.js", () => ({ LumatoneLEDs: class {} }));
vi.mock("./controllers/registry.js", () => ({
  detectController: () => null,
  getControllerById: () => null,
}));

// ── Loading spinner ───────────────────────────────────────────────────────────
// Loading is a trivially simple named export — just verify it renders without
// throwing. The SVG content is mocked by the asset stub.

vi.mock("./img/hex.svg?react", () => ({
  default: () => <svg data-testid="loading-icon" />,
}));

import { Loading } from "./app";
import App from "./app";

describe("Loading", () => {
  it("renders without crashing", () => {
    const { container } = render(<Loading />);
    expect(container).not.toBeNull();
  });

  it("renders the loading icon SVG", () => {
    const { getByTestId } = render(<Loading />);
    expect(getByTestId("loading-icon")).not.toBeNull();
  });
});

// ── Full App rendering ────────────────────────────────────────────────────────
// Skipped: requires WebMidi, AudioContext, canvas and localStorage all stubbed.
// The original Enzyme tests for App were also mostly commented out for the
// same reason. Revisit once a more complete jsdom + WebMidi mock is in place.

describe.todo("App — settings panel toggle");
describe.todo("App — keyboard active/inactive state");
describe.todo("App — preset loading");

describe("App keyboard lifecycle", () => {
  beforeEach(() => {
    synthWiringState.loading = 0;
    synthWiringState.midiAccess = "none";
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it("keeps the keyboard mounted while loading is nonzero", async () => {
    const { rerender } = render(<App />);
    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());

    synthWiringState.loading = 1;
    rerender(<App />);

    expect(screen.getByTestId("keyboard")).not.toBeNull();
    expect(screen.getByTestId("loading-icon")).not.toBeNull();
  });

  it("keeps the keyboard mounted when midi access upgrades to sysex", async () => {
    const { rerender } = render(<App />);
    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());

    synthWiringState.midiAccess = "basic";
    rerender(<App />);
    expect(screen.getByTestId("keyboard")).not.toBeNull();

    synthWiringState.midiAccess = "sysex";
    synthWiringState.loading = 1;
    rerender(<App />);

    expect(screen.getByTestId("keyboard")).not.toBeNull();
    expect(screen.getByTestId("loading-icon")).not.toBeNull();
  });
});
