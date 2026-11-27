import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyIOReloadPolicy, IO_RESTORE_KEY, SOUND_RESTORE_KEY, MIDI_RESTORE_KEY, restoreIOOnReload, restoreSoundOnReload, restoreMidiOnReload } from "./io-reload-policy.js";
import { SETTINGS_REGISTRY } from "./settings-registry.js";

describe("independent I/O reload policy", () => {
  it("leaves samples off and enables the other built-in backends, using local scsynth", () => {
    expect(SETTINGS_REGISTRY.find((entry) => entry.key === "output_sample").default).toBe(false);
    for (const key of ["output_dsf", "output_fluidsynth", "output_osc", "osc_local"])
      expect(SETTINGS_REGISTRY.find((entry) => entry.key === key).default).toBe(true);
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  function seed() {
    sessionStorage.setItem("output_mpe", "true");
    sessionStorage.setItem("mpe_device", "port-1");
    sessionStorage.setItem("webmidi_enabled", "true");
    sessionStorage.setItem("scale", "3/2,2/1");
    localStorage.setItem("instrument", "reed");
    localStorage.setItem("synth_volume", "0.3");
    localStorage.setItem("hakenaudio_midiin_bend_range", "2/1");
  }
  it("defaults to restoring the existing I/O setup", () => {
    seed();
    expect(restoreIOOnReload()).toBe(true);
    applyIOReloadPolicy({ navigationType: "reload" });
    expect(sessionStorage.getItem("output_mpe")).toBe("true");
    expect(localStorage.getItem("instrument")).toBe("reed");
  });
  it.each([true, false])("clears I/O independently of preset restore=%s", (presetRestore) => {
    seed();
    localStorage.setItem("hexatone_persist_on_reload", String(presetRestore));
    localStorage.setItem(IO_RESTORE_KEY, "false");
    const history = { replaceState: vi.fn() };
    applyIOReloadPolicy({
      navigationType: "reload",
      history,
      location: { href: "http://localhost/?scale=3/2&instrument=reed&output_sample=false" },
    });
    expect(sessionStorage.getItem("output_mpe")).toBeNull();
    expect(sessionStorage.getItem("mpe_device")).toBeNull();
    expect(sessionStorage.getItem("webmidi_enabled")).toBeNull();
    expect(localStorage.getItem("instrument")).toBeNull();
    expect(localStorage.getItem("synth_volume")).toBeNull();
    expect(sessionStorage.getItem("scale")).toBe("3/2,2/1");
    expect(localStorage.getItem("hakenaudio_midiin_bend_range")).toBe("2/1");
    expect(history.replaceState.mock.calls[0][2].searchParams.has("instrument")).toBe(false);
    expect(history.replaceState.mock.calls[0][2].searchParams.get("scale")).toBe("3/2");
  });
  it("does not reset I/O on ordinary navigation", () => {
    seed();
    localStorage.setItem(IO_RESTORE_KEY, "false");
    applyIOReloadPolicy({ navigationType: "navigate" });
    expect(sessionStorage.getItem("mpe_device")).toBe("port-1");
  });
  it.each([[true, false], [false, true], [false, false], [true, true]])(
    "independently restores sounds=%s and MIDI=%s on reload", (sounds, midi) => {
      seed();
      localStorage.setItem(SOUND_RESTORE_KEY, String(sounds));
      localStorage.setItem(MIDI_RESTORE_KEY, String(midi));
      localStorage.setItem("dsf_timbre", "0.8");
      localStorage.setItem("fluidsynth_internal_smoothing", '{"pressureMs":200}');
      sessionStorage.setItem("fluidsynth_device", "external-midi-port");
      sessionStorage.setItem("fluidsynth_preset", "2:5");
      localStorage.setItem("hexatone_user_sounds", "keep-library");
      const history = { replaceState: vi.fn() };
      applyIOReloadPolicy({ navigationType: "reload", history,
        location: { href: "http://localhost/?instrument=reed&output_mpe=true&scale=3/2" } });
      expect(localStorage.getItem("instrument")).toBe(sounds ? "reed" : null);
      expect(localStorage.getItem("dsf_timbre")).toBe(sounds ? "0.8" : null);
      expect(localStorage.getItem("synth_volume")).toBe(sounds ? "0.3" : null);
      expect(localStorage.getItem("fluidsynth_internal_smoothing")).toBe(sounds ? '{"pressureMs":200}' : null);
      expect(sessionStorage.getItem("fluidsynth_preset")).toBe(sounds ? "2:5" : null);
      expect(sessionStorage.getItem("output_mpe")).toBe(midi ? "true" : null);
      expect(sessionStorage.getItem("fluidsynth_device")).toBe(midi ? "external-midi-port" : null);
      expect(sessionStorage.getItem("webmidi_enabled")).toBe(midi ? "true" : null);
      expect(localStorage.getItem("hexatone_user_sounds")).toBe("keep-library");
      expect(localStorage.getItem("hakenaudio_midiin_bend_range")).toBe("2/1");
      expect(sessionStorage.getItem("scale")).toBe("3/2,2/1");
      if (!sounds || !midi) {
        const url = history.replaceState.mock.calls[0][2];
        expect(url.searchParams.has("instrument")).toBe(sounds);
        expect(url.searchParams.has("output_mpe")).toBe(midi);
        expect(url.searchParams.get("scale")).toBe("3/2");
      }
    });

  it("inherits the legacy preference until each separate preference is explicitly chosen", () => {
    localStorage.setItem(IO_RESTORE_KEY, "false");
    expect(restoreSoundOnReload()).toBe(false);
    expect(restoreMidiOnReload()).toBe(false);
    localStorage.setItem(SOUND_RESTORE_KEY, "true");
    expect(restoreSoundOnReload()).toBe(true);
    expect(restoreMidiOnReload()).toBe(false);
  });

});
