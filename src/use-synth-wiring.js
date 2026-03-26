import { useState, useEffect, useCallback } from "preact/hooks";
import { enableMidi } from "./settings/midi/midiin";
import { create_sample_synth } from "./sample_synth";
import { create_midi_synth } from "./midi_synth";
import create_mpe_synth from "./mpe_synth";
import { create_composite_synth } from "./composite_synth";
import { create_osc_synth } from "./osc_synth";
import { detectController } from "./controllers/registry.js";
import { computeNaturalAnchor } from "./keyboard/mts-helpers.js";

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
      // Tuning-map anchor is always derived from the musical content — the hex grid
      // is the shared reference between output and input. midiin_central_degree is
      // a hardware input setting and must not influence the output carrier mapping.
      const directAnchor = computeNaturalAnchor(
        settings.fundamental,
        settings.degree0toRef_asArray?.[0] ?? 0,
        settings.scale,
        settings.equivInterval,
        settings.center_degree,
      );
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
  // Saves the anchor note + channel so the controller map (2D path) and the
  // step-arithmetic path (sequential/unknown) both resolve correctly.
  const onAnchorLearn = useCallback((noteNum, channel) => {
    setMidiLearnActive(false);
    const ch = channel ?? 1;
    let ctrl = null;
    if (settings.midiin_device && settings.midiin_device !== "OFF" && midi) {
      const input = Array.from(midi.inputs.values()).find(
        (m) => m.id === settings.midiin_device,
      );
      if (input) ctrl = detectController(input.name.toLowerCase());
    }

    // Persist anchor note per controller (for restore on reconnect).
    if (ctrl) {
      localStorage.setItem(`${ctrl.id}_anchor`, String(noteNum));
      // For channel-aware controllers (e.g. Lumatone): also save anchor channel.
      if (ctrl.anchorChannelDefault != null) {
        localStorage.setItem(`${ctrl.id}_anchor_channel`, String(ch));
      }
    }

    // midiin_anchor_channel drives the relative channel-offset formula in
    // noteToSteps() for all paths (sequential, unknown, passthrough).
    // For the Lumatone 2D-map path, lumatone_center_channel is also updated.
    const update = {
      midiin_central_degree: noteNum,
      midiin_anchor_channel: ch,
    };
    sessionStorage.setItem("midiin_central_degree", String(noteNum));
    sessionStorage.setItem("midiin_anchor_channel", String(ch));
    if (ctrl?.anchorChannelDefault != null) {
      update.lumatone_center_channel = ch;
      sessionStorage.setItem("lumatone_center_channel", String(ch));
    }
    setSettings((s) => ({ ...s, ...update }));
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
