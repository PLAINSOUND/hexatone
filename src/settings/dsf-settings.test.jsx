import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import DsfSettings from "./dsf-settings.jsx";

beforeEach(() => sessionStorage.setItem("hexatone_dsf_collapsed", "false"));
afterEach(() => { cleanup(); localStorage.removeItem("dsf_iso226"); sessionStorage.removeItem("hexatone_dsf_collapsed"); });
it("replaces the ISO checkbox with a persisted percentage fader", () => {
  const onChange = vi.fn();
  const view = render(<DsfSettings settings={{ output_dsf: true, dsf_iso226: .5 }} onChange={onChange} />);
  expect(screen.queryByRole("checkbox", { name: /ISO/ })).toBeNull();
  const slider = screen.getByRole("slider", { name: "DSF ISO-226 compensation amount" });
  expect(slider.getAttribute("aria-valuenow")).toBe("0.5");
  expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
  fireEvent.keyDown(slider, { key: "Home" });
  expect(onChange).toHaveBeenLastCalledWith("dsf_iso226", 0);
  expect(localStorage.getItem("dsf_iso226")).toBe("0");
  view.rerender(<DsfSettings settings={{ output_dsf: true, dsf_iso226: 0 }} onChange={onChange} />);
  fireEvent.keyDown(slider, { key: "End" });
  expect(onChange).toHaveBeenLastCalledWith("dsf_iso226", 1);
});
it.each([["Pressure (Z)", "pressure"], ["Expression (Y/Mod/Foot)", "timbreResponse"]])(
  "replaces %s with a persisted amount fader", (label, key) => {
    const onChange = vi.fn();
    render(<DsfSettings settings={{ output_dsf: true, [`dsf_${key}`]: .37 }} onChange={onChange} />);
    expect(screen.queryByRole("checkbox", { name: label })).toBeNull();
    const slider = screen.getByRole("slider", { name: `DSF ${label}` });
    expect(Number(slider.getAttribute("aria-valuenow"))).toBeCloseTo(.37, 12);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(`dsf_${key}`, 0);
    expect(localStorage.getItem(`dsf_${key}`)).toBe("0");
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(`dsf_${key}`, 1);
    localStorage.removeItem(`dsf_${key}`);
  },
);
it("persists signed timbre envelope amount and independent zero-time stages", () => {
  const onChange = vi.fn();
  render(<DsfSettings settings={{ output_dsf: true }} onChange={onChange} />);
  const amount = screen.getByRole("slider", { name: "DSF Timbre peak offset" });
  expect(Number(amount.getAttribute("aria-valuenow"))).toBeCloseTo(-.5, 12);
  fireEvent.keyDown(amount, { key: "Home" });
  expect(onChange).toHaveBeenLastCalledWith("dsf_timbreAmount", -1);
  expect(localStorage.getItem("dsf_timbreAmount")).toBe("-1");
  for (const [label, key] of [["Timbre attack", "timbreAttack"], ["Timbre decay", "timbreDecay"], ["Timbre release", "timbreRelease"]]) {
    fireEvent.keyDown(screen.getByRole("slider", { name: `DSF ${label}` }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(`dsf_${key}`, 0);
    expect(localStorage.getItem(`dsf_${key}`)).toBe("0");
    localStorage.removeItem(`dsf_${key}`);
  }
  const sustain = screen.getByRole("slider", { name: "DSF Timbre sustain offset" });
  fireEvent.keyDown(sustain, { key: "End" });
  expect(onChange).toHaveBeenLastCalledWith("dsf_timbreSustain", 1);
  localStorage.removeItem("dsf_timbreSustain");
  localStorage.removeItem("dsf_timbreAmount");
});
it("places each envelope under its fader and hides bypassed controls without erasing them", () => {
  const onChange = vi.fn();
  const settings = { output_dsf: true, dsf_attack: 75, dsf_timbreAmount: .4 };
  const view = render(<DsfSettings settings={settings} onChange={onChange} />);
  const sliders = screen.getAllByRole("slider").map(node => node.getAttribute("aria-label"));
  expect(sliders.slice(0, 6)).toEqual(["DSF Volume", "DSF ISO-226 compensation amount", "DSF Attack", "DSF Decay", "DSF Sustain", "DSF Release"]);
  fireEvent.click(screen.getByRole("checkbox", { name: "Volume Envelope" }));
  expect(onChange).toHaveBeenLastCalledWith("dsf_volumeEnvelope", false);
  expect(localStorage.getItem("dsf_volumeEnvelope")).toBe("false");
  view.rerender(<DsfSettings settings={{ ...settings, dsf_volumeEnvelope: false }} onChange={onChange} />);
  expect(screen.queryByRole("slider", { name: "DSF Attack" })).toBeNull();
  expect(screen.getByRole("slider", { name: "DSF Timbre attack" })).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "Timbre ADSR" }));
  expect(onChange).toHaveBeenLastCalledWith("dsf_timbreEnvelope", false);
  view.rerender(<DsfSettings settings={{ ...settings, dsf_volumeEnvelope: false, dsf_timbreEnvelope: false }} onChange={onChange} />);
  expect(screen.queryByRole("slider", { name: "DSF Timbre peak offset" })).toBeNull();
  expect(screen.getByRole("slider", { name: "DSF Timbre" })).toBeTruthy();
  view.rerender(<DsfSettings settings={settings} onChange={onChange} />);
  expect(screen.getByRole("slider", { name: "DSF Attack" }).getAttribute("aria-valuenow")).toBe("75");
  expect(Number(screen.getByRole("slider", { name: "DSF Timbre peak offset" }).getAttribute("aria-valuenow"))).toBeCloseTo(.4, 12);
  localStorage.removeItem("dsf_volumeEnvelope");
  localStorage.removeItem("dsf_timbreEnvelope");
});
it("saves release velocity independently from velocity", () => {
  const onChange = vi.fn();
  render(<DsfSettings settings={{ output_dsf: true, dsf_velocity: false, dsf_releaseVelocity: true }} onChange={onChange} />);
  expect(screen.getByRole("slider", { name: "DSF Velocity → Volume" }).getAttribute("aria-valuenow")).toBe("0");
  const release = screen.getByRole("slider", { name: "DSF Release Velocity → Release" });
  expect(release.getAttribute("aria-valuenow")).toBe("1");
  fireEvent.keyDown(release, { key: "Home" });
  expect(onChange).toHaveBeenCalledExactlyOnceWith("dsf_releaseVelocityRelease", 0);
  expect(localStorage.getItem("dsf_releaseVelocityRelease")).toBe("0");
  localStorage.removeItem("dsf_releaseVelocityRelease");
});
it("uses direct expression controls without the Eagan-specific generator", () => {
  render(<DsfSettings settings={{ output_dsf: true, dsf_generateYZ: true }} onChange={vi.fn()} />);
  expect(screen.queryByRole("checkbox", { name: "Generate YZ" })).toBeNull();
  expect(screen.getByRole("slider", { name: "DSF Pressure (Z)" })).toBeTruthy();
  expect(screen.getByRole("slider", { name: "DSF Expression (Y/Mod/Foot)" })).toBeTruthy();
});

