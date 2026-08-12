import { describe, expect, it, vi } from "vitest";
import {
  activateLinnstrumentUserFirmware,
  attachLinnstrumentLedDriver,
  deactivateLinnstrumentUserFirmware,
  detachLinnstrumentLedDriver,
  isLinnstrumentUserFirmwareEligible,
  sendLinnstrumentNrpn245,
} from "./linnstrument-user-firmware.js";

describe("linnstrument-user-firmware", () => {
  it("sends NRPN 245 using the LinnStrument six-CC sequence", () => {
    const send = vi.fn();
    sendLinnstrumentNrpn245({ send }, 1);
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      [0xb0, 99, 1],
      [0xb0, 98, 117],
      [0xb0, 6, 0],
      [0xb0, 38, 1],
      [0xb0, 101, 127],
      [0xb0, 100, 127],
    ]);
  });

  it("activates UF mode, enables LED sync, and triggers Auto Send when enabled", () => {
    const send = vi.fn();
    const keys = {
      linnstrumentLEDs: { userFirmwareActive: false },
      settings: { linnstrument_led_sync: true },
      syncLinnstrumentLEDs: vi.fn(),
    };
    const activated = activateLinnstrumentUserFirmware({ send }, keys);

    expect(activated).toBe(true);
    expect(keys.linnstrumentLEDs.userFirmwareActive).toBe(true);
    expect(keys.syncLinnstrumentLEDs).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalled();
  });

  it("deactivates UF mode and clears LED gating", () => {
    const send = vi.fn();
    const keys = {
      linnstrumentLEDs: { userFirmwareActive: true },
    };
    deactivateLinnstrumentUserFirmware({ send }, keys);

    expect(keys.linnstrumentLEDs.userFirmwareActive).toBe(false);
    expect(send.mock.calls.slice(0, 6).map((call) => call[0])).toEqual([
      [0xb0, 99, 1],
      [0xb0, 98, 117],
      [0xb0, 6, 0],
      [0xb0, 38, 0],
      [0xb0, 101, 127],
      [0xb0, 100, 127],
    ]);
  });

  it("attaches and detaches the LED driver through the UF module", () => {
    const send = vi.fn();
    const keys = { linnstrumentLEDs: null };
    const leds = attachLinnstrumentLedDriver({ send }, keys);

    expect(leds).toBeTruthy();
    expect(keys.linnstrumentLEDs).toBe(leds);

    detachLinnstrumentLedDriver(leds, keys);
    expect(keys.linnstrumentLEDs).toBeNull();
  });

  it("gates eligibility on LinnStrument geometry mode only", () => {
    expect(
      isLinnstrumentUserFirmwareEligible({
        controllerId: "linnstrument",
        scaleMode: false,
        midiPassthrough: false,
        midiinDevice: "abc",
      }),
    ).toBe(true);
    expect(
      isLinnstrumentUserFirmwareEligible({
        controllerId: "linnstrument",
        scaleMode: false,
        midiPassthrough: true,
        midiinDevice: "abc",
      }),
    ).toBe(false);
    expect(
      isLinnstrumentUserFirmwareEligible({
        controllerId: "linnstrument",
        scaleMode: true,
        midiPassthrough: false,
        midiinDevice: "abc",
      }),
    ).toBe(false);
    expect(
      isLinnstrumentUserFirmwareEligible({
        controllerId: "exquis",
        scaleMode: false,
        midiPassthrough: false,
        midiinDevice: "abc",
      }),
    ).toBe(false);
    expect(
      isLinnstrumentUserFirmwareEligible({
        controllerId: "linnstrument",
        scaleMode: false,
        midiPassthrough: false,
        midiinDevice: "OFF",
      }),
    ).toBe(false);
  });
});
