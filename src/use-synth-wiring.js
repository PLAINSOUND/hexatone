import { useState, useEffect, useCallback } from "preact/hooks";
import { enableMidi } from "./settings/midi/midiin";
import { create_sample_synth } from "./sample_synth";
import { create_midi_synth } from "./midi_synth";
import create_mpe_synth from "./mpe_synth";
import { create_composite_synth } from "./composite_synth";
import { create_osc_synth } from "./osc_synth";
import { detectController } from "./controllers/registry.js";

// Functional updaters for the loading counter. Using a counter (not a boolean)
// lets multiple async operations overlap without prematurely hiding the spinner.
const wait   = (l) => l + 1;
const signal = (l) => l - 1;

/**
 * Manages all synth and MIDI lifecycle for the app:
 *   - Web MIDI initialisation and device-change tracking
 *   - Synth creation/teardown whenever settings or MIDI state changes
 *   - Octave-shift helpers
 *   - Volume control and anchor-note learning
 *   - Imperative propagation of fundamental changes to the live Keys canvas
 *
 * @param {object}   settings          - Current app settings
 * @param {function} setSettings       - Settings updater (used by onAnchorLearn)
 * @param {object}   options
 * @param {boolean}  options.ready             - True once the app is initialised
 * @param {boolean}  options.userHasInteracted - True after the first user gesture
 * @param {object}   options.keysRef           - Ref to the live Keys canvas instance
 * @param {object}   options.synthRef          - Ref kept in sync with the live synth
 *
 * @returns {{ synth, midi, midiTick, loading, midiLearnActive, setMidiLearnActive,
 *             octaveTranspose, octaveDeferred,
 *             shiftOctave, toggleOctaveDeferred,
 *             onVolumeChange, onAnchorLearn }}
 */
