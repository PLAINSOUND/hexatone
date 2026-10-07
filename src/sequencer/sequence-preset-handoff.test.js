import { expect, it, vi } from "vitest";
import seeds from "./preset-sequences/marc-sabat/Seeds-of-Skies-Alibis.json";
import { create_composite_synth } from "../composite_synth/index.js";
import { playSnapshot, retuneActiveSnapshotHexes, retuneSnapshotHexes } from "./snapshots.js";
import { remapSequenceNoteToRuntime } from "./runtime-pitch-map.js";

const frequency = (note) => 440 * 2 ** ((note.midicents - 69) / 12);
function output(reference) {
  const voices = [];
  return {
    voices,
    setTuningReference(fundamental) { reference = { ...reference, fundamental }; },
    makeHex(coords, cents, ...args) {
      const fundamental = reference.fundamental;
      const ratio = args[8];
      const voice = {
        coords, cents, noteOn: vi.fn(), noteOff: vi.fn(),
        retune(target) { this.cents = target; },
        standardWheelRetune(target) { this.cents = target; },
        frequency() { return fundamental / ratio * 2 ** (this.cents / 1200); },
      };
      voices.push(voice);
      return voice;
    },
  };
}

it("keeps Seeds of Skies absolute pitches through a first preset and delayed output handoff", () => {
  const notes = seeds.snapshots.find((snapshot) => snapshot.notes.length > 0).notes;
  const neutral = { fundamental: 440, cents: 0, ratio: 1 };
  const preset = { fundamental: 432, cents: 700, ratio: 2 ** (700 / 1200) };
  const old = output(neutral);
  const runtime = {
    settings: { fundamental: 440, midi_velocity: 72 },
    tuning: { degree0toRef_asArray: [0, 1], equivSteps: 1 },
    state: { sustainedNotes: [] },
    stopSnapshot: vi.fn(),
    synth: create_composite_synth([old], new Set(), neutral),
  };
  runtime._snapshotHexes = playSnapshot(runtime, notes);
  old.voices.forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]), 8));

  // The canvas changes before its asynchronous replacement outputs are ready.
  runtime.settings.fundamental = preset.fundamental;
  runtime.tuning = { degree0toRef_asArray: [preset.cents, preset.ratio], equivSteps: 12 };
  retuneSnapshotHexes(runtime, notes, { sequencePitch: true });
  old.voices.forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]), 8));
  const waitingVoices = playSnapshot(runtime, notes);
  old.voices.slice(notes.length).forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]), 8));

  const replacement = output(preset);
  runtime.synth = create_composite_synth([replacement], new Set(), preset);
  waitingVoices.forEach((voice) => voice.reconcileSynths([replacement]));
  runtime._snapshotHexes = waitingVoices;
  replacement.voices.forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]), 8));

  // Playback transposition still works after changing the reference.
  retuneActiveSnapshotHexes(runtime, 100);
  replacement.voices.forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]) * 2 ** (1 / 12), 8));

  // Explicit snapping remains a real pitch change, not bypassed by the handoff.
  const snapped = notes.map((note) => remapSequenceNoteToRuntime(note, {
    fundamental: 432, referenceDegree: 0, scale: [0, 1200], equivInterval: 1200,
  }));
  retuneSnapshotHexes(runtime, snapped, { sequencePitch: true });
  replacement.voices.forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(snapped[i]), 8));
  expect(snapped.some((note, i) => Math.abs(note.midicents - notes[i].midicents) > 0.01)).toBe(true);

  playSnapshot(runtime, notes);
  replacement.voices.slice(notes.length).forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]), 8));
  // Ordinary canvas pitches must still use the selected tuning reference.
  const canvas = runtime.synth.makeHex({ x: 0, y: 0 }, 700, 0, 0, 12, 700, 700,
    undefined, 72, 0, preset.ratio);
  canvas.noteOn();
  expect(replacement.voices.at(-1).frequency()).toBeCloseTo(432, 8);

  // Reuse the same running engine across another preset: queued/held arpeggio
  // notes retain their old reference, while new notes use the new reference.
  const held = replacement.voices.slice(0, notes.length);
  replacement.setTuningReference(466);
  runtime.settings.fundamental = 466;
  runtime.tuning = { degree0toRef_asArray: [0, 1], equivSteps: 1 };
  runtime.synth = create_composite_synth([replacement], new Set(), {
    fundamental: 466, cents: 0, ratio: 1,
  });
  retuneSnapshotHexes(runtime, notes, { sequencePitch: true });
  held.forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]), 8));
  const previousCount = replacement.voices.length;
  playSnapshot(runtime, notes);
  replacement.voices.slice(previousCount).forEach((voice, i) => expect(voice.frequency()).toBeCloseTo(frequency(notes[i]), 8));
});
