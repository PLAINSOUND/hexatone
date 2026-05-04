export const SETTINGS_IMPACT_FIELDS = {
  tuning: [
    "scale",
    "equivSteps",
    "reference_degree",
    "fundamental",
  ],
  layout: [
    "rSteps",
    "drSteps",
    "center_degree",
    "hexSize",
    "rotation",
  ],
  labels: [
    "note_names",
    "key_labels",
    "show_equaves",
    "heji_anchor_label",
    "heji_anchor_ratio",
    "heji_show_cents",
    "heji_tempered_only",
  ],
  colors: [
    "note_colors",
    "spectrum_colors",
    "fundamental_color",
  ],
  inputBinding: [],
  inputRuntime: [
    "midiin_device",
    "midiin_steps_per_channel",
    "midiin_channel_group_size",
    "midiin_anchor_channel",
    "midiin_central_degree",
    "midiin_channel_legacy",
    "midiin_controller_override",
    "midiin_mapping_target",
    "midiin_mpe_input",
    "midiin_bend_flip",
    "midiin_bend_range",
    "linnstrument_channel_allocation",
    "linnstrument_pitch_bend_mode",
    "linnstrument_pitch_bend_shape",
    "linnstrument_x_spike_reduction",
    "linnstrument_x_input_smoothing",
    "midiin_scale_bend_range",
    "midiin_scale_tolerance",
    "midiin_scale_fallback",
    "midiin_pitchbend_mode",
    "midiin_pressure_mode",
    "midiin_modwheel_source",
    "midiin_modwheel_value",
    "midi_passthrough",
    "controller_anchor_note",
    "axis49_center_note",
    "tonalplexus_input_mode",
    "wheel_to_recent",
    "wheel_scale_aware",
    "midi_wheel_semitones",
    "lumatone_center_channel",
    "lumatone_center_note",
    "lumatone_led_sync",
    "exquis_led_sync",
    "linnstrument_led_sync",
    "modulation_style",
  ],
  outputRuntime: [
    "instrument",
    "output_sample",
    "output_mts",
    "output_mpe",
    "output_mts_bulk",
    "output_osc",
    "midi_device",
    "midi_channel",
    "midi_mapping",
    "midi_velocity",
    "sysex_auto",
    "sysex_type",
    "device_id",
    "tuning_map_number",
    "mts_bulk_device",
    "mts_bulk_mode",
    "mts_bulk_channel",
    "mts_bulk_sysex_auto",
    "mts_bulk_device_id",
    "mts_bulk_tuning_map_number",
    "mts_bulk_tuning_map_name",
    "fluidsynth_device",
    "fluidsynth_channel",
    "mpe_device",
    "mpe_manager_ch",
    "mpe_lo_ch",
    "mpe_hi_ch",
    "mpe_pitchbend_range",
    "mpe_pitchbend_range_manager",
    "mpe_mode",
    "fluidsynth_out_port",
    "osc_bridge_url",
  ],
};

// Settings that are intentionally not part of Keys impact decisions. Keeping
// this list explicit makes new persistence keys fail registry coverage tests
// until their rendering/runtime impact is classified.
export const SETTINGS_IMPACT_IGNORED_FIELDS = {
  presetMetadata: [
    "name",
    "description",
    "short_description",
  ],
  scaleEditorOnly: [
    "retuning_mode",
  ],
  inputUiOnly: [
    "midiin_mpe_lo_ch",
    "midiin_mpe_hi_ch",
  ],
  synthRuntimeOnly: [
    "osc_volume_pluck",
    "osc_volume_buzz",
    "osc_volume_formant",
    "osc_volume_saw",
  ],
  permissionState: [
    "webmidi_enabled",
    "webmidi_sysex_enabled",
    "webmidi_access",
  ],
  ledDriverLifecycle: [
    "lumatone_out_port",
    "exquis_out_port",
    "linnstrument_out_port",
    "exquis_led_luminosity",
    "exquis_led_saturation",
  ],
};

export const SETTINGS_IMPACT_GROUPS = {
  structural: [
    ...SETTINGS_IMPACT_FIELDS.tuning,
    ...SETTINGS_IMPACT_FIELDS.layout,
    ...SETTINGS_IMPACT_FIELDS.labels,
  ],
  keysReconstruction: [
    ...SETTINGS_IMPACT_FIELDS.tuning,
    ...SETTINGS_IMPACT_FIELDS.layout,
    ...SETTINGS_IMPACT_FIELDS.inputBinding,
  ],
  musicalSurfaceReset: [
    ...SETTINGS_IMPACT_FIELDS.tuning,
    ...SETTINGS_IMPACT_FIELDS.layout,
  ],
  colors: SETTINGS_IMPACT_FIELDS.colors,
  inputRuntime: SETTINGS_IMPACT_FIELDS.inputRuntime,
  outputRuntime: SETTINGS_IMPACT_FIELDS.outputRuntime,
};

export function settingsImpactSnapshot(settings, group, extra = {}) {
  const fields = SETTINGS_IMPACT_GROUPS[group] ?? SETTINGS_IMPACT_FIELDS[group];
  if (!fields) throw new Error(`Unknown settings impact group: ${group}`);
  const snapshot = {};
  for (const field of fields) snapshot[field] = settings?.[field];
  return { ...snapshot, ...extra };
}

export function settingsImpactKey(settings, group, extra = {}) {
  return JSON.stringify(settingsImpactSnapshot(settings, group, extra));
}
