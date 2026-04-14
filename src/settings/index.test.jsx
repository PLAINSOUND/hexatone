import { render, screen, fireEvent } from "@testing-library/preact";
import Settings from "./index.jsx";

vi.mock("./presets", () => ({ default: () => <div>Presets Stub</div> }));
vi.mock("./custom-presets", () => ({ default: () => <div>User Tunings Stub</div> }));
vi.mock("./info", () => ({ default: () => <div>Info Stub</div> }));
vi.mock("./scale", () => ({ default: () => <div>Scale Stub</div> }));
vi.mock("./layout", () => ({ default: () => <div>Layout Stub</div> }));
vi.mock("./sample", () => ({ default: () => <div>Sample Stub</div> }));
vi.mock("./midi", () => ({ default: () => <div>MIDI In Stub</div> }));
vi.mock("./midi/midioutputs", () => ({ default: () => <div>MIDI Out Stub</div> }));
vi.mock("./snapshots.jsx", () => ({ default: () => <div>Snapshots Stub</div> }));

const baseProps = {
  presetChanged: () => {},
  presets: [],
  settings: {},
  onChange: () => {},
  onAtomicChange: () => {},
  onImport: () => {},
  importCount: 0,
  onLoadCustomPreset: () => {},
  onClearUserPresets: () => {},
  activeSource: "",
  activePresetName: "",
  isPresetDirty: false,
  persistOnReload: false,
  setPersistOnReload: () => {},
  onRevertBuiltin: () => {},
  onRevertUser: () => {},
  midi: null,
  midiAccess: "none",
  midiAccessError: null,
  ensureMidiAccess: () => {},
  midiTick: 0,
  instruments: [],
  keysRef: { current: null },
  onVolumeChange: () => {},
  midiLearnActive: false,
  lumatoneRawPorts: null,
  exquisRawPorts: null,
  exquisLedStatus: null,
  snapshots: [],
  playingSnapshotId: null,
  onPlaySnapshot: () => {},
  onDeleteSnapshot: () => {},
};

describe("Settings WebMIDI fieldset", () => {
  it("renders always-visible Enable MIDI and Enable Sysex checkboxes", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("WebMIDI")).not.toBeNull();
    expect(screen.getByLabelText("Enable MIDI")).not.toBeNull();
    expect(screen.getByLabelText("Enable Sysex")).not.toBeNull();
  });

  it("requests basic MIDI when Enable MIDI is clicked from none state", () => {
    const ensureMidiAccess = vi.fn();
    render(<Settings {...baseProps} ensureMidiAccess={ensureMidiAccess} />);
    fireEvent.click(screen.getByLabelText("Enable MIDI"));
    expect(ensureMidiAccess).toHaveBeenCalledWith({ sysex: false });
  });

  it("requests sysex MIDI when Enable Sysex is clicked from basic state", () => {
    const ensureMidiAccess = vi.fn();
    render(<Settings {...baseProps} midiAccess="basic" ensureMidiAccess={ensureMidiAccess} />);
    fireEvent.click(screen.getByLabelText("Enable Sysex"));
    expect(ensureMidiAccess).toHaveBeenCalledWith({ sysex: true });
  });

  it("shows midi access errors inline", () => {
    render(<Settings {...baseProps} midiAccessError="MIDI SysEx access was not granted." />);
    expect(screen.getByText("MIDI SysEx access was not granted.")).not.toBeNull();
  });
});
