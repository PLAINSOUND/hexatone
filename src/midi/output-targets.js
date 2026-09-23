/**
 * Enabled MIDI destinations for the independent panic/unload safety backstop.
 * Deduplicates port/channel pairs across output families. Channels returned here
 * are zero-based raw MIDI channels; MPE settings are converted from one-based.
 */
export function midiOutputTargets(settings = {}) {
  const targets = new Map();
  const add = (portId, channel) => {
    if (!portId || portId === "OFF" || channel == null || channel === "") return;
    const number = Number(channel);
    if (!Number.isInteger(number) || number < 0 || number > 15) return;
    const channels = targets.get(portId) ?? new Set();
    channels.add(number);
    targets.set(portId, channels);
  };
  if (settings.output_mts) {
    add(settings.midi_device, settings.midi_channel ?? 0);
    add(settings.fluidsynth_device, settings.fluidsynth_channel ?? 0);
  }
  if (settings.output_mts_bulk) add(settings.mts_bulk_device, settings.mts_bulk_channel ?? 0);
  if (settings.output_mono) add(settings.mono_device, settings.mono_channel ?? 0);
  if (settings.output_mpe) {
    add(settings.mpe_device, Number(settings.midiin_mpe_manager_ch ?? 1) - 1);
    const lo = Number(settings.mpe_lo_ch ?? 2);
    const hi = Number(settings.mpe_hi_ch ?? 15);
    if (Number.isInteger(lo) && Number.isInteger(hi) && lo >= 1 && hi <= 16) {
      for (let ch = lo; ch <= hi; ch++) add(settings.mpe_device, ch - 1);
    }
  }
  return [...targets].flatMap(([portId, channels]) =>
    [...channels].map((channel) => ({ portId, channel })),
  );
}
