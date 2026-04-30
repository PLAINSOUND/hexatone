import {
  HSVtoRGB2,
  nameToHex,
  hex2rgb,
  rgb2hsv,
  rgbToHex,
} from "./color_utils";
import { buildLinnstrumentDegreeMap, LINNS_OFF } from "../controllers/linnstrument-config.js";
import {
  transferColor,
  LUMATONE_TONIC,
  LUMATONE_TONIC_OTHER,
} from "../settings/scale/color-transfer.js";

export function updateColors(colors) {
  this.settings.note_colors = colors.note_colors;
  this.settings.spectrum_colors = colors.spectrum_colors;
  this.settings.fundamental_color = colors.fundamental_color;

  this.scheduleGridRedraw();

  // Controller LED queues collapse rapid color drags to the latest state.
  if (this.lumatoneLEDs && this.controllerMap && this.settings.lumatone_led_sync) {
    this.lumatoneLEDs.sendAll(this._buildLumatoneColorEntries());
  }

  if (this.exquisLEDs && this.settings.exquis_led_sync) {
    this.exquisLEDs.sendColors(this._buildExquisColorArray());
  }

  if (this.linnstrumentLEDs && this.settings.linnstrument_led_sync) {
    this.linnstrumentLEDs.updatePaletteValues(this._buildLinnstrumentColorArray());
  }
}

export function syncLumatoneLEDs() {
  if (this.lumatoneLEDs && this.controllerMap) {
    this.lumatoneLEDs.sendAll(this._buildLumatoneColorEntries());
  }
}

export function syncExquisLEDs() {
  if (this.exquisLEDs && this.controllerMap) {
    this.exquisLEDs.sendColors(this._buildExquisColorArray());
  }
}

export function syncLinnstrumentLEDs() {
  if (this.linnstrumentLEDs && this.controllerMap) {
    this.linnstrumentLEDs.sendPaletteValues(this._buildLinnstrumentColorArray());
  }
}

export function buildLinnstrumentColorArray() {
  const degreeColors = new Map();
  for (const [, coords] of this.controllerMap) {
    const [cents, reducedSteps] = this.hexCoordsToCents(coords);
    if (!degreeColors.has(reducedSteps)) {
      degreeColors.set(reducedSteps, this._getScreenHexColor(cents, reducedSteps));
    }
  }

  const degreeMap = buildLinnstrumentDegreeMap(degreeColors);
  const values = new Array(128).fill(LINNS_OFF);
  for (const [mapKey, coords] of this.controllerMap) {
    const dot = mapKey.indexOf(".");
    const ch = parseInt(mapKey.slice(0, dot), 10);
    const col = parseInt(mapKey.slice(dot + 1), 10);
    const note = (ch - 1) * 16 + (col - 1);
    if (note < 0 || note > 127) continue;
    const [, reducedSteps] = this.hexCoordsToCents(coords);
    values[note] = degreeMap.get(reducedSteps) ?? LINNS_OFF;
  }
  return values;
}

export function sendLumatoneLayout() {
  if (!this.lumatoneLEDs) return;

  const entries = [];
  for (let b = 1; b <= 5; b++) {
    for (let k = 0; k < 56; k++) {
      entries.push({
        board: b,
        key: k,
        note: k,
        channel: b - 1,
        hexColor: "#000000",
      });
    }
  }

  this.lumatoneLEDs.sendLayout(entries, [{ cmd: 0x0e, board: 0, value: 1 }]);
}

export function buildLumatoneColorEntries() {
  const entries = [];
  for (const [mapKey, coords] of this.controllerMap) {
    const dotIdx = mapKey.indexOf(".");
    const board = parseInt(mapKey.slice(0, dotIdx), 10);
    const key = parseInt(mapKey.slice(dotIdx + 1), 10);
    const hexColor = this._getLumatoneHexColor(coords);
    entries.push({ board, key, hexColor });
  }
  return entries;
}

export function buildExquisColorArray() {
  const colors = new Array(61).fill("#000000");

  if (this.inputRuntime?.layoutMode === "sequential") {
    const scale = this.tuning.scale || [];
    const len = scale.length;
    if (len === 0) return colors;

    const anchorNote = this.settings.midiin_central_degree ?? 60;
    const centerDegree = this.settings.center_degree || 0;

    for (let note = 0; note <= 60; note++) {
      let steps = note - anchorNote + centerDegree;
      let octs = Math.trunc(steps / len);
      let reducedSteps = steps % len;
      if (reducedSteps < 0) {
        reducedSteps += len;
        octs -= 1;
      }
      const cents = octs * this.tuning.equivInterval + scale[reducedSteps];
      if (reducedSteps === 0) {
        colors[note] = octs === 0 ? LUMATONE_TONIC : LUMATONE_TONIC_OTHER;
      } else {
        colors[note] = transferColor(this._getScreenHexColor(cents, reducedSteps));
      }
    }
    return colors;
  }

  for (const [mapKey, coords] of this.controllerMap) {
    const note = parseInt(mapKey.slice(mapKey.indexOf(".") + 1), 10);
    if (note >= 0 && note <= 60) {
      colors[note] = this._getLumatoneHexColor(coords);
    }
  }
  return colors;
}

export function getLumatoneHexColor(coords) {
  const [cents, reducedSteps, , octs] = this.hexCoordsToCents(coords);

  if (reducedSteps === 0) {
    return octs === 0 ? LUMATONE_TONIC : LUMATONE_TONIC_OTHER;
  }

  const screenHex = this._getScreenHexColor(cents, reducedSteps);
  return transferColor(screenHex);
}

export function getScreenHexColor(cents, reducedSteps) {
  if (!this.settings.spectrum_colors) {
    const colors = this.settings.note_colors;
    if (!colors || typeof colors[reducedSteps] === "undefined") return "#edede4";
    return nameToHex(colors[reducedSteps]);
  }

  const fcolor = hex2rgb("#" + this.settings.fundamental_color);
  const hsv = rgb2hsv(fcolor[0], fcolor[1], fcolor[2]);
  let h = hsv.h / 360;
  const s = hsv.s / 100;
  const v = hsv.v / 100;
  let reduced = (cents / 1200) % 1;
  if (reduced < 0) reduced += 1;
  h = (reduced + h) % 1;
  const { red, green, blue } = HSVtoRGB2(h, s, v);
  return rgbToHex(red, green, blue);
}
