// This module owns canvas projection and drawing for the hex grid.
// It converts lattice coords into screen geometry, maintains the visible-grid
// caches, and renders labels/highlights. It does not resolve controller input
// or harmonic modulation state beyond reading the already-derived live settings.

import { applyMatrixToPoint } from "./matrix";
import Point from "./point";
import {
  rgb,
  HSVtoRGB,
  HSVtoRGB2,
  nameToHex,
  hex2rgb,
  rgb2hsv,
  getContrastYIQ,
  getContrastYIQ_2,
  rgbToHex,
} from "./color_utils";
import { displayLabelForDegree } from "./keys-display-runtime.js";

export function scheduleGridRedraw() {
  this._staticGridValid = false;
  if (this._gridRedrawRaf != null || this._gridRedrawTimer != null) return;
  const scheduleWhenSafe = () => {
    this._gridRedrawTimer = null;
    if (!this._isSoundInteractionIdle()) {
      this._gridRedrawTimer = setTimeout(scheduleWhenSafe, 25);
      return;
    }
    this._gridRedrawRaf = requestAnimationFrame(() => {
      this._gridRedrawRaf = null;
      this.drawGrid();
    });
  };
  this._gridRedrawTimer = setTimeout(scheduleWhenSafe, 0);
}

export function scheduleImmediateGridRedraw() {
  this._staticGridValid = false;
  if (this._gridRedrawTimer != null) {
    clearTimeout(this._gridRedrawTimer);
    this._gridRedrawTimer = null;
  }
  if (this._gridRedrawRaf != null) return;
  this._gridRedrawRaf = requestAnimationFrame(() => {
    this._gridRedrawRaf = null;
    this.drawGrid();
  });
}

export function coordKey(coords) {
  return `${coords.x},${coords.y}`;
}

export function buildHexGeometry(hex) {
  const hexCenter = this.hexCoordsToScreen(hex);
  const hexSize = Number(this.settings.hexSize) || 0;
  const shadowSize = hexSize + 3;
  const x = [];
  const y = [];
  const x2 = [];
  const y2 = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((2 * Math.PI) / 6) * (i + 0.5);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    x[i] = hexCenter.x + hexSize * cos;
    y[i] = hexCenter.y + hexSize * sin;
    x2[i] = hexCenter.x + shadowSize * cos;
    y2[i] = hexCenter.y + shadowSize * sin;
  }
  return { center: hexCenter, x, y, x2, y2 };
}

export function rebuildVisibleGridGeometry() {
  let max =
    this.state.centerpoint.x > this.state.centerpoint.y
      ? this.state.centerpoint.x / this.settings.hexSize
      : this.state.centerpoint.y / this.settings.hexSize;
  max = Math.floor(max);
  const ox = this.settings.centerHexOffset.x + (this.settings.runtime_display_offset_x ?? 0);
  const oy = this.settings.centerHexOffset.y + (this.settings.runtime_display_offset_y ?? 0);
  const coords = [];
  const geometry = new Map();
  for (let r = -max + ox; r < max + ox; r++) {
    for (let dr = -max + oy; dr < max + oy; dr++) {
      const coord = new Point(r, dr);
      coords.push(coord);
      geometry.set(this._coordKey(coord), this._buildHexGeometry(coord));
    }
  }
  this._visibleGridCoords = coords;
  this._hexGeometryCache = geometry;
  this._staticGridValid = false;
}

export function resizeStaticGridCanvas(width, height, transform) {
  if (typeof this.state.context?.drawImage !== "function") {
    this._staticGridCanvas = null;
    this._staticGridContext = null;
    this._staticGridUsable = false;
    this._staticGridValid = false;
    return;
  }
  if (!this._staticGridCanvas) {
    if (typeof OffscreenCanvas !== "undefined") {
      this._staticGridCanvas = new OffscreenCanvas(width, height);
    } else {
      this._staticGridCanvas = document.createElement("canvas");
    }
    this._staticGridContext = this._staticGridCanvas.getContext?.("2d") ?? null;
    this._staticGridUsable = !!this._staticGridContext;
  }
  if (!this._staticGridUsable) return;
  this._staticGridCanvas.width = width;
  this._staticGridCanvas.height = height;
  if (this._staticGridContext && transform) {
    this._staticGridContext.setTransform(
      transform[0],
      transform[1],
      transform[2],
      transform[3],
      transform[4],
      transform[5],
    );
  }
  this._staticGridValid = false;
}

