import { WebMidi } from "webmidi";
import {
  computeNaturalAnchor,
  computeCenterPitchHz,
  chooseStaticMapCenterMidi,
  computeStaticMapDegree0,
} from "../tuning/center-anchor.js";
import { mtsTuningMap } from "../tuning/tuning-map.js";
import { resolveBulkDumpName } from "../tuning/mts-format.js";
import { collectSoundingHexes } from "../keyboard/sounding-note-runtime.js";

const BULK_RELEASE_PROTECT_MS = 750;

export function mtsSendMap(midiOutput, protectHeld = true, protectRecentReleased = true) {
  const output = midiOutput || this.midiout_data;
  if (!output) return;

  const isMtsBulkOutput =
    this.settings.output_mts_bulk &&
    this.settings.mts_bulk_device &&
    this.settings.mts_bulk_device !== "OFF" &&
    output.id === this.settings.mts_bulk_device;
  const sysexType = isMtsBulkOutput ? 126 : 127;
  const tuningMap = isMtsBulkOutput
    ? mtsTuningMap(
        126,
        this.settings.mts_bulk_device_id ?? 127,
        this.settings.mts_bulk_tuning_map_number ?? 0,
        this.settings.mts_bulk_mode === "static"
          ? computeStaticMapDegree0(
              chooseStaticMapCenterMidi(
                computeCenterPitchHz(
                  this.settings.fundamental,
                  this.tuning.degree0toRef_asArray[0],
                  this.tuning.scale,
                  this.tuning.equivInterval,
                  this.settings.center_degree,
                ),
              ),
              this.settings.center_degree,
            )
          : computeNaturalAnchor(
              this.settings.fundamental,
              this.tuning.degree0toRef_asArray[0],
              this.tuning.scale,
              this.tuning.equivInterval,
              this.settings.center_degree,
            ),
        this.tuning.scale,
        resolveBulkDumpName(
          this.settings.mts_bulk_tuning_map_name,
          this.settings.short_description,
          this.settings.name,
        ),
        this.tuning.equivInterval,
        this.settings.fundamental,
        this.tuning.degree0toRef_asArray,
        this.settings.octave_offset || 0,
      )
    : this.mts_tuning_map;

  if (sysexType === 127) {
    for (let i = 0; i < 128; i++) {
      const msg = [...tuningMap[i]];
      const manufacturer = msg.shift();
      output.sendSysex([manufacturer], msg);
    }
  } else if (sysexType === 126) {
    const sustainedSlots = new Map();
    if (protectHeld) {
      for (const hex of this._collectProtectedBulkHexes(protectRecentReleased)) {
        if (hex.mts && hex.mts.length >= 4 && !sustainedSlots.has(hex.mts[0])) {
          sustainedSlots.set(hex.mts[0], [hex.mts[1], hex.mts[2], hex.mts[3]]);
        }
      }
    }

    const msg = [...tuningMap];
    const headerLen = 21;
    let patched = false;
    for (const [slot, tuning] of sustainedSlots) {
      const skip = headerLen + slot * 3;
      if (skip + 2 < msg.length - 1) {
        msg[skip] = tuning[0];
        msg[skip + 1] = tuning[1];
        msg[skip + 2] = tuning[2];
        patched = true;
      }
    }

    if (patched) {
      let checksum = 0;
      for (let i = 1; i < msg.length - 1; i++) checksum ^= msg[i];
      msg[msg.length - 1] = checksum & 0x7f;
    }

    output.send([0xf0, ...msg, 0xf7]);
  }
}

export function hasRecentReleasedBulkTargets() {
  return this._recentlyReleasedHexes.size > 0;
}

export function collectProtectedBulkHexes(includeRecentReleased = true) {
  return collectSoundingHexes(this.state, {
    includeRecentReleased,
    recentReleasedHexes: this._recentlyReleasedHexes,
  });
}

export function hasDeferredBulkTargets() {
  return (
    this.settings.output_mts_bulk &&
    this.settings.mts_bulk_device &&
    this.settings.mts_bulk_device !== "OFF"
  );
}

export function sendBulkDumpOctaveRefresh(protectHeld = true, protectRecentReleased = true) {
  if (!this._hasDeferredBulkTargets()) return;
  const directOut = WebMidi.getOutputById(this.settings.mts_bulk_device);
  if (directOut) this.mtsSendMap(directOut, protectHeld, protectRecentReleased);
}

export function scheduleDeferredBulkRefresh() {
  if (!this._deferredBulkMapRefresh) return;
  if (this._deferredBulkMapTimer != null) return;
  this._deferredBulkMapTimer = setTimeout(() => {
    this._deferredBulkMapTimer = null;
    if (!this._deferredBulkMapRefresh) return;
    this._sendBulkDumpOctaveRefresh(true);
    if (!this._hasSoundingNotes() && !this._hasRecentReleasedBulkTargets()) {
      this._deferredBulkMapRefresh = false;
    }
  }, 0);
}

export function trackRecentlyReleasedHex(hex) {
  if (!hex?.mts || hex.mts.length < 4 || !this._hasDeferredBulkTargets()) return;
  const existing = this._recentlyReleasedHexes.get(hex);
  if (existing != null) clearTimeout(existing);
  const timeoutId = setTimeout(() => {
    this._recentlyReleasedHexes.delete(hex);
  }, BULK_RELEASE_PROTECT_MS);
  this._recentlyReleasedHexes.set(hex, timeoutId);
}
