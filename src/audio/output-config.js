/**
 * Pure output construction plans. Keys describe engine identity, not live
 * expression controls. Port identity is supplied by the wiring lifetime's WeakMap;
 * it must never be persisted. Async adoption and current-control replay stay in
 * use-synth-wiring, so these plans neither open ports nor send messages.
 */
import { scalaToCents } from "../settings/scale/parse-scale";

export function sampleOutputConfig(settings, tuning) {
  const args = [settings.instrument, settings.fundamental, tuning.referenceDegree, tuning.scale];
  return { key: JSON.stringify(args), args };
}

export function monoOutputConfig(settings, tuning, output, portIdentity) {
  const args = {
    output,
    channel: settings.mono_channel ?? 0,
    bendRange: settings.mono_bend_range ?? 2,
    fundamental: settings.fundamental || 440,
    referenceCents: tuning.referenceDegree > 0
      ? scalaToCents(tuning.scale[tuning.referenceDegree - 1]) : 0,
    velocity: settings.midi_velocity ?? 72,
    // These three controls have live setters and do not invalidate the engine.
    portamento: !!settings.mono_portamento,
    time: settings.mono_portamento_time ?? 80,
    slideCc: settings.mono_slide_cc ?? 74,
  };
  return { key: JSON.stringify([portIdentity(output), args.channel, args.bendRange,
    args.fundamental, args.referenceCents, args.velocity]), args };
}

export function oscOutputConfig(settings, tuning) {
  const connection = [settings.osc_bridge_url || "ws://localhost:8089",
    settings.osc_synth_names || ["pluck", "string", "formant", "tone"]];
  const pitch = [settings.fundamental, tuning.referenceDegree, tuning.scale];
  return {
    key: JSON.stringify([...connection, ...pitch]),
    // Live controls are supplied at construction time, not captured in the key.
    args: controls => [...connection, controls.volumes, controls.quickRelease,
      controls.quickReleaseTime, controls.rasterOnly, ...pitch, 1,
      { sustainBuzzFormant: controls.sustain, retriggerBuzzFormant: controls.retrigger }],
  };
}

export function mpeOutputConfig(settings, tuning, output, portIdentity, haken = false) {
  const pitch = [settings.midiin_mpe_manager_ch, settings.mpe_lo_ch, settings.mpe_hi_ch,
    settings.fundamental, tuning.referenceDegree, tuning.centerDegree,
    settings.midiin_anchor_note, tuning.scale, haken ? "standard" : settings.mpe_mode,
    haken ? 96 : (settings.mpe_pitchbend_range ?? 48),
    haken ? 2 : (settings.mpe_pitchbend_range_manager ?? 2),
    tuning.equivSteps, tuning.equivInterval];
  return {
    key: JSON.stringify([portIdentity(output), ...pitch]),
    args: [output, ...pitch, undefined, undefined,
      !!settings.mpe_plus_output, !!settings.mpe_auto_generate_yz],
  };
}

export function mtsOutputConfig(settings, tuningRuntime, outputMode, portIdentity, getDynamicBulkConfig) {
  const bulk = ["bulk_dynamic_map", "bulk_static_map"].includes(outputMode.transportMode);
  const anchorNote = bulk ? outputMode.anchorNote : settings.midiin_anchor_note;
  const midiMapping = bulk ? "MTS_BULK" : outputMode.allocationMode === "mts2" ? "MTS2" : "MTS1";
  const args = {
    outputMode: { ...outputMode, anchorNote, midiMapping },
    tuningContext: {
      fundamental: tuningRuntime?.fundamental,
      degree0toRefAsArray: tuningRuntime?.degree0toRefAsArray,
      scale: tuningRuntime?.scale,
      equivInterval: tuningRuntime?.equivInterval,
      name: tuningRuntime?.name,
    },
    legacyInput: { midiin_device: settings.midiin_device, midiin_anchor_note: anchorNote },
    getDynamicBulkConfig: outputMode.transportMode === "bulk_dynamic_map" ? getDynamicBulkConfig : null,
  };
  // Exclude the native port and live callback; everything else is constructor data.
  const { output, ...mode } = args.outputMode;
  return { key: JSON.stringify([portIdentity(output), mode, args.tuningContext, args.legacyInput]), args };
}