export function drawStaticHex(coords, context = this.state.context) {
  const [cents, pressed_interval] = this.hexCoordsToCents(coords);
  const [color, text_color] = this.centsToColor(cents, false, pressed_interval);
  this.drawHex(coords, color, text_color, context);
}

export function ensureStaticGrid() {
  if (!this._visibleGridCoords.length) this._rebuildVisibleGridGeometry();
  if (!this._staticGridUsable) return false;
  if (this._staticGridValid && this._staticGridCanvas) return true;
  if (!this._staticGridCanvas || !this._staticGridContext) {
    const width = this.state.canvas.width || window.innerWidth;
    const height = this.state.canvas.height || window.innerHeight;
    this._resizeStaticGridCanvas(width, height, this._canvasTransform);
  }
  if (!this._staticGridContext) return false;
  this._staticGridContext.save();
  this._staticGridContext.setTransform(1, 0, 0, 1, 0, 0);
  this._staticGridContext.clearRect(0, 0, this._staticGridCanvas.width, this._staticGridCanvas.height);
  this._staticGridContext.restore();
  for (const coords of this._visibleGridCoords) {
    this._drawStaticHex(coords, this._staticGridContext);
  }
  this._staticGridValid = true;
  return true;
}

export function withMainIdentityTransform(draw) {
  const context = this.state.context;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  draw(context);
  context.restore();
}

export function copyStaticGridToMain() {
  if (!this._staticGridCanvas || typeof this.state.context?.drawImage !== "function") return false;
  this._withMainIdentityTransform((context) => {
    context.clearRect(0, 0, this.state.canvas.width, this.state.canvas.height);
    context.drawImage(this._staticGridCanvas, 0, 0);
  });
  return true;
}

export function restoreHexStaticBackground(coords) {
  if (!this._ensureStaticGrid()) return false;
  const geometry = this._hexGeometryCache.get(this._coordKey(coords)) ?? this._buildHexGeometry(coords);
  const bounds = this._hexPixelBounds(geometry, 28);
  const sx = Math.max(0, Math.floor(bounds.left));
  const sy = Math.max(0, Math.floor(bounds.top));
  const ex = Math.min(this.state.canvas.width, Math.ceil(bounds.right));
  const ey = Math.min(this.state.canvas.height, Math.ceil(bounds.bottom));
  const sw = Math.max(0, ex - sx);
  const sh = Math.max(0, ey - sy);
  if (!this._staticGridCanvas || sw === 0 || sh === 0 || typeof this.state.context?.drawImage !== "function") return false;
  this._withMainIdentityTransform((context) => {
    context.clearRect(sx, sy, sw, sh);
    context.drawImage(this._staticGridCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
  });
  return {
    left: sx,
    top: sy,
    right: sx + sw,
    bottom: sy + sh,
  };
}

export function transformCanvasPoint(x, y) {
  const m = this._canvasTransform;
  if (!m) return { x, y };
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

export function hexPixelBounds(geometry, pad = 0) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    points.push(this._transformCanvasPoint(geometry.x2[i], geometry.y2[i]));
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs) - pad,
    right: Math.max(...xs) + pad,
    top: Math.min(...ys) - pad,
    bottom: Math.max(...ys) + pad,
  };
}

export function redrawSoundingHexes() {
  const drawn = new Set();
  const drawPressed = (hex) => {
    if (!hex?.coords) return;
    const key = this._coordKey(hex.coords);
    if (drawn.has(key)) return;
    drawn.add(key);
    this._drawSoundingHex(hex);
  };
  for (const hex of this._allActiveHexes()) drawPressed(hex);
  for (const [hex] of this.state.sustainedNotes) drawPressed(hex);
}

