import { describe, it, expect } from "vitest";
import { calibrateLumatoneFoot, routeLumatoneTimbre as route } from "./lumatone-timbre.js";

const makeRuntime = (settings = {}) => ({
  settings: { midiin_device: "lumatone", ...settings },
  _controllerCCValues: new Map(),
});

describe("Lumatone timbre routing", () => {
  it("calibrates foot endpoints and scales monotonically within legal MIDI values", () => {
    expect([0, 17, 18, 125, 126, 127].map(calibrateLumatoneFoot)).toEqual([0, 0, 0, 127, 127, 127]);
    expect(calibrateLumatoneFoot(72)).toBe(64);
    for (let value = 1; value <= 127; value++) {
      expect(calibrateLumatoneFoot(value)).toBeGreaterThanOrEqual(calibrateLumatoneFoot(value - 1));
    }
  });
  it("preserves the default wheel path and ordinary foot CC", () => {
    const r = makeRuntime();
    expect(route(r, 1, 80)).toBe(1);
    expect(route(r, 4, 30)).toBe(4);
    expect(route(r, 74, 64)).toBe(74);
  });
  it("maps foot-only control to the wheel path and suppresses the wheel", () => {
    const r = makeRuntime({ lumatone_modwheel_timbre: false, lumatone_foot_timbre: true });
    expect(route(r, 1, 80)).toBeNull();
    expect(route(r, 4, 30)).toBe(1);
    expect(route(r, 4, 100)).toBe(1);
  });
  it("requires pickup in both directions without forwarding waiting values", () => {
    const r = makeRuntime({ lumatone_foot_timbre: true });
    expect(route(r, 1, 80)).toBe(1);
    expect(route(r, 4, 10)).toBeNull();
    expect(route(r, 4, 70)).toBeNull();
    expect(route(r, 4, 81)).toBe(1);
    expect(route(r, 4, 100)).toBe(1);
    expect(route(r, 1, 82)).toBeNull();
    expect(route(r, 1, 102)).toBe(1);
    expect(route(r, 4, 40)).toBeNull();
  });
  it("uses cached timbre for initial pickup and resets ownership on option changes", () => {
    const r = makeRuntime({ lumatone_foot_timbre: true });
    r._controllerCCValues.set(1, 60);
    expect(route(r, 4, 10)).toBeNull();
    expect(route(r, 4, 59)).toBe(1);
    r.settings.lumatone_modwheel_timbre = false;
    expect(route(r, 4, 20)).toBe(1);
  });
});
