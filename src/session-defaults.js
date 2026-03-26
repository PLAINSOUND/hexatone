// Session-scoped output/input settings: restored from sessionStorage on every
// page load so device choices survive tab refresh without polluting the URL or
// localStorage. Keys here that are also in PRESET_SKIP_KEYS act as the
// fallback defaults when no preset is loaded.
const sessionDefaults = {
  output_sample:
    (sessionStorage.getItem("output_sample") ?? "true") !== "false",
  output_mts: sessionStorage.getItem("output_mts") === "true",
  output_mpe: sessionStorage.getItem("output_mpe") === "true",
  output_direct: sessionStorage.getItem("output_direct") === "true",
  output_osc: sessionStorage.getItem("output_osc") === "true",
  osc_bridge_url: sessionStorage.getItem("osc_bridge_url") || "ws://localhost:8089",
  fluidsynth_device: sessionStorage.getItem("fluidsynth_device") || "",
  fluidsynth_channel: sessionStorage.getItem("fluidsynth_channel") !== null
    ? parseInt(sessionStorage.getItem("fluidsynth_channel")) : -1,
  direct_device: sessionStorage.getItem("direct_device") || "OFF",
  direct_channel: parseInt(sessionStorage.getItem("direct_channel")) || -1,
  direct_sysex_auto: sessionStorage.getItem("direct_sysex_auto") === "true",
  direct_device_id: parseInt(sessionStorage.getItem("direct_device_id")) || 127,
  direct_tuning_map_number: parseInt(sessionStorage.getItem("direct_tuning_map_number")) || 0,
  mpe_device: sessionStorage.getItem("mpe_device") || "OFF",
  mpe_master_ch: sessionStorage.getItem("mpe_master_ch") || "1",
  mpe_lo_ch: parseInt(sessionStorage.getItem("mpe_lo_ch")) || 2,
  mpe_hi_ch: parseInt(sessionStorage.getItem("mpe_hi_ch")) || 8,
  mpe_mode: sessionStorage.getItem("mpe_mode") || "Ableton_workaround",
  mpe_pitchbend_range:
    parseInt(sessionStorage.getItem("mpe_pitchbend_range")) || 48,
  mpe_pitchbend_range_manager:
    parseInt(sessionStorage.getItem("mpe_pitchbend_range_manager")) || 2,
  instrument: sessionStorage.getItem("instrument") || "HvP8_retuned",
  midiin_device: sessionStorage.getItem("midiin_device") || "OFF",
  midiin_channel: parseInt(sessionStorage.getItem("midiin_channel")) || 0,
  midiin_steps_per_channel: sessionStorage.getItem("midiin_steps_per_channel") !== null
    ? parseInt(sessionStorage.getItem("midiin_steps_per_channel")) : null,
  midiin_anchor_channel: sessionStorage.getItem("midiin_anchor_channel") !== null
    ? parseInt(sessionStorage.getItem("midiin_anchor_channel")) : 1,
  controller_anchor_note: sessionStorage.getItem("controller_anchor_note") !== null
    ? parseInt(sessionStorage.getItem("controller_anchor_note")) : null,
  midiin_channel_legacy: sessionStorage.getItem("midiin_channel_legacy") !== null
    ? sessionStorage.getItem("midiin_channel_legacy") === 'true' : true,
  midi_passthrough: sessionStorage.getItem("midi_passthrough") === 'true',
  midi_device: sessionStorage.getItem("midi_device") || "OFF",
  midi_channel: parseInt(sessionStorage.getItem("midi_channel")) || 0,
  midi_mapping: sessionStorage.getItem("midi_mapping") || "MTS1",
  midi_velocity: parseInt(sessionStorage.getItem("midi_velocity")) || 72,
  sysex_type: parseInt(sessionStorage.getItem("sysex_type")) || 126,
  device_id: parseInt(sessionStorage.getItem("device_id")) || 127,
  tuning_map_number: parseInt(sessionStorage.getItem("tuning_map_number")) || 0,
  fundamental_color:
    parseInt(sessionStorage.getItem("fundamental_color")) || "#f2e3e3",
  spectrum_colors: true,
  key_labels: "no_labels",
  retuning_mode: 'recalculate_reference',  // or 'transpose_scale'
  axis49_center_note: 53,
  wheel_to_recent: false,
  midi_wheel_range: sessionStorage.getItem('midi_wheel_range') || '9/8',
  wheel_scale_aware: sessionStorage.getItem('wheel_scale_aware') === 'true',
  lumatone_center_channel: 3,
  lumatone_center_note: 26,
  lumatone_led_sync: sessionStorage.getItem('lumatone_led_sync') === 'true',
  fundamental: 260.740741,
  reference_degree: 0,
  equivSteps: 12,
  scale: [
    "100.0",
    "200.0",
    "300.0",
    "400.0",
    "500.0",
    "600.0",
    "700.0",
    "800.0",
    "900.0",
    "1000.0",
    "1100.0",
    "1200.0",
  ],
  rSteps: 2,
  drSteps: 1,
  center_degree: 0,
  hexSize: 42,
  rotation: -16.102113751,
};

export default sessionDefaults;