export function redrawSoundingHexesInBounds(bounds) {
  const drawn = new Set();
  const overlaps = (hex) => {
    if (!hex?.coords) return false;
    const geometry = this._hexGeometryCache.get(this._coordKey(hex.coords)) ?? this._buildHexGeometry(hex.coords);
    const hexBounds = this._hexPixelBounds(geometry, 28);
    return !(
      hexBounds.right < bounds.left ||
      hexBounds.left > bounds.right ||
      hexBounds.bottom < bounds.top ||
      hexBounds.top > bounds.bottom
    );
  };
  const drawPressed = (hex) => {
    if (!overlaps(hex)) return;
    const key = this._coordKey(hex.coords);
    if (drawn.has(key)) return;
    drawn.add(key);
    this._drawSoundingHex(hex);
  };
  for (const hex of this._allActiveHexes()) drawPressed(hex);
  for (const [hex] of this.state.sustainedNotes) drawPressed(hex);
}

export function drawSoundingHex(hex) {
  if (!hex?.coords) return;
  const [cents, pressed_interval] = this._liveCentsForHex(hex, false);
  const [color, text_color] = this.centsToColor(cents, true, pressed_interval);
  this.drawHex(hex.coords, color, text_color, this.state.context, {
    frame: this._frameForSoundingHex(hex),
    geometryMode: this._geometryModeForSoundingHex(hex),
    labelSettings: this._labelSettingsForSoundingHex(hex),
  });
}

export function drawGrid() {
  if (this._ensureStaticGrid() && this._copyStaticGridToMain()) {
    this._redrawSoundingHexes();
    return;
  }
  if (!this._visibleGridCoords.length) this._rebuildVisibleGridGeometry();
  for (const coords of this._visibleGridCoords) {
    this.hexOff(coords);
  }
}

export function hexCoordsToScreen(hex) {
  const ox = this.settings.centerHexOffset.x + (this.settings.runtime_display_offset_x ?? 0);
  const oy = this.settings.centerHexOffset.y + (this.settings.runtime_display_offset_y ?? 0);
  const screenX =
    this.state.centerpoint.x +
    (hex.x - ox) * this.settings.hexWidth +
    ((hex.y - oy) * this.settings.hexWidth) / 2;
  const screenY = this.state.centerpoint.y + (hex.y - oy) * this.settings.hexVert;
  return new Point(screenX, screenY);
}

export function drawHex(p, c, current_text_color, context = this.state.context, options = {}) {
  const geometry = this._hexGeometryCache.get(this._coordKey(p)) ?? this._buildHexGeometry(p);
  const hexCenter = geometry.center;
  const { x, y, x2, y2 } = geometry;

  context.beginPath();
  context.moveTo(x[0], y[0]);
  for (let i = 1; i < 6; i++) context.lineTo(x[i], y[i]);
  context.closePath();
  context.fillStyle = c;
  context.fill();

  context.save();
  context.beginPath();
  context.moveTo(x[0], y[0]);
  for (let i = 1; i < 6; i++) context.lineTo(x[i], y[i]);
  context.closePath();
  context.clip();

  context.beginPath();
  context.moveTo(x2[0], y2[0]);
  for (let i = 1; i < 6; i++) context.lineTo(x2[i], y2[i]);
  context.closePath();
  context.strokeStyle = "darkgray";
  context.lineWidth = 5;
  context.shadowBlur = 15;
  context.shadowColor = "black";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.stroke();
  context.restore();

  context.beginPath();
  context.moveTo(x[0], y[0]);
  for (let i = 1; i < 6; i++) context.lineTo(x[i], y[i]);
  context.closePath();
  context.lineWidth = 1;
  context.lineJoin = "round";
  context.strokeStyle = "slategray";
  context.stroke();

  context.save();
  context.translate(hexCenter.x, hexCenter.y);
  context.rotate(-this.settings.rotation);
  context.fillStyle = getContrastYIQ(current_text_color);
  context.font = "29pt Plainsound Sans";
  context.textAlign = "center";
  context.textBaseline = "middle";

  const note = p.x * this.settings.rSteps + p.y * this.settings.drSteps;
  const equivSteps = this.tuning.scale.length;
  const equivMultiple = Math.floor(note / equivSteps);
  let reducedNote = note % equivSteps;
  if (reducedNote < 0) reducedNote = equivSteps + reducedNote;
  const labelSettings = options.labelSettings ?? this.settings;
  if (!labelSettings.no_labels || labelSettings.equaves) {
    const name = labelSettings.no_labels
      ? ""
      : displayLabelForDegree(reducedNote, {
        settings: labelSettings,
        frame: options.frame ?? this._activeFrame(),
        geometryMode: options.geometryMode ?? this._modulationState?.geometryMode,
        scaleLength: equivSteps,
        scale: this.tuning.scale,
      });

    if (name) {
      context.save();
      let scaleFactor = name.length > 3 ? 3.58 / name.length : 1;
      scaleFactor *= this.settings.hexSize / 46;
      context.scale(scaleFactor, scaleFactor);
      context.fillText(name, 0, 0);
      context.restore();
    }

    const scaleFactor = this.settings.hexSize / 50;
    context.scale(scaleFactor, scaleFactor);
    if (this.settings.equaves) {
      context.translate(12, -30);
      context.fillStyle = getContrastYIQ_2(current_text_color);
      context.font = "14pt Plainsound Sans";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(equivMultiple, 0, 0);
    }
  }

  context.restore();
}

