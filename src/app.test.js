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

import { fireEvent, render, waitFor, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { act } from "preact/test-utils";
import { parseExactInterval } from "./tuning/interval.js";
import { SEQUENCE_WORKSPACE_STORAGE_KEY } from "./sequencer/session-persistence.js";
import { CALCULATOR_WORKSPACE_STORAGE_KEY } from "./calculator/session-persistence.js";

let lastKeyboardProps = null;
let lastUsePresetsOptions = null;
let mockDetectedController = null;
let mockControllerById = null;
const { guardianPanicMock } = vi.hoisted(() => ({ guardianPanicMock: vi.fn() }));

vi.mock("normalize.css", () => ({}));
vi.mock("./hex-style.css", () => ({}));
vi.mock("./loader.css", () => ({}));

vi.mock("./keyboard", () => ({
  default: (props) => {
    lastKeyboardProps = props;
    return <div data-testid="keyboard">Keyboard Stub</div>;
  },
}));
vi.mock("./settings", () => ({
  default: () => <div data-testid="settings">Settings Stub</div>,
}));
vi.mock("./settings/io-settings.jsx", () => ({
  default: () => <div data-testid="io-settings">I/O Settings Stub</div>,
}));
vi.mock("./credits", () => ({
  default: () => <div>Credits Stub</div>,
}));
vi.mock("./manual/manual-sidebar.jsx", () => ({
  default: ({ initialSectionTitle, onSectionChange, onClose }) => (
    <div data-testid="manual-sidebar" data-initial-section-title={initialSectionTitle}>
      Manual Stub
      <button type="button" onClick={() => onSectionChange?.("Quick Start")}>
        Select Quick Start
      </button>
      {onClose ? (
        <button type="button" onClick={onClose}>
          Close contextual manual
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("./sample_synth/instruments", () => ({ instruments: [] }));
vi.mock("./keyboard/keycodes", () => ({ default: {} }));
vi.mock("./settings/normalize-settings.js", () => ({
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
  linnstrumentRawPorts: null,
  hakenRawPorts: null,
};

let settings = {
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
  output_mts_bulk: false,
  output_osc: false,
  midiin_device: "OFF",
  midiin_controller_override: "auto",
  midiin_mapping_target: "hex_layout",
  midiin_anchor_channel: 1,
  midiin_anchor_note: 60,
  midiin_channel_group_size: 1,
  midiin_channel_legacy: false,
  midiin_scale_tolerance: 25,
  midiin_scale_fallback: "accept",
  midiin_pitchbend_mode: "recency",
  midiin_pressure_mode: "recency",
  wheel_to_recent: false,
  midiin_bend_range: "28/27",
  wheel_scale_aware: false,
  midi_wheel_semitones: 2,
  midiin_bend_flip: false,
  midiin_scale_bend_range: 48,
  midi_passthrough: false,
  midiin_mpe_input: false,
  midiin_steps_per_channel: 0,
};

vi.mock("./hooks/use-query", () => ({
  useQuery: () => [settings, vi.fn()],
  ExtractInt: {},
  ExtractString: {},
  ExtractFloat: {},
  ExtractBool: {},
  ExtractJoinedString: {},
}));
vi.mock("./hooks/use-presets.js", () => ({
  default: (_settings, _setSettings, options) => {
    lastUsePresetsOptions = options;
    return {
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
    };
  },
  SCALE_KEYS_TO_CLEAR: [],
}));
vi.mock("./hooks/use-import.js", () => ({
  default: () => ({
    onImport: vi.fn(),
    importCount: 0,
    bumpImportCount: vi.fn(),
  }),
}));
vi.mock("./hooks/use-settings-change.js", () => ({
  default: () => ({
    onChange: vi.fn(),
    onAtomicChange: vi.fn(),
  }),
}));
vi.mock("./hooks/use-synth-wiring.js", () => ({
  default: () => synthWiringState,
}));
vi.mock("./hooks/use-midi-guardian.js", () => ({
  useMidiGuardian: () => ({ panic: guardianPanicMock }),
}));
vi.mock("./persistence/settings-registry.js", () => ({
  buildQuerySpec: () => ({}),
  buildRegistryDefaults: () => ({}),
  PRESET_SKIP_KEYS: [],
}));
vi.mock("./settings/session-defaults.js", () => ({ default: {} }));
vi.mock("./controllers/exquis-leds.js", () => ({ ExquisLEDs: class {} }));
vi.mock("./controllers/lumatone-leds.js", () => ({ LumatoneLEDs: class {} }));
vi.mock("./controllers/linnstrument-user-firmware.js", () => ({
  attachLinnstrumentLedDriver: vi.fn(() => ({ userFirmwareActive: false })),
  activateLinnstrumentUserFirmware: vi.fn(),
  deactivateLinnstrumentUserFirmware: vi.fn(),
  detachLinnstrumentLedDriver: vi.fn(),
}));
vi.mock("./controllers/registry.js", () => ({
  detectController: () => mockDetectedController,
  getControllerById: () => mockControllerById,
  getControllerMpeInputPolicy: (controller) => controller?.mpeInputPolicy ?? "never",
  controllerRequiresMpeInput: (controller) => controller?.mpeInputPolicy === "always",
}));

// ── Loading spinner ───────────────────────────────────────────────────────────
// Loading is a trivially simple named export — just verify it renders without
// throwing. The SVG content is mocked by the asset stub.

vi.mock("./loading-icon.jsx", () => ({
  default: () => <svg data-testid="loading-icon" />,
}));

import {
  applyReloadPersistencePolicy,
  autoSyncLumatoneSurface,
  bindControllerLedRefs,
  commitModulationHistoryToPreset,
  getDefaultSnapshotPalettePos,
  loadReloadWorkspaceTab,
  Loading,
  modulationCurrentSummaryDisplay,
  modulationRouteLabelPair,
  RELOAD_WORKSPACE_TAB_KEY,
  saveReloadWorkspaceTab,
  sendLumatoneColorsNow,
} from "./app";
import App from "./app";
import {
  attachLinnstrumentLedDriver,
  deactivateLinnstrumentUserFirmware,
} from "./controllers/linnstrument-user-firmware.js";

describe("floating palette placement", () => {
  it("uses the snapshot palette width beside a wide auxiliary sidebar", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const sidebar = document.createElement("nav");
    sidebar.id = "sidebar";
    sidebar.getBoundingClientRect = () => ({
      bottom: 700,
      height: 700,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const snapshot = document.createElement("div");
    snapshot.id = "snapshot-palette";
    snapshot.getBoundingClientRect = () => ({
      bottom: 500,
      height: 280,
      left: 18,
      right: 178,
      top: 220,
      width: 160,
      x: 18,
      y: 220,
      toJSON: () => ({}),
    });
    document.body.append(sidebar, snapshot);

    expect(getDefaultSnapshotPalettePos()).toEqual({ x: 616, y: 234 });

    sidebar.remove();
    snapshot.remove();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
  });
});

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

describe("applyReloadPersistencePolicy", () => {
  it("clears the query string on reload when restore-on-reload is disabled", () => {
    history.replaceState({}, "", "http://localhost/?scale=3/2,2/1&instrument=WMRIByzantineST");
    sessionStorage.setItem(
      SEQUENCE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({ snapshots: [{ id: 1 }] }),
    );
    sessionStorage.setItem(CALCULATOR_WORKSPACE_STORAGE_KEY, JSON.stringify({ state: {} }));

    applyReloadPersistencePolicy({ navigationType: "reload", shouldPersist: false });

    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem(SEQUENCE_WORKSPACE_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CALCULATOR_WORKSPACE_STORAGE_KEY)).toBeNull();
  });

  it("keeps the visible Sequencer or Calculator tab independent of preset restoration", () => {
    sessionStorage.setItem(RELOAD_WORKSPACE_TAB_KEY, "calculator");

    applyReloadPersistencePolicy({ navigationType: "reload", shouldPersist: false });

    expect(sessionStorage.getItem(RELOAD_WORKSPACE_TAB_KEY)).toBe("calculator");
  });

  it("keeps the query string on reload when restore-on-reload is enabled", () => {
    history.replaceState({}, "", "http://localhost/?scale=3/2,2/1&instrument=WMRIByzantineST");

    applyReloadPersistencePolicy({ navigationType: "reload", shouldPersist: true });

    expect(window.location.search).toBe("?scale=3/2,2/1&instrument=WMRIByzantineST");
  });
});

describe("reload workspace tab", () => {
  beforeEach(() => {
    sessionStorage.removeItem(RELOAD_WORKSPACE_TAB_KEY);
  });

  it.each(["sequencer", "calculator"])("restores the %s workspace", (workspaceTab) => {
    saveReloadWorkspaceTab(workspaceTab);

    expect(loadReloadWorkspaceTab()).toBe(workspaceTab);
  });

  it.each(["hexatone", "io", "manual"])(
    "returns to Hexatone after leaving the %s workspace active",
    (workspaceTab) => {
      sessionStorage.setItem(RELOAD_WORKSPACE_TAB_KEY, "sequencer");

      saveReloadWorkspaceTab(workspaceTab);

      expect(loadReloadWorkspaceTab()).toBe("hexatone");
      expect(sessionStorage.getItem(RELOAD_WORKSPACE_TAB_KEY)).toBeNull();
    },
  );

  it("falls back to Hexatone when stored navigation state is invalid", () => {
    sessionStorage.setItem(RELOAD_WORKSPACE_TAB_KEY, "unknown");

    expect(loadReloadWorkspaceTab()).toBe("hexatone");
  });
});

beforeEach(() => {
  sessionStorage.removeItem(RELOAD_WORKSPACE_TAB_KEY);
  sessionStorage.removeItem(CALCULATOR_WORKSPACE_STORAGE_KEY);
  lastKeyboardProps = null;
  lastUsePresetsOptions = null;
  mockDetectedController = null;
  mockControllerById = null;
  synthWiringState.linnstrumentRawPorts = null;
  synthWiringState.hakenRawPorts = null;
  settings = {
    ...settings,
    midiin_mpe_manager_ch: undefined,
  };
  vi.clearAllMocks();
});

describe("Haken Continuum config", () => {
  it("sends the Continuum MPE+ setup burst when a Haken output is available", async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const output = {
      id: "haken-out-1",
      sendControlChange: vi.fn(),
    };
    synthWiringState.hakenRawPorts = {
      input: { id: "haken-in-1" },
      output,
    };
    settings = {
      ...settings,
      midiin_mpe_manager_ch: 3,
    };

    render(<App />);

    await waitFor(() => {
      expect(output.sendControlChange).toHaveBeenCalled();
    });

    expect(output.sendControlChange).toHaveBeenCalledWith(101, 0, { channels: 3 });
    expect(output.sendControlChange).toHaveBeenCalledWith(100, 0, { channels: 3 });
    expect(output.sendControlChange).toHaveBeenCalledWith(6, 96, { channels: 3 });
    expect(output.sendControlChange).toHaveBeenCalledWith(38, 0, { channels: 3 });
    expect(output.sendControlChange).toHaveBeenCalledWith(101, 127, { channels: 3 });
    expect(output.sendControlChange).toHaveBeenCalledWith(100, 127, { channels: 3 });
  });
});

describe("preset runtime reset wiring", () => {
  it("changes the keyboard reconstruction key only when the sidebar preset refresh path requests it", async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    render(<App />);

    await waitFor(() => {
      expect(lastKeyboardProps).not.toBeNull();
      expect(lastUsePresetsOptions?.bumpPresetRuntimeReset).toBeTypeOf("function");
    });

    const initialReconstructionKey = lastKeyboardProps.reconstructionKey;

    await act(async () => {
      lastUsePresetsOptions.bumpPresetRuntimeReset();
    });

    await waitFor(() => {
      expect(lastKeyboardProps.reconstructionKey).not.toBe(initialReconstructionKey);
    });
  });
});

describe("sequence-only playback surface", () => {
  it("mounts a hidden playback runtime when a sequence is loaded without a Hexatone scale", async () => {
    const previousSettings = settings;
    settings = {
      ...settings,
      scale: null,
      note_names: null,
      note_colors: null,
    };
    localStorage.setItem("hexatone_persist_on_reload", "true");
    sessionStorage.setItem(
      SEQUENCE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        snapshots: [
          {
            id: 1,
            length: 1,
            notes: [{ id: "note-1", midicents: 69, attackVelocity: 72 }],
          },
        ],
        bars: [],
        tempi: [],
        repeats: [],
      }),
    );

    const { unmount } = render(<App />);

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    expect(lastKeyboardProps.hidden).toBe(true);
    expect(lastKeyboardProps.settings.scale).toEqual([0]);
    expect(lastKeyboardProps.tuningRuntime).toMatchObject({
      scale: [0],
      equivSteps: 1,
      degree0toRefAsArray: [0, 1],
    });

    unmount();
    settings = previousSettings;
    localStorage.removeItem("hexatone_persist_on_reload");
    sessionStorage.removeItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
  });
});

describe("modulationRouteLabelPair", () => {
  it("renders an equave offset for an octave-displaced target ratio", () => {
    const pair = modulationRouteLabelPair(
      {
        sourceDegree: 0,
        targetDegree: 6,
        transpositionRatioText: "8/7",
      },
      (degree) => (degree === 0 ? "1/1" : degree === 6 ? "7/4" : String(degree)),
      {
        baseScale: {
          equaveCents: 1200,
        },
        lookup: {
          byDegree: new Map([
            [0, { cents: parseExactInterval("1/1").cents }],
            [6, { cents: parseExactInterval("7/4").cents }],
          ]),
        },
      },
    );

    expect(pair).toEqual({
      sourceLabel: "1/1",
      targetLabel: "7/4[-1eq]",
    });
  });
});

describe("commitModulationHistoryToPreset", () => {
  it("rewrites the current modulation into a new exact scale and clears history", async () => {
    const { createScaleWorkspace } = await import("./tuning/workspace.js");
    const workspace = createScaleWorkspace({
      scale: ["9/8", "5/4", "4/3", "2/1"],
      fundamental: 440,
      reference_degree: 0,
    });

    const committed = commitModulationHistoryToPreset(
      {
        scale: ["9/8", "5/4", "4/3", "2/1"],
        note_names: ["1/1", "9/8", "5/4", "4/3"],
        note_colors: ["#111111", "#222222", "#333333", "#444444"],
        key_labels: "note_names",
        fundamental: 440,
        reference_degree: 0,
      },
      workspace,
      [
        {
          sourceDegree: 0,
          targetDegree: 2,
          count: 1,
          transpositionDeltaCents: -parseExactInterval("5/4").cents,
          transpositionRatioText: "4/5",
        },
      ],
      {
        hejiAnchorLabel: "A",
        hejiAnchorRatio: "1/1",
      },
    );

    expect(committed.scale).toEqual(["16/15", "8/5", "9/5", "2/1"]);
    expect(committed.note_names).toEqual(["5/4", "4/3", "1/1", "9/8"]);
    expect(committed.note_colors).toEqual(["#111111", "#222222", "#333333", "#444444"]);
    expect(committed.fundamental).toBeCloseTo(440 / 1.25, 6);
    expect(committed.reference_degree).toBe(0);
    expect(committed.heji_anchor_ratio).toBe("1/1");
  });
});

describe("modulationCurrentSummaryDisplay", () => {
  it("renders the actual current monzo without equave-offset suffixes", () => {
    expect(
      modulationCurrentSummaryDisplay({
        ratioText: "7/8",
        cents: parseExactInterval("7/8").cents,
      }),
    ).toBe("[-3 0 0 1> (-231¢)");
  });

  it("renders cents only when the current ratio is not exact", () => {
    expect(
      modulationCurrentSummaryDisplay({
        ratioText: null,
        cents: 12.345,
      }),
    ).toBe("+12¢");
  });
});

describe("legacy modulation row interval fallback", () => {
  it("can derive an exact row monzo from workspace ratios when ratio text was not stored", async () => {
    const { createScaleWorkspace } = await import("./tuning/workspace.js");
    const workspace = createScaleWorkspace({
      scale: ["9/8", "5/4", "4/3", "2/1"],
      fundamental: 440,
      reference_degree: 0,
    });

    const committed = commitModulationHistoryToPreset(
      {
        scale: ["9/8", "5/4", "4/3", "2/1"],
        note_names: ["1/1", "9/8", "5/4", "4/3"],
        note_colors: ["#111111", "#222222", "#333333", "#444444"],
        key_labels: "note_names",
        fundamental: 440,
        reference_degree: 0,
      },
      workspace,
      [
        {
          sourceDegree: 0,
          targetDegree: 2,
          count: 1,
          transpositionDeltaCents: -parseExactInterval("5/4").cents,
        },
      ],
      {
        hejiAnchorLabel: "A",
        hejiAnchorRatio: "1/1",
      },
    );

    expect(committed.scale).toEqual(["16/15", "8/5", "9/5", "2/1"]);
  });
});

describe("bindControllerLedRefs", () => {
  it("attaches a Lumatone driver and triggers auto-sync when enabled", () => {
    const keys = {
      settings: { lumatone_led_sync: true },
      autoSyncLumatoneLEDs: vi.fn(),
    };
    const leds = { id: "lumatone-leds" };

    bindControllerLedRefs(keys, { lumatone: leds });

    expect(keys.lumatoneLEDs).toBe(leds);
    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("attaches a ready Exquis driver and triggers sync when enabled", () => {
    const keys = {
      settings: { exquis_led_sync: true },
      syncExquisLEDs: vi.fn(),
    };
    const leds = { ready: true };

    bindControllerLedRefs(keys, { exquis: leds });

    expect(keys.exquisLEDs).toBe(leds);
    expect(keys.syncExquisLEDs).toHaveBeenCalledTimes(1);
  });

  it("attaches a LinnStrument driver without triggering an eager sync", () => {
    const keys = {
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };
    const leds = { id: "linn-leds" };

    bindControllerLedRefs(keys, { linnstrument: leds });

    expect(keys.linnstrumentLEDs).toBe(leds);
    expect(keys.syncLinnstrumentLEDs).not.toHaveBeenCalled();
  });

  it("clears individual bindings without touching the others", () => {
    const keys = {
      settings: {},
      lumatoneLEDs: { id: "l" },
      exquisLEDs: { id: "e" },
      linnstrumentLEDs: { id: "n" },
      autoSyncLumatoneLEDs: vi.fn(),
      syncExquisLEDs: vi.fn(),
      syncLinnstrumentLEDs: vi.fn(),
    };

    bindControllerLedRefs(keys, { lumatone: null });

    expect(keys.lumatoneLEDs).toBeNull();
    expect(keys.exquisLEDs).toEqual({ id: "e" });
    expect(keys.linnstrumentLEDs).toEqual({ id: "n" });
    expect(keys.autoSyncLumatoneLEDs).not.toHaveBeenCalled();
    expect(keys.syncExquisLEDs).not.toHaveBeenCalled();
    expect(keys.syncLinnstrumentLEDs).not.toHaveBeenCalled();
  });
});

describe("sendLumatoneColorsNow", () => {
  it("repairs a stale driver binding before a manual colour send", () => {
    const staleLeds = { id: "stale" };
    const currentLeds = { id: "current" };
    const keys = {
      settings: { lumatone_led_sync: false },
      lumatoneLEDs: staleLeds,
      syncLumatoneLEDs: vi.fn(() => true),
    };

    expect(sendLumatoneColorsNow(keys, currentLeds)).toBe(true);
    expect(keys.lumatoneLEDs).toBe(currentLeds);
    expect(keys.syncLumatoneLEDs).toHaveBeenCalledTimes(1);
  });

  it("reports that no send occurred while the driver is unavailable", () => {
    const keys = { syncLumatoneLEDs: vi.fn() };

    expect(sendLumatoneColorsNow(keys, null)).toBe(false);
    expect(keys.syncLumatoneLEDs).not.toHaveBeenCalled();
  });
});

describe("autoSyncLumatoneSurface", () => {
  it("sends the blank layout when the musical surface has scale size 0", () => {
    const keys = { autoSyncLumatoneLEDs: vi.fn() };
    const leds = { sendLayout: vi.fn() };

    expect(autoSyncLumatoneSurface({ keys, leds, scale: [] })).toBe(true);

    expect(leds.sendLayout).toHaveBeenCalledTimes(1);
    expect(leds.sendLayout.mock.calls[0][0]).toHaveLength(280);
    expect(keys.autoSyncLumatoneLEDs).not.toHaveBeenCalled();
  });

  it("keeps ordinary automatic colour sync for a populated scale", () => {
    const keys = { autoSyncLumatoneLEDs: vi.fn() };
    const leds = { sendLayout: vi.fn() };

    expect(autoSyncLumatoneSurface({ keys, leds, scale: ["2/1"] })).toBe(true);

    expect(keys.lumatoneLEDs).toBe(leds);
    expect(keys.autoSyncLumatoneLEDs).toHaveBeenCalledTimes(1);
    expect(leds.sendLayout).not.toHaveBeenCalled();
  });

  it("does not send a blank layout outside eligible Lumatone mapping modes", () => {
    const leds = { sendLayout: vi.fn() };

    expect(autoSyncLumatoneSurface({ keys: null, leds, scale: [], eligible: false })).toBe(false);
    expect(leds.sendLayout).not.toHaveBeenCalled();
  });
});

describe("App input runtime", () => {
  it("keeps configured wheel semitones and forces standard wheel mode for LinnStrument bypass with MPE input off", async () => {
    Object.assign(settings, {
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
      midi_passthrough: true,
      midiin_mpe_input: false,
      midi_wheel_semitones: 12,
      wheel_to_recent: true,
    });
    synthWiringState.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Roger Linn Design LinnStrument 128" }]]),
      outputs: new Map(),
    };
    mockDetectedController = { id: "linnstrument" };
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());
    expect(lastKeyboardProps.inputRuntime.wheelSemitones).toBe(12);
    expect(lastKeyboardProps.inputRuntime.wheelToRecent).toBe(false);
  });

  it("re-syncs LinnStrument colors after onKeysReady when UF mode is eligible", async () => {
    Object.assign(settings, {
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
      midi_passthrough: false,
      midiin_mpe_input: false,
      linnstrument_led_sync: true,
    });
    synthWiringState.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Roger Linn Design LinnStrument 128" }]]),
      outputs: new Map(),
    };
    mockDetectedController = { id: "linnstrument" };
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    render(<App />);

    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());
    const keys = {
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };

    lastKeyboardProps.onKeysReady(keys);

    await waitFor(() => expect(keys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1));
  });

  it("re-syncs LinnStrument colors only after the rebuilt Keys instance is ready when center_degree changes under UF mode", async () => {
    Object.assign(settings, {
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
      midi_passthrough: false,
      midiin_mpe_input: false,
      linnstrument_led_sync: true,
      center_degree: 0,
    });
    synthWiringState.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Roger Linn Design LinnStrument 128" }]]),
      outputs: new Map(),
    };
    mockDetectedController = { id: "linnstrument" };
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    const { rerender } = render(<App />);

    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());
    const staleKeys = {
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };
    lastKeyboardProps.onKeysReady(staleKeys);
    await waitFor(() => expect(staleKeys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1));
    staleKeys.syncLinnstrumentLEDs.mockClear();

    settings = { ...settings, center_degree: 9 };
    rerender(<App />);

    expect(staleKeys.syncLinnstrumentLEDs).not.toHaveBeenCalled();

    const rebuiltKeys = {
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };
    lastKeyboardProps.onKeysReady(rebuiltKeys);

    await waitFor(() => expect(rebuiltKeys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1));
  });

  it("marks the LinnStrument LED driver UF-active when Keys mounts after UF activation", async () => {
    Object.assign(settings, {
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
      midi_passthrough: false,
      midiin_mpe_input: false,
      linnstrument_led_sync: true,
    });
    synthWiringState.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Roger Linn Design LinnStrument 128" }]]),
      outputs: new Map(),
    };
    synthWiringState.linnstrumentRawPorts = {
      output: { id: "out-1" },
    };
    mockDetectedController = { id: "linnstrument" };
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());
    const keys = {
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };

    lastKeyboardProps.onKeysReady(keys);

    await waitFor(() => {
      const leds = attachLinnstrumentLedDriver.mock.results[0]?.value;
      expect(leds?.userFirmwareActive).toBe(true);
    });
  });

  it("re-evaluates Auto Detect on midiTick when the selected input appears later", async () => {
    Object.assign(settings, {
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
      midi_passthrough: false,
      midiin_mpe_input: false,
      linnstrument_led_sync: true,
    });
    const midi = {
      inputs: new Map(),
      outputs: new Map(),
    };
    synthWiringState.midi = midi;
    synthWiringState.midiTick = 0;
    mockDetectedController = null;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const raf = vi.fn((cb) => {
      cb();
      return 1;
    });
    window.requestAnimationFrame = raf;
    globalThis.requestAnimationFrame = raf;

    const { rerender } = render(<App />);

    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());
    const staleKeys = {
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };
    lastKeyboardProps.onKeysReady(staleKeys);
    expect(staleKeys.syncLinnstrumentLEDs).not.toHaveBeenCalled();

    midi.inputs.set("input-1", { id: "input-1", name: "Roger Linn Design LinnStrument 128" });
    synthWiringState.midiTick = 1;
    mockDetectedController = { id: "linnstrument" };
    rerender(<App />);

    const recoveredKeys = {
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };
    lastKeyboardProps.onKeysReady(recoveredKeys);
    await waitFor(() => expect(recoveredKeys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1));
  });

  it("sends LinnStrument UF deactivation on page unload while UF mode is eligible", async () => {
    Object.assign(settings, {
      midiin_device: "input-1",
      midiin_controller_override: "auto",
      midiin_mapping_target: "hex_layout",
      midi_passthrough: false,
      midiin_mpe_input: false,
      linnstrument_led_sync: true,
    });
    synthWiringState.midi = {
      inputs: new Map([["input-1", { id: "input-1", name: "Roger Linn Design LinnStrument 128" }]]),
      outputs: new Map(),
    };
    synthWiringState.linnstrumentRawPorts = {
      output: { id: "out-1" },
    };
    mockDetectedController = { id: "linnstrument" };
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());
    const keys = {};
    lastKeyboardProps.onKeysReady(keys);

    window.dispatchEvent(new Event("pagehide"));

    await waitFor(() =>
      expect(deactivateLinnstrumentUserFirmware).toHaveBeenCalledWith(
        synthWiringState.linnstrumentRawPorts.output,
        keys,
      ),
    );
  });
});

