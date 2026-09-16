import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyIOReloadPolicy, IO_RESTORE_KEY, restoreIOOnReload } from "./io-reload-policy.js";

describe("independent I/O reload policy", () => {
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
});