export function centsToColor(cents, pressed, pressed_interval) {
  let returnColor;

  if (!this.settings.spectrum_colors) {
    const colors = this.settings.note_colors;
    if (!colors || typeof colors[pressed_interval] === "undefined") {
      returnColor = "#EDEDE4";
    } else {
      returnColor = colors[pressed_interval];
    }

    returnColor = nameToHex(returnColor);
    const current_text_color = returnColor;
    returnColor = hex2rgb(returnColor);

    if (pressed) {
      returnColor[0] += 200;
      returnColor[1] -= 200;
      returnColor[2] -= 200;
    }

    return [rgb(returnColor[0], returnColor[1], returnColor[2]), current_text_color];
  }

  let fcolor = hex2rgb("#" + this.settings.fundamental_color);
  fcolor = rgb2hsv(fcolor[0], fcolor[1], fcolor[2]);

  let h = fcolor.h / 360;
  const s = fcolor.s / 100;
  let v = fcolor.v / 100;

  let reduced = (cents / 1200) % 1;
  if (reduced < 0) reduced += 1;
  h = (reduced + h) % 1;

  v = pressed ? v - v / 2 : v;

  returnColor = HSVtoRGB(h, s, v);
  const tcolor = HSVtoRGB2(h, s, v);
  const current_text_color = rgbToHex(tcolor.red, tcolor.green, tcolor.blue);
  return [returnColor, current_text_color];
}

export function getHexCoordsAt(coords) {
  coords = applyMatrixToPoint(this.state.rotationMatrix, coords);
  const ox = this.settings.centerHexOffset.x + (this.settings.runtime_display_offset_x ?? 0);
  const oy = this.settings.centerHexOffset.y + (this.settings.runtime_display_offset_y ?? 0);
  const x = coords.x - this.state.centerpoint.x;
  const y = coords.y - this.state.centerpoint.y;

  let q = ((x * Math.sqrt(3)) / 3 - y / 3) / this.settings.hexSize;
  let r = (y * 2) / 3 / this.settings.hexSize;

  q = Math.round(q) + ox;
  r = Math.round(r) + oy;

  let minimum = 100000;
  let closestHex = new Point(q, r);
  for (let qOffset = -1; qOffset < 2; qOffset++) {
    for (let rOffset = -1; rOffset < 2; rOffset++) {
      const neighbour = new Point(q + qOffset, r + rOffset);
      const diff = this.hexCoordsToScreen(neighbour).minus(coords);
      const distance = diff.x * diff.x + diff.y * diff.y;
      if (distance < minimum) {
        minimum = distance;
        closestHex = neighbour;
      }
    }
  }

  return closestHex;
}
