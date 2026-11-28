import { ACTIVE_SOUND_KEY } from "../persistence/io-reload-policy.js";
import { act, fireEvent, render, screen } from "@testing-library/preact";
import MissingSoundfontAlert from "./missing-soundfont-alert.jsx";

const bank = vi.hoisted(() => ({ engine: null, update: null }));
vi.mock("../fluidsynth_synth/index.js", () => ({
  peekFluidSynthEngine: () => bank.engine,
  subscribeFluidSynthEngine(update) { bank.update = update; return () => {}; },
}));

it("waits for lookup, clears when a bank loads, and reports a missing requested preset bank", () => {
  const recall = { state: null, changes: new EventTarget(),
    dismissBankNotice(revision) {
      this.dismissedBankNotice = revision;
      this.changes.dispatchEvent(new Event("change"));
    } };
  const view = render(<MissingSoundfontAlert lookupComplete={false} recall={recall} />);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<MissingSoundfontAlert lookupComplete recall={recall} />);
  expect(screen.getByRole("status").textContent).toContain("go to the SOUNDS tab");
  act(() => { bank.engine = { soundfontId: 0, soundfontSource: { name: "PlainsoundOrganGedackt.sf2" } }; bank.update(); });
  expect(screen.queryByRole("status")).toBeNull();
  act(() => {
    recall.state = { phase: "missing", revision: 1, reference: { name: "PlainsoundOrganPrincipal.sf2" } };
    recall.changes.dispatchEvent(new Event("change"));
  });
  fireEvent.click(screen.getByText("Dismiss"));
  expect(screen.queryByRole("status")).toBeNull();
});

it("reports missing Principal after restoring Baroque Organ with only Gedackt resident", () => {
  sessionStorage.setItem(ACTIVE_SOUND_KEY, JSON.stringify({ builtinName: "Baroque Organ" }));
  const recall = { state: null, changes: new EventTarget() };
  bank.engine = { soundfontId: 1, soundfontSource: { name: "PlainsoundOrganGedackt.sf2" } };
  render(<MissingSoundfontAlert lookupComplete recall={recall}>
    <span role="status">Audio is not ready</span>
  </MissingSoundfontAlert>);
  expect(screen.getByRole("status").textContent).toContain("A Hexatone SoundFont");
  act(() => { bank.engine.soundfontSource.name = "PlainsoundOrgan.sf2"; bank.update(); });
  expect(screen.getByRole("status").textContent).toBe("Audio is not ready");
});

it("offers sustain release while waiting and removes the action when loading begins", () => {
  const recall = { state: { phase: "waiting", revision: 1 }, changes: new EventTarget() };
  const release = vi.fn();
  render(<MissingSoundfontAlert recall={recall} onReleaseSustain={release} />);
  fireEvent.click(screen.getByRole("button", { name: "Release Sustain" }));
  expect(release).toHaveBeenCalledTimes(1);
  act(() => {
    recall.state = { ...recall.state, phase: "loading", name: "Organ.sf2" };
    recall.changes.dispatchEvent(new Event("change"));
  });
  expect(screen.queryByRole("button", { name: "Release Sustain" })).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Organ.sf2");
});

it("shows engine startup while FluidSynth output is off and clears on completion", () => {
  const recall = { state: { phase: "complete", revision: 2 }, changes: new EventTarget() };
  const view = render(<MissingSoundfontAlert recall={recall} enabled={false} startingAudio />);
  expect(screen.getByRole("status").textContent).toBe("Starting Audio...");
  view.rerender(<MissingSoundfontAlert recall={recall} enabled={false} startingAudio={false} />);
  expect(screen.queryByRole("status")).toBeNull();
});