it("persists separate 0–100% velocity amounts", () => {
  const onChange = vi.fn();
  render(<DsfSettings settings={{ output_dsf: true }} onChange={onChange} />);
  expect(screen.queryByRole("checkbox", { name: "Velocity" })).toBeNull();
  for (const [label, key] of [["Volume", "velocityVolume"], ["Timbre", "velocityTimbre"], ["Attack", "velocityAttack"]]) {
    const slider = screen.getByRole("slider", { name: `DSF Velocity → ${label}` });
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(`dsf_${key}`, 0);
    expect(localStorage.getItem(`dsf_${key}`)).toBe("0");
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(`dsf_${key}`, 1);
    localStorage.removeItem(`dsf_${key}`);
  }
});

it("shows decimal base timbre and independent signed peak and sustain offsets", () => {
  const onChange = vi.fn();
  render(<DsfSettings settings={{ output_dsf: true, dsf_timbre: .25 }} onChange={onChange} />);
  expect(screen.getAllByText("0.25")).toHaveLength(2);
  for (const [label, key] of [["Timbre peak offset", "timbreAmount"], ["Timbre sustain offset", "timbreSustain"]]) {
    const slider = screen.getByRole("slider", { name: `DSF ${label}` });
    expect(slider.getAttribute("aria-valuemin")).toBe("-1");
    expect(slider.getAttribute("aria-valuemax")).toBe("1");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(`dsf_${key}`, -1);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(`dsf_${key}`, 1);
    localStorage.removeItem(`dsf_${key}`);
  }
});

