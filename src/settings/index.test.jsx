import { render, screen, fireEvent } from "@testing-library/preact";
import Settings from "./index.jsx";

vi.mock("./settings.css", () => ({}));
vi.mock("../hexatone/preset-tunings/index.js", () => ({
  presetTuningGroups: [],
}));
vi.mock("../hexatone/tuning-library.jsx", () => ({
  default: (props) => (
    <div>
      {props.showActivateAudioContext &&
      (props.activateAudioContext || props.activatePendingPreset) ? (
        <button
          type="button"
          onClick={() => void (props.activateAudioContext || props.activatePendingPreset)()}
        >
          Activate Audio Context
        </button>
      ) : (
        <label>
          <input
            type="checkbox"
            aria-label="Restore preset on reload"
            checked={props.persistOnReload}
            onChange={(e) => props.setPersistOnReload(e.target.checked)}
          />
          Restore preset on reload
        </label>
      )}
      Tuning Library Stub
    </div>
  ),
}));
vi.mock("./scale/info", () => ({ default: () => <div>Info Stub</div> }));
const scaleMockState = vi.hoisted(() => ({ props: [] }));
vi.mock("./scale", () => ({
  default: (props) => {
    scaleMockState.props.push(props);
    return <div>Scale Stub</div>;
  },
}));
vi.mock("./layout", () => ({ default: () => <div>Layout Stub</div> }));
vi.mock("./sample", () => ({ default: () => <div>Sample Stub</div> }));
vi.mock("./midi", () => ({ default: () => <div>MIDI In Stub</div> }));
vi.mock("./midi/midioutputs", () => ({ default: () => <div>MIDI Out Stub</div> }));

const baseProps = {
  onLoadBuiltinPreset: () => {},
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
  showActivateAudioContext: false,
  activateAudioContext: null,
  pendingRestoredPreset: null,
  activatePendingPreset: () => {},
  onRevertBuiltin: () => {},
  onRevertUser: () => {},
  midi: null,
  midiAccess: "none",
  midiAccessError: null,
  enableWebMidi: () => {},
  disableWebMidi: () => {},
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

describe("Settings MIDI Setup fieldset", () => {
  beforeEach(() => {
    scaleMockState.props.length = 0;
  });

  it("renders always-visible Enable MIDI and Enable Sysex checkboxes", () => {
    render(<Settings {...baseProps} />);
    expect(screen.getByText("MIDI Setup")).not.toBeNull();
    expect(screen.getByLabelText("Enable MIDI")).not.toBeNull();
    expect(screen.getByLabelText("Enable Sysex")).not.toBeNull();
  });

  it("requests basic MIDI when Enable MIDI is clicked from none state", () => {
    const enableWebMidi = vi.fn();
    render(
      <Settings
        {...baseProps}
        settings={{ webmidi_enabled: false, webmidi_sysex_enabled: false }}
        enableWebMidi={enableWebMidi}
      />,
    );
    fireEvent.click(screen.getByLabelText("Enable MIDI"));
    expect(enableWebMidi).toHaveBeenCalledWith({ sysex: false });
  });

  it("hides the activate-audio-context button by default", () => {
    render(<Settings {...baseProps} />);
    expect(screen.queryByRole("button", { name: "Activate Audio Context" })).toBeNull();
  });

  it("shows an activate-audio-context button when restored audio needs activation", () => {
    const activateAudioContext = vi.fn();
    const activatePendingPreset = vi.fn();
    const setPersistOnReload = vi.fn();
    render(
      <Settings
        {...baseProps}
        showActivateAudioContext={true}
        activateAudioContext={activateAudioContext}
        activatePendingPreset={activatePendingPreset}
        setPersistOnReload={setPersistOnReload}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Activate Audio Context" }));
    expect(activateAudioContext).toHaveBeenCalledTimes(1);
    expect(activatePendingPreset).not.toHaveBeenCalled();
    expect(setPersistOnReload).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Restore preset on reload")).toBeNull();
  });

  it("requests sysex MIDI when Enable Sysex is clicked from basic state", () => {
    const enableWebMidi = vi.fn();
    render(
      <Settings
        {...baseProps}
        settings={{ webmidi_enabled: true, webmidi_sysex_enabled: false }}
        midiAccess="basic"
        enableWebMidi={enableWebMidi}
      />,
    );
    fireEvent.click(screen.getByLabelText("Enable Sysex"));
    expect(enableWebMidi).toHaveBeenCalledWith({ sysex: true });
  });

  it("disables WebMIDI and clears intent when Enable MIDI is unchecked", () => {
    const onChange = vi.fn();
    const disableWebMidi = vi.fn();
    render(
      <Settings
        {...baseProps}
        settings={{ webmidi_enabled: true, webmidi_sysex_enabled: true }}
        onChange={onChange}
        disableWebMidi={disableWebMidi}
      />,
    );
    fireEvent.click(screen.getByLabelText("Enable MIDI"));
    expect(onChange).toHaveBeenCalledWith("webmidi_enabled", false);
    expect(onChange).toHaveBeenCalledWith("webmidi_sysex_enabled", false);
    expect(disableWebMidi).toHaveBeenCalled();
  });

  it("fully disables WebMIDI when Enable Sysex is unchecked", () => {
    const onChange = vi.fn();
    const disableWebMidi = vi.fn();
    render(
      <Settings
        {...baseProps}
        settings={{ webmidi_enabled: true, webmidi_sysex_enabled: true }}
        onChange={onChange}
        disableWebMidi={disableWebMidi}
      />,
    );
    fireEvent.click(screen.getByLabelText("Enable Sysex"));
    expect(onChange).toHaveBeenCalledWith("webmidi_enabled", false);
    expect(onChange).toHaveBeenCalledWith("webmidi_sysex_enabled", false);
    expect(disableWebMidi).toHaveBeenCalled();
  });

  it("shows midi access errors inline", () => {
    render(<Settings {...baseProps} midiAccessError="MIDI SysEx access was not granted." />);
    expect(screen.getByText("MIDI SysEx access was not granted.")).not.toBeNull();
  });

  it("passes normalized color precedence into the Scale panel", () => {
    render(
      <Settings
        {...baseProps}
        settings={{
          scale: ["23/16", "2/1"],
          equivSteps: 2,
          spectrum_colors: true,
          auto_colors: true,
          fundamental_color: "#abcdef",
          note_colors: ["#ffffff", "#ffffff"],
          note_names: ["1/1", "23"],
          key_labels: "note_names",
        }}
      />,
    );

    const lastProps = scaleMockState.props.at(-1);
    expect(lastProps.settings.spectrum_colors).toBe(false);
    expect(lastProps.settings.auto_colors).toBe(true);
    expect(lastProps.settings.note_colors[1]).toBe("95c69b");
  });
});