describe("App workspace tabs", () => {
  it.each([
    ["sequencer", "SEQUENCER"],
    ["calculator", "CALCULATOR"],
  ])("opens the restored %s workspace on startup", async (storedTab, tabName) => {
    sessionStorage.setItem(RELOAD_WORKSPACE_TAB_KEY, storedTab);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: tabName }).getAttribute("aria-selected")).toBe("true"),
    );
  });

  it("restores stored sequence timbre after Mod Wheel input when sequence shaping is unchecked", async () => {
    render(<App />);
    const polyTimbre = vi.fn();
    const soundingHex = {
      release: false,
      _snapshotSourceTimbre: 80,
      _snapshotSourceTimbre14: null,
      polyTimbre,
    };
    const keys = {
      _snapshotHexes: [soundingHex],
      _soundingSnapshotHexes: new Set([soundingHex]),
    };

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => lastKeyboardProps.onKeysReady(keys));
    act(() => lastKeyboardProps.onModWheelChange(127));

    expect(polyTimbre).toHaveBeenCalledWith(80);
  });

  it("shapes stored sequence timbre after Mod Wheel input when sequence shaping is checked", async () => {
    render(<App />);
    const polyTimbre = vi.fn();
    const soundingHex = {
      release: false,
      _snapshotSourceTimbre: 80,
      _snapshotSourceTimbre14: null,
      polyTimbre,
    };
    const keys = {
      _snapshotHexes: [soundingHex],
      _soundingSnapshotHexes: new Set([soundingHex]),
    };

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => lastKeyboardProps.onKeysReady(keys));
    fireEvent.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    fireEvent.click(await screen.findByLabelText("Mod Wheel to sequence timbre"));
    polyTimbre.mockClear();
    act(() => lastKeyboardProps.onModWheelChange(127));

    expect(polyTimbre).toHaveBeenCalledWith(127);
  });

  it("uses manual arpeggiation when PLAY FROM starts a snapshot", async () => {
    localStorage.setItem("hexatone_persist_on_reload", "true");
    sessionStorage.setItem(
      SEQUENCE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        snapshots: [
          {
            id: 1,
            length: 1,
            notes: [
              { id: "first", midicents: 60, start: 0, attackVelocity: 90 },
              { id: "second", midicents: 64, start: 0.5, attackVelocity: 90 },
            ],
          },
          {
            id: 2,
            length: 1,
            notes: [{ id: "next", midicents: 67, start: 0, attackVelocity: 90 }],
          },
        ],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
        tempi: [],
        repeats: [],
        manualArpeggiation: {
          mode: "all",
          initialSpreadMs: 1000,
          spreadVariation: 0,
          timingVariation: 0,
          decayMode: "immediate",
          decayMs: 5000,
          decayVariation: 0,
        },
      }),
    );
    const { unmount } = render(<App />);
    const keys = {
      settings: {
        note_names: [],
        heji_names: [],
      },
      beginSnapshotGesture: vi.fn(),
      attackSnapshotGestureNote: vi.fn((_gestureId, note) => ({ hex: { note } })),
      releaseSnapshotGestureNote: vi.fn(),
      stopSnapshotGesture: vi.fn(),
      stopSnapshot: vi.fn(),
      panic: vi.fn(),
    };

    await waitFor(() => {
      expect(lastKeyboardProps).not.toBeNull();
    });
    act(() => {
      lastKeyboardProps.onKeysReady(keys);
    });

    fireEvent.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    fireEvent.click(await screen.findByLabelText("play current sequence position"));

    expect(keys.beginSnapshotGesture).toHaveBeenCalledWith(expect.any(Number), { replace: false });
    expect(keys.attackSnapshotGestureNote).toHaveBeenCalledTimes(1);
    expect(keys.attackSnapshotGestureNote.mock.calls[0][1].id).toBe("first");

    fireEvent.click(screen.getByLabelText("next sequence step"));

    expect(keys.releaseSnapshotGestureNote).toHaveBeenCalledTimes(1);
    expect(keys.stopSnapshotGesture).toHaveBeenCalledTimes(1);
    expect(keys.attackSnapshotGestureNote).toHaveBeenCalledTimes(2);
    expect(keys.attackSnapshotGestureNote.mock.calls[1][1].id).toBe("next");

    unmount();
    localStorage.removeItem("hexatone_persist_on_reload");
    sessionStorage.removeItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
  });

  it("retunes active timed-playback voices while the navigation playhead is stopped", async () => {
    render(<App />);
    const user = userEvent.setup();
    const soundingHex = {
      _baseCents: 0,
      _snapshotSourceBaseCents: 0,
      _snapshotSourceMidicents: 69,
      _snapshotAppliedPitchOffsetCents: 0,
      sequenceRetune: vi.fn(),
    };
    const keys = {
      _snapshotHexes: [soundingHex],
      stopSnapshot: vi.fn(),
      panic: vi.fn(),
    };

    await waitFor(() => {
      expect(lastKeyboardProps).not.toBeNull();
    });
    act(() => {
      lastKeyboardProps.onKeysReady(keys);
    });

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    const pitchSlider = await screen.findByRole("slider", {
      name: "sequence playback pitch slider",
    });
    fireEvent.keyDown(pitchSlider, { key: "ArrowRight" });

    expect(soundingHex.sequenceRetune).toHaveBeenCalledWith(1);
  });

  it("snaps sounding timed-playback voices immediately while the navigation playhead is stopped", async () => {
    localStorage.setItem("hexatone_persist_on_reload", "true");
    sessionStorage.setItem(
      SEQUENCE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        snapshots: [
          {
            id: 1,
            length: 1,
            notes: [{ id: "note", midicents: 70.5, start: 0, end: 1, attackVelocity: 90 }],
          },
        ],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
        tempi: [
          { id: 1, position: 1, bpm: 60, beatNumerator: 1, beatDenominator: 4, beatLength: 1 },
        ],
        repeats: [],
      }),
    );

    const soundingHex = {
      _snapshotInstanceKey: null,
      sequenceRetune: vi.fn(),
    };
    const tuningRuntime = {
      scale: [0, 200, 1200],
      referenceDegree: 0,
      fundamental: 440,
      equivInterval: 1200,
    };
    const keys = {
      settings: {
        fundamental: 440,
        note_names: ["A", "B", "C"],
        heji_names: [],
      },
      tuning: { degree0toRef_asArray: [0] },
      _snapshotHexes: [],
      _activeFrame: () => ({}),
      _effectiveScaleRuntimeForFrame: () => tuningRuntime,
      playSnapshot: vi.fn((notes) => {
        soundingHex._snapshotInstanceKey = notes[0]?.instanceKey ?? null;
        keys._snapshotHexes = [soundingHex];
      }),
      stopSnapshot: vi.fn(),
      panic: vi.fn(),
    };

    const { unmount } = render(<App />);
    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => {
      lastKeyboardProps.onKeysReady(keys);
    });

    fireEvent.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    fireEvent.click(await screen.findByLabelText("play timed transport"));
    await waitFor(() => expect(keys.playSnapshot).toHaveBeenCalled());

    fireEvent.click(screen.getByLabelText("Snap Sequence to Current Hexatone Tuning"));

    expect(soundingHex.sequenceRetune).toHaveBeenCalled();
    expect(soundingHex.sequenceRetune.mock.calls.at(-1)[0]).toBeCloseTo(200, 6);
    expect(keys.stopSnapshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Snap Sequence to Current Hexatone Tuning"));
    expect(soundingHex.sequenceRetune.mock.calls.at(-1)[0]).toBeCloseTo(150, 6);
    expect(keys.playSnapshot).toHaveBeenCalledTimes(1);

    unmount();
    localStorage.removeItem("hexatone_persist_on_reload");
    sessionStorage.removeItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
  });

  it("resizes and redraws the keyboard after toggling the sidebar", async () => {
    vi.useFakeTimers();
    const { container } = render(<App />);

    await waitFor(() => {
      expect(lastKeyboardProps).not.toBeNull();
    });

    const keys = {
      resizeHandler: vi.fn(),
      scheduleImmediateGridRedraw: vi.fn(),
    };

    act(() => {
      lastKeyboardProps.onKeysReady(keys);
    });

    act(() => {
      vi.advanceTimersByTime(350);
    });
    keys.resizeHandler.mockClear();
    keys.scheduleImmediateGridRedraw.mockClear();

    act(() => {
      fireEvent.click(container.querySelector("#sidebar-button"));
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(keys.resizeHandler).toHaveBeenCalledTimes(1);
    expect(keys.scheduleImmediateGridRedraw).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("keeps independent remembered positions for the main and contextual manuals", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "MANUAL" }));
    expect((await screen.findByTestId("manual-sidebar")).dataset.initialSectionTitle).toBe("About");
    await user.click(screen.getByRole("button", { name: "Select Quick Start" }));
    await user.click(screen.getByRole("tab", { name: "HEXATONE" }));
    await user.click(screen.getByRole("tab", { name: "MANUAL" }));
    expect((await screen.findByTestId("manual-sidebar")).dataset.initialSectionTitle).toBe(
      "Quick Start",
    );

    await user.click(screen.getByRole("tab", { name: "HEXATONE" }));
    await user.click(screen.getByText("… more"));
    expect((await screen.findByTestId("manual-sidebar")).dataset.initialSectionTitle).toBe(
      "HEXATONE Tab",
    );
    expect(screen.getByRole("tab", { name: "HEXATONE" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "MANUAL" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("heading", { name: "PLAINSOUND HEXATONE" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Select Quick Start" }));
    await user.click(screen.getByRole("button", { name: "Close contextual manual" }));
    await user.click(screen.getByText("… more"));
    expect((await screen.findByTestId("manual-sidebar")).dataset.initialSectionTitle).toBe(
      "Quick Start",
    );

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    await waitFor(() => {
      expect(screen.queryByTestId("manual-sidebar")).toBeNull();
    });

    await user.click(screen.getByText("… more"));
    expect((await screen.findByTestId("manual-sidebar")).dataset.initialSectionTitle).toBe(
      "SEQUENCER Tab",
    );

    await user.click(screen.getByRole("tab", { name: "I/O" }));
    await waitFor(() => {
      expect(screen.queryByTestId("manual-sidebar")).toBeNull();
    });

    await user.click(screen.getByText("… more"));
    expect((await screen.findByTestId("manual-sidebar")).dataset.initialSectionTitle).toBe(
      "IO tab",
    );

    await user.click(screen.getByRole("tab", { name: "CALCULATOR" }));
    await waitFor(() => {
      expect(screen.queryByTestId("manual-sidebar")).toBeNull();
    });

    await user.click(screen.getByText("… more"));
    expect((await screen.findByTestId("manual-sidebar")).dataset.initialSectionTitle).toBe(
      "CALCULATOR tab",
    );

    await user.click(screen.getByRole("tab", { name: "HEXATONE" }));
    await waitFor(() => {
      expect(screen.queryByTestId("manual-sidebar")).toBeNull();
    });
  });

  it("stops sequencer-owned playback without interrupting live notes", async () => {
    render(<App />);
    const user = userEvent.setup();
    const keys = {
      stopSnapshot: vi.fn(),
      panic: vi.fn(),
    };

    await waitFor(() => {
      expect(lastKeyboardProps).not.toBeNull();
    });

    act(() => {
      lastKeyboardProps.onKeysReady(keys);
    });

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    await user.click(screen.getByRole("tab", { name: "HEXATONE" }));

    expect(keys.stopSnapshot).toHaveBeenCalledTimes(1);
    expect(keys.panic).not.toHaveBeenCalled();
    expect(guardianPanicMock).not.toHaveBeenCalled();
  });

  it("keeps sequencer-owned playback running while the I/O panel is open", async () => {
    render(<App />);
    const user = userEvent.setup();
    const keys = {
      stopSnapshot: vi.fn(),
      panic: vi.fn(),
    };

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => lastKeyboardProps.onKeysReady(keys));

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    const timedPlayButton = await screen.findByLabelText("play timed transport");
    await user.click(screen.getByRole("tab", { name: "I/O" }));

    expect(await screen.findByTestId("io-settings")).not.toBeNull();
    // Timed playback is owned by the Sequencer component. It must remain the
    // same mounted instance while I/O is visible or its transport cleanup will
    // cancel the running schedule.
    expect(timedPlayButton.isConnected).toBe(true);
    expect(keys.stopSnapshot).not.toHaveBeenCalled();
    expect(keys.panic).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    expect(screen.getByLabelText("play timed transport")).toBe(timedPlayButton);
    expect(keys.stopSnapshot).not.toHaveBeenCalled();
  });

  it("keeps Calculator user data mounted while switching workspace tabs", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: "CALCULATOR" }));
    const pitch = await screen.findByLabelText("Calculator lookup ratio or cents");
    fireEvent.input(pitch, { target: { value: "5/4" } });
    fireEvent.blur(pitch);

    await user.click(screen.getByRole("tab", { name: "I/O" }));
    expect(pitch.isConnected).toBe(true);
    expect(pitch.closest(".calculator-tab").hidden).toBe(true);

    await user.click(screen.getByRole("tab", { name: "CALCULATOR" }));
    expect(screen.getByLabelText("Calculator lookup ratio or cents")).toBe(pitch);
    expect(pitch.value).toBe("5/4");
    expect(pitch.closest(".calculator-tab").hidden).toBe(false);
  });

  it("keeps performance palettes in I/O and the snapshot palette outside Sequencer", async () => {
    localStorage.setItem("hexatone_persist_on_reload", "true");
    sessionStorage.setItem(
      SEQUENCE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        snapshots: [
          {
            id: 1,
            length: 1,
            notes: [{ id: "note", midicents: 60, start: 0, attackVelocity: 90 }],
          },
        ],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
        tempi: [],
        repeats: [],
      }),
    );
    const { unmount } = render(<App />);
    const user = userEvent.setup();

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => {
      lastKeyboardProps.onModulationStateChange({
        mode: "idle",
        history: [{ sourceDegree: 0, targetDegree: 1, count: 0 }],
      });
    });

    await user.click(screen.getByRole("tab", { name: "I/O" }));

    expect(document.querySelector("#snapshot-palette")).not.toBeNull();
    expect(document.querySelector("#modulation-palette")).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "CALCULATOR" }));
    expect(document.querySelector("#snapshot-palette")).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "MANUAL" }));
    expect(document.querySelector("#snapshot-palette")).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    expect(document.querySelector("#snapshot-palette")).toBeNull();

    unmount();
    localStorage.removeItem("hexatone_persist_on_reload");
    sessionStorage.removeItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
  });

  it("stops timed playback before playing a snapshot from the palette", async () => {
    localStorage.setItem("hexatone_persist_on_reload", "true");
    sessionStorage.setItem(
      SEQUENCE_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        snapshots: [
          {
            id: 1,
            length: 1,
            notes: [{ id: "first", midicents: 60, start: 0, end: 1, attackVelocity: 90 }],
          },
          {
            id: 2,
            length: 1,
            notes: [{ id: "second", midicents: 67, start: 0, end: 1, attackVelocity: 90 }],
          },
        ],
        bars: [{ id: 1, position: 1, numerator: 4, denominator: 4 }],
        tempi: [
          { id: 1, position: 1, bpm: 30, beatNumerator: 1, beatDenominator: 4, beatLength: 1 },
        ],
        repeats: [],
      }),
    );
    const keys = {
      settings: { note_names: [], heji_names: [] },
      playSnapshot: vi.fn(),
      stopSnapshot: vi.fn(),
      beginSnapshotGesture: vi.fn(),
      attackSnapshotGestureNote: vi.fn((_gestureId, note) => ({ hex: { note } })),
      releaseSnapshotGestureNote: vi.fn(),
      stopSnapshotGesture: vi.fn(),
      panic: vi.fn(),
    };
    const { unmount } = render(<App />);
    const user = userEvent.setup();

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => lastKeyboardProps.onKeysReady(keys));

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    await user.click(await screen.findByLabelText("play timed transport"));
    await waitFor(() => expect(keys.playSnapshot).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("tab", { name: "I/O" }));
    const stopCallsBeforePalettePlay = keys.stopSnapshot.mock.calls.length;
    await user.click(await screen.findByLabelText("Play snapshot 1"));

    expect(keys.stopSnapshot).toHaveBeenCalledTimes(stopCallsBeforePalettePlay + 1);
    expect(keys.beginSnapshotGesture).toHaveBeenCalledTimes(1);
    expect(keys.attackSnapshotGestureNote).toHaveBeenCalledTimes(1);
    expect(keys.attackSnapshotGestureNote.mock.calls[0][1].id).toBe("first");

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    expect(screen.getByLabelText("play timed transport")).not.toBeNull();

    unmount();
    localStorage.removeItem("hexatone_persist_on_reload");
    sessionStorage.removeItem(SEQUENCE_WORKSPACE_STORAGE_KEY);
  });

  it("stops sequencer playback when switching from I/O to Hexatone", async () => {
    render(<App />);
    const user = userEvent.setup();
    const keys = { stopSnapshot: vi.fn(), panic: vi.fn() };

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => lastKeyboardProps.onKeysReady(keys));

    await user.click(screen.getByRole("tab", { name: "SEQUENCER" }));
    await user.click(screen.getByRole("tab", { name: "I/O" }));
    await user.click(screen.getByRole("tab", { name: "HEXATONE" }));

    expect(keys.stopSnapshot).toHaveBeenCalledTimes(1);
    expect(keys.panic).not.toHaveBeenCalled();
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

  it("panics the live keyboard synchronously when the page reloads", async () => {
    render(<App />);
    const keys = { panic: vi.fn() };

    await waitFor(() => expect(lastKeyboardProps).not.toBeNull());
    act(() => {
      lastKeyboardProps.onKeysReady(keys);
    });
    window.dispatchEvent(new Event("beforeunload"));

    expect(keys.panic).toHaveBeenCalledTimes(1);
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

  it("clears the MOD button route summary when modulation is cancelled back to idle", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("keyboard")).not.toBeNull());

    act(() => {
      lastKeyboardProps.onModulationStateChange?.({
        mode: "awaiting_target",
        sourceDegree: 0,
        currentRoute: null,
        history: [{ sourceDegree: 0, targetDegree: 7, count: 1, transpositionDeltaCents: 500 }],
      });
    });

    expect(screen.getByText("1/1 →")).toBeTruthy();

    act(() => {
      lastKeyboardProps.onModulationStateChange?.({
        mode: "idle",
        sourceDegree: null,
        currentRoute: { sourceDegree: 0, targetDegree: 7, count: 1, transpositionDeltaCents: 500 },
        history: [{ sourceDegree: 0, targetDegree: 7, count: 1, transpositionDeltaCents: 500 }],
      });
    });

    expect(screen.queryByText("1/1 → 2/1[-1eq]")).toBeNull();
    expect(screen.queryByText("1/1 →")).toBeNull();
  });
});
