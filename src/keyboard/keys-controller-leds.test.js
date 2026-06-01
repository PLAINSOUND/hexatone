import { describe, expect, it } from "vitest";
import {
  buildLinnstrumentColorArray,
  buildLumatoneBypassLayoutEntries,
  buildLumatoneColorEntries,
  sendLumatoneLayout,
} from "./keys-controller-leds.js";

describe("buildLinnstrumentColorArray", () => {
  it("colors degree 0 red on LinnStrument", () => {
    const values = buildLinnstrumentColorArray.call({
      settings: { center_degree: 9 },
      controllerMap: new Map([
        ["1.1", { x: 0, y: 0 }],
        ["1.2", { x: 1, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [0, coords.x === 0 ? 0 : 9];
      },
      _getScreenHexColor() {
        return "#ffffff";
      },
    });

    expect(values[0]).toBe(1);
    expect(values[1]).toBe(8);
  });
});

describe("buildLumatoneColorEntries", () => {
  it("blanks degrees outside the active Lumatone filter", () => {
    const entries = buildLumatoneColorEntries.call({
      settings: {
        lumatone_degree_filter_mode: "filter",
        lumatone_degree_filter: "0,7",
      },
      controllerMap: new Map([
        ["3.10", { x: 0, y: 0 }],
        ["3.11", { x: 1, y: 0 }],
        ["3.12", { x: 2, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [coords.x * 100, coords.x === 0 ? 0 : coords.x === 1 ? 4 : 7];
      },
      _getLumatoneHexColor(coords) {
        return coords.x === 1 ? "#123456" : "#abcdef";
      },
    });

    expect(entries).toEqual([
      { board: 3, key: 10, hexColor: "#abcdef" },
      { board: 3, key: 11, hexColor: "#000000" },
      { board: 3, key: 12, hexColor: "#abcdef" },
    ]);
  });

  it("blanks every key in All Keys Dark mode", () => {
    const entries = buildLumatoneColorEntries.call({
      settings: {
        lumatone_degree_filter_mode: "dark",
        lumatone_degree_filter: "",
      },
      controllerMap: new Map([
        ["3.10", { x: 0, y: 0 }],
        ["3.11", { x: 1, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [coords.x * 100, coords.x];
      },
      _getLumatoneHexColor() {
        return "#abcdef";
      },
    });

    expect(entries).toEqual([
      { board: 3, key: 10, hexColor: "#000000" },
      { board: 3, key: 11, hexColor: "#000000" },
    ]);
  });
});

describe("buildLumatoneBypassLayoutEntries", () => {
  it("maps the current 2D anchor key to MIDI note 60 on channel 4", () => {
    const payload = buildLumatoneBypassLayoutEntries.call({
      settings: {
        center_degree: 0,
        equivSteps: 12,
      },
      controllerMap: new Map([
        ["3.26", { x: 0, y: 0 }],
      ]),
      hexCoordsToCents() {
        return [0, 0, 0];
      },
      _getLumatoneHexColor() {
        return "#abcdef";
      },
    });

    expect(payload.entries).toEqual([
      { board: 3, key: 26, note: 60, channel: 3, keyType: 0x01, hexColor: "#abcdef" },
    ]);
    expect(payload.exactCount).toBe(1);
    expect(payload.disabledCount).toBe(0);
  });

  it("prefers channel 4 and nearby channels while spilling by equave when needed", () => {
    const payload = buildLumatoneBypassLayoutEntries.call({
      settings: {
        center_degree: 0,
        equivSteps: 12,
      },
      controllerMap: new Map([
        ["3.26", { x: 0, y: 0 }],
        ["3.27", { x: 1, y: 0 }],
        ["3.28", { x: 2, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [0, 0, coords.x === 0 ? 0 : coords.x === 1 ? 12 : 24];
      },
      _getLumatoneHexColor() {
        return "#abcdef";
      },
    });

    expect(payload.entries).toEqual([
      { board: 3, key: 26, note: 60, channel: 3, keyType: 0x01, hexColor: "#abcdef" },
      { board: 3, key: 27, note: 72, channel: 3, keyType: 0x01, hexColor: "#abcdef" },
      { board: 3, key: 28, note: 84, channel: 3, keyType: 0x01, hexColor: "#abcdef" },
    ]);
    expect(payload.exactCount).toBe(3);
  });

  it("shifts assigned channels when the Lumatone bypass anchor channel changes, without changing note numbers", () => {
    const payload = buildLumatoneBypassLayoutEntries.call({
      settings: {
        center_degree: 0,
        equivSteps: 12,
        midiin_anchor_channel: 5,
      },
      controllerMap: new Map([
        ["3.26", { x: 0, y: 0 }],
        ["3.27", { x: 1, y: 0 }],
      ]),
      hexCoordsToCents(coords) {
        return [0, 0, coords.x === 0 ? 0 : 12];
      },
      _getLumatoneHexColor() {
        return "#abcdef";
      },
    });

    expect(payload.entries).toEqual([
      { board: 3, key: 26, note: 60, channel: 4, keyType: 0x01, hexColor: "#abcdef" },
      { board: 3, key: 27, note: 72, channel: 4, keyType: 0x01, hexColor: "#abcdef" },
    ]);
  });

  it("disables keys when no exact bypass note fits in MIDI range", () => {
    const payload = buildLumatoneBypassLayoutEntries.call({
      settings: {
        center_degree: 0,
        equivSteps: 12,
      },
      controllerMap: new Map([
        ["3.26", { x: 0, y: 0 }],
      ]),
      hexCoordsToCents() {
        return [0, 0, 300];
      },
      _getLumatoneHexColor() {
        return "#abcdef";
      },
    });

    expect(payload.entries[0]).toMatchObject({
      board: 3,
      key: 26,
      note: 0,
      channel: 0,
      keyType: 0x10,
      hexColor: "#000000",
    });
    expect(payload.exactCount).toBe(0);
    expect(payload.disabledCount).toBe(1);
  });

  it("rebuilds a temporary 2D controller map when bypass mode has no live controllerMap", () => {
    const payload = buildLumatoneBypassLayoutEntries.call({
      settings: {
        midi_passthrough: true,
        midiin_anchor_note: 60,
        midiin_anchor_channel: 4,
        center_degree: 0,
        equivSteps: 12,
      },
      controller: {
        id: "lumatone",
        anchorDefault: 26,
        anchorChannelDefault: 3,
        modes: {
          layout2d: {
            defaultPrefs: {
              anchorNote: 26,
              anchorChannel: 3,
              midi_passthrough: false,
              midiin_mapping_target: "hex_layout",
            },
          },
          bypass: {
            defaultPrefs: {
              anchorNote: 60,
              anchorChannel: 4,
              midi_passthrough: true,
              midiin_mapping_target: "hex_layout",
            },
          },
        },
        resolveMode: (settings = {}) => (settings.midi_passthrough ? "bypass" : "layout2d"),
      },
      controllerMap: null,
      _buildControllerMapForSettings(nextSettings) {
        expect(nextSettings.midi_passthrough).toBe(false);
        expect(nextSettings.midiin_anchor_note).toBe(26);
        expect(nextSettings.midiin_anchor_channel).toBe(3);
        return new Map([["3.26", { x: 0, y: 0 }]]);
      },
      hexCoordsToCents() {
        return [0, 0, 0];
      },
      _getLumatoneHexColor() {
        return "#abcdef";
      },
    });

    expect(payload.entries).toEqual([
      { board: 3, key: 26, note: 60, channel: 3, keyType: 0x01, hexColor: "#abcdef" },
    ]);
    expect(payload.exactCount).toBe(1);
    expect(payload.disabledCount).toBe(0);
  });
});

describe("sendLumatoneLayout", () => {
  it("re-enables every key as note on/off when sending the blank 2D layout", () => {
    const sendLayout = (...args) => {
      sendLayout.calls.push(args);
    };
    sendLayout.calls = [];

    sendLumatoneLayout.call({
      lumatoneLEDs: { sendLayout },
    });

    const [entries, preamble] = sendLayout.calls[0];
    expect(entries).toHaveLength(280);
    expect(entries[0]).toMatchObject({
      board: 1,
      key: 0,
      note: 0,
      channel: 0,
      keyType: 0x01,
      hexColor: "#000000",
    });
    expect(preamble).toEqual([{ cmd: 0x0e, board: 0, value: 1 }]);
  });
});