const useSynthWiring = (
  settings,
  setSettings,
  { ready, userHasInteracted, keysRef, synthRef },
) => {
  const [synth,           setSynth]           = useState(null);
  const [midi,            setMidi]            = useState(null);
  const [midiLearnActive, setMidiLearnActive] = useState(false);
  // Incremented on every MIDI onstatechange so dependent effects re-run when
  // devices connect or disconnect (e.g. FluidSynth starting after page load).
  const [midiTick,        setMidiTick]        = useState(0);
  // Counter so multiple overlapping async operations don't prematurely hide
  // the loading spinner (see wait / signal helpers above).
  const [loading,         setLoading]         = useState(0);
  const [octaveTranspose, setOctaveTranspose] = useState(0);
  const [octaveDeferred,  setOctaveDeferred]  = useState(
    () => sessionStorage.getItem("octave_deferred") === "true",
  );

  // ── MIDI access ─────────────────────────────────────────────────────────────

  useEffect(() => {
    // webmidi.js library init (used for device name helpers only)
    enableMidi().catch((err) =>
      console.warn("WebMidi could not initialise:", err),
    );

    if (navigator.requestMIDIAccess) {
      setLoading(wait);
      navigator.requestMIDIAccess({ sysex: true }).then((m) => {
        setLoading(signal);
        console.log("Web MIDI API with sysex for MTS messages is ready!");
        setMidi(m);
        // Re-render UI and re-run synth creation whenever MIDI devices change.
        m.onstatechange = () => setMidiTick((t) => t + 1);
      }, () => {
        console.log("Web MIDI API could not initialise!");
      });
    }
  }, []);

  // ── Synth creation ───────────────────────────────────────────────────────────
  // Reconstructs the composite synth whenever any relevant setting or MIDI
  // state changes. Runs only after the app is ready (setReady has fired).

  useEffect(() => {
    if (!ready) return;

    const wantSample =
      settings.output_sample &&
      settings.instrument &&
      settings.instrument !== "OFF" &&
      settings.fundamental;

    const wantMts =
      settings.output_mts &&
      midi &&
      settings.midi_device !== "OFF" &&
      settings.midi_channel >= 0 &&
      settings.midi_mapping &&
      settings.midi_mapping !== "DIRECT" &&
      typeof settings.midi_velocity === "number";

    // DIRECT: plain noteOns + pre-sent bulk map, independent port/channel
    const wantDirect =
      settings.output_direct &&
      midi &&
      settings.direct_device && settings.direct_device !== "OFF" &&
      settings.direct_channel >= 0 &&
      typeof settings.midi_velocity === "number";

    const wantMpe =
      settings.output_mpe &&
      midi &&
      settings.mpe_device !== "OFF" &&
      settings.mpe_lo_ch > 0 &&
      settings.mpe_hi_ch >= settings.mpe_lo_ch;

    // OSC → SuperCollider via local WebSocket bridge (node osc-bridge/index.js)
    const wantOsc =
      settings.output_osc &&
      settings.fundamental;

    // FluidSynth mirror — must be computed before the early-return guard below,
    // otherwise the TDZ reference to wantFluidsynth in that condition would throw
    // a ReferenceError whenever wantSample is false and no MIDI is configured.
    const fluidsynthOutputObj = midi && settings.fluidsynth_device
      ? midi.outputs.get(settings.fluidsynth_device) : null;
    const mtsPortIsFluidsynth = fluidsynthOutputObj &&
      settings.midi_device === settings.fluidsynth_device;
    const wantFluidsynth =
      !!fluidsynthOutputObj &&
      !mtsPortIsFluidsynth &&
      settings.fluidsynth_channel >= 0 &&
      typeof settings.midi_velocity === "number";

    if (!wantSample && !wantMts && !wantFluidsynth && !wantDirect && !wantMpe && !wantOsc) {
      setSynth(null);
      return;
    }

    setLoading(wait);
    const promises = [];

    if (wantSample) {
      promises.push(
        create_sample_synth(
          settings.instrument,
          settings.fundamental,
          settings.reference_degree,
          settings.scale,
        ),
      );
    }
    if (wantMts) {
      promises.push(
        create_midi_synth(
          settings.midiin_device,
          settings.midiin_central_degree,
          midi.outputs.get(settings.midi_device),
          settings.midi_channel,
          settings.midi_mapping,
          settings.midi_velocity,
          settings.fundamental,
          settings.sysex_type,
          settings.device_id,
        ),
      );
    }
    if (wantFluidsynth) {
      promises.push(
        create_midi_synth(
          settings.midiin_device,
          settings.midiin_central_degree,
          fluidsynthOutputObj,
          settings.fluidsynth_channel,
          settings.midi_mapping || "MTS1",
          settings.midi_velocity,
          settings.fundamental,
          settings.sysex_type,
          settings.device_id,
        ),
      );
    }
    if (wantDirect) {
      // Resolve the tuning-map anchor: controller anchor if set, otherwise
      // compute nearest MIDI note to the on-screen centre hex's frequency.
      const _d0RefCents = settings.reference_degree > 0
        ? (settings.scale[settings.reference_degree] || 0) : 0;
      const _degree0Midi = 69 + (1200 * Math.log2((settings.fundamental || 440) / 440) - _d0RefCents) / 100;
      const _cd = settings.center_degree || 0;
      const _scLen = settings.scale?.length || 12;
      const _octs = Math.floor(_cd / _scLen);
      const _red = ((_cd % _scLen) + _scLen) % _scLen;
      const _centerPitch = _octs * (settings.equivInterval || 1200) + (settings.scale?.[_red] || 0);
      const directAnchor = settings.midiin_central_degree
        ?? Math.max(0, Math.min(127, Math.round(_degree0Midi + _centerPitch / 100)));
      promises.push(
        create_midi_synth(
          settings.midiin_device,
          directAnchor,
          midi.outputs.get(settings.direct_device),
          settings.direct_channel,
          "DIRECT",
          settings.midi_velocity,
          settings.fundamental,
          126, // always non-RT bulk for DIRECT
          settings.direct_device_id ?? 127,
        ),
      );
    }
    if (wantOsc) {
      promises.push(
        create_osc_synth(
          settings.osc_bridge_url || "ws://localhost:8089",
          settings.osc_synth_names || ["pluck", "string", "formant", "tone"],
          settings.osc_volumes     || [0.5, 0.5, 0.5, 0.5],
          settings.fundamental,
          settings.reference_degree,
          settings.scale,
        ),
      );
    }
    if (wantMpe) {
      promises.push(
        create_mpe_synth(
          midi.outputs.get(settings.mpe_device),
          settings.mpe_master_ch,
          settings.mpe_lo_ch,
          settings.mpe_hi_ch,
          settings.fundamental,
          settings.reference_degree,
          settings.center_degree,
          settings.midiin_central_degree,
          settings.scale,
          settings.mpe_mode,
          settings.mpe_pitchbend_range ?? 48,
          settings.mpe_manager_pitchbend_range ?? 2,
          settings.equivSteps,
          settings.equivInterval,
        ),
      );
    }

    Promise.all(promises).then(async (synths) => {
      // Filter out null/undefined synths (e.g., MIDI device unavailable)
      const validSynths = synths.filter((s) => s != null);
      if (validSynths.length === 0) {
        setSynth(null);
        setLoading(signal);
        return;
      }
      const s =
        validSynths.length === 1
          ? validSynths[0]
          : create_composite_synth(validSynths);
      // Await prepare() before setting the synth AND before clearing the
      // loading state. This guarantees:
      //  1. decodedBuffers is set before the keyboard becomes interactive.
      //  2. The keyboard does not re-appear with the OLD synth while the new
      //     one is still being prepared — which would let the user click a note
      //     on the old synth, then have it cut off by Keys reconstruction when
      //     setSynth(new) arrives, producing a "peep".
      if (s.prepare && userHasInteracted) {
        await s.prepare();
      }
      setSynth(s);
      setLoading(signal);
    });
  }, [
    settings.instrument,
    // fundamental removed from deps — synth uses makeHex per note,
    // fundamental change is handled imperatively via updateFundamental
    settings.reference_degree,
    settings.scale,
    settings.midi_device,
    settings.midi_channel,
    settings.midi_mapping,
    settings.midi_velocity,
    settings.output_sample,
    settings.output_mts,
    settings.output_mpe,
    settings.output_direct,
    settings.output_osc,
    settings.direct_device,
    settings.direct_channel,
    settings.fluidsynth_device,
    settings.fluidsynth_channel,
    settings.mpe_device,
    settings.mpe_master_ch,
    settings.mpe_lo_ch,
    settings.mpe_hi_ch,
    settings.mpe_pitchbend_range,
    settings.mpe_mode,
    midi,
    midiTick,
  ]);

  // ── Imperative propagation ──────────────────────────────────────────────────

  // Keep synthRef in sync so volume control and preset loading can reach the
  // live synth without depending on the React render cycle.
  useEffect(() => {
    synthRef.current = synth;
  }, [synth]);

  // On first user interaction, prepare audio context (iOS/Safari requirement).
  useEffect(() => {
    if (userHasInteracted && synth && synth.prepare) {
      synth.prepare();
    }
  }, [userHasInteracted, synth]);

  // When fundamental changes (sidebar or preset), propagate to live Keys so
  // the canvas redraws note labels without a full reconstruction.
  useEffect(() => {
    if (keysRef.current?.updateFundamental)
      keysRef.current.updateFundamental(settings.fundamental);
  }, [settings.fundamental]);

  // ── Octave shift ────────────────────────────────────────────────────────────

  const shiftOctave = (dir) => {
    setOctaveTranspose((t) => t + dir);
    if (keysRef.current?.shiftOctave)
      keysRef.current.shiftOctave(dir, octaveDeferred);
  };

  const toggleOctaveDeferred = (e) => {
    e.stopPropagation();
    const next = !octaveDeferred;
    setOctaveDeferred(next);
    sessionStorage.setItem("octave_deferred", next);
  };

  // ── Volume / anchor learn ───────────────────────────────────────────────────

  const onVolumeChange = useCallback((volume, muted) => {
    if (synthRef.current && synthRef.current.setVolume) {
      synthRef.current.setVolume(muted ? 0 : volume);
    }
  }, []);

  // Called by keys.js when the user presses a key during MIDI-learn mode.
  // Saves the physical MIDI note as the new anchor for this controller and
  // updates midiin_central_degree so the controller map rebuilds immediately.
  const onAnchorLearn = useCallback((noteNum) => {
    setMidiLearnActive(false);
    // Store the raw physical MIDI note number directly.
    if (settings.midiin_device && settings.midiin_device !== "OFF" && midi) {
      const input = Array.from(midi.inputs.values()).find(
        (m) => m.id === settings.midiin_device,
      );
      if (input) {
        const ctrl = detectController(input.name.toLowerCase());
        if (ctrl) localStorage.setItem(`${ctrl.id}_anchor`, String(noteNum));
      }
    }
    sessionStorage.setItem("midiin_central_degree", String(noteNum));
    setSettings((s) => ({ ...s, midiin_central_degree: noteNum }));
  }, [settings.midiin_device, midi]);

  return {
    synth,
    midi,
    midiTick,
    loading,
    midiLearnActive,
    setMidiLearnActive,
    octaveTranspose,
    setOctaveTranspose,
    octaveDeferred,
    shiftOctave,
    toggleOctaveDeferred,
    onVolumeChange,
    onAnchorLearn,
  };
};

export default useSynthWiring;