it("shows the requested default sound and decimal volume range", () => {
  render(<DsfSettings settings={{ output_dsf: true }} onChange={vi.fn()} />);
  const volume = screen.getByRole("slider", { name: "DSF Volume" });
  expect(volume.getAttribute("aria-valuemin")).toBe("0");
  expect(volume.getAttribute("aria-valuemax")).toBe("1");
  const expected = { Volume: .25, "ISO-226 compensation amount": 0,
    Attack: 12, Decay: 1500, Sustain: 1.5, Release: 120,
    "Number of harmonic partials": 1024, Timbre: .25,
    "Timbre peak offset": -.5, "Timbre attack": 750, "Timbre decay": 5000,
    "Timbre sustain offset": -.75, "Timbre release": 2,
    "Velocity → Volume": .5, "Velocity → Timbre": .5, "Velocity → Attack": .5,
    "Release Velocity → Release": .5, "Pressure (Z)": .5, "Expression (Y/Mod/Foot)": .5 };
  for (const [label, value] of Object.entries(expected))
    expect(Number(screen.getByRole("slider", { name: `DSF ${label}` }).getAttribute("aria-valuenow"))).toBeCloseTo(value, 12);
  expect(screen.getByRole("checkbox", { name: "Volume Envelope" }).checked).toBe(true);
  expect(screen.getByRole("checkbox", { name: "Timbre ADSR" }).checked).toBe(true);
});

it("defaults to the compact controls, uses the shared animated toggle and remembers expansion", () => {
  sessionStorage.removeItem("hexatone_dsf_collapsed");
  const onChange = vi.fn();
  const settings = { output_dsf: true, dsf_attack: 75, dsf_timbreAmount: -.4 };
  const view = render(<DsfSettings settings={settings} onChange={onChange} />);
  const toggle = screen.getByRole("button", { name: "Show DSF settings" });
  expect(toggle.classList.contains("section-collapse-toggle")).toBe(true);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.querySelector(".disclosure-toggle-glyph--collapsed")).toBeTruthy();
  expect(screen.getAllByRole("slider").map(node => node.getAttribute("aria-label"))).toEqual([
    "DSF Volume", "DSF ISO-226 compensation amount", "DSF Number of harmonic partials", "DSF Timbre",
    "DSF Pressure (Z)", "DSF Expression (Y/Mod/Foot)",
  ]);
  expect(screen.getByRole("slider", { name: "DSF Pressure (Z)" })).toBeTruthy();
  expect(screen.getByRole("slider", { name: "DSF Expression (Y/Mod/Foot)" })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Volume Envelope" })).toBeNull();
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Hide DSF settings" }).getAttribute("aria-expanded")).toBe("true");
  expect(toggle.querySelector(".disclosure-toggle-glyph--expanded")).toBeTruthy();
  expect(screen.getByRole("slider", { name: "DSF Attack" }).getAttribute("aria-valuenow")).toBe("75");
  expect(Number(screen.getByRole("slider", { name: "DSF Timbre peak offset" }).getAttribute("aria-valuenow"))).toBeCloseTo(-.4, 12);
  expect(sessionStorage.getItem("hexatone_dsf_collapsed")).toBe("false");
  view.unmount();
  render(<DsfSettings settings={settings} onChange={onChange} />);
  expect(screen.getByRole("slider", { name: "DSF Attack" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide DSF settings" }));
  expect(screen.queryByRole("slider", { name: "DSF Attack" })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
