import { captureUserSound } from "../persistence/user-sounds.js";
import { createSoundSession } from "./sound-session.js";

it("coalesces controller-style edits and discards a pending edit when a sound is recalled", () => {
  vi.useFakeTimers();
  try {
    const applyDsf = vi.fn();
    const commit = vi.fn();
    const settings = { dsf_timbre: 0.25 };
    const session = createSoundSession(() => ({ applyDsf, commit, settings }));
    session.setParameter("dsf_timbre", 0.4);
    vi.advanceTimersByTime(150);
    session.setParameter("dsf_timbre", 0.6);
    vi.advanceTimersByTime(199);
    expect(applyDsf.mock.calls.map(([controls]) => controls.timbre)).toEqual([0.4, 0.6]);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledExactlyOnceWith({ dsf_timbre: 0.6 });

    session.acknowledge({ dsf_timbre: 0.6 });
    session.setParameter("dsf_timbre", 0.8);
    session.discardEdits();
    vi.advanceTimersByTime(200);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(session.settings({ dsf_timbre: 0.1 }).dsf_timbre).toBe(0.1);
  } finally {
    vi.useRealTimers();
  }
});

it("applies brightness immediately, captures the preview, and commits only the settled edit", () => {
  vi.useFakeTimers();
  try {
    const settings = { osc_brightness: 0.2 };
    const oscBrightness = { value: 0.2 };
    const applyBrightness = vi.fn(value => { oscBrightness.value = value; });
    const commit = vi.fn();
    const session = createSoundSession(() => ({ settings, oscBrightness, applyBrightness, commit }));
    session.setParameter("osc_brightness", 0.5);
    session.setParameter("osc_brightness", 0.73);
    expect(applyBrightness.mock.calls).toEqual([[0.5], [0.73]]);
    expect(captureUserSound("Edited", session.settings(settings)).settings.osc_brightness).toBe(0.73);
    expect(commit).not.toHaveBeenCalled();

    oscBrightness.value = 1; // Physical CC1 display feedback.
    expect(captureUserSound("Edited", session.settings(settings)).settings.osc_brightness).toBe(0.73);
    vi.advanceTimersByTime(200);
    expect(commit).toHaveBeenCalledExactlyOnceWith({ osc_brightness: 0.73 });

    session.setParameter("osc_brightness", 0.73);
    expect(applyBrightness).toHaveBeenLastCalledWith(0.73);
    vi.advanceTimersByTime(200);
    expect(commit).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("captures a mixed gesture before persistence and drops its values on recall", () => {
  const applyMixer = vi.fn();
  const commit = vi.fn();
  const settings = {};
  const session = createSoundSession(() => ({ settings, applyMixer, commit }));
  for (const [key, value] of Object.entries({
    synth_volume: 0, osc_volume_formant: 0.82, fluidsynth_internal_volume: 44.6, fluidsynth_internal_reverb: 33,
  })) session.setParameter(key, value);
  session.setParameter("fluidsynth_internal_volume", 45);
  expect(applyMixer).toHaveBeenCalledTimes(4);
  const capture = () => captureUserSound("Edited", settings, {
    mixer: session.mixerValues(), engine: { volume: 100, reverb: 20 },
  });
  expect(capture()).toMatchObject({ sampleVolume: 0, settings: { osc_volume_formant: 0.82 },
    soundfont: { volume: 45, reverb: 33 } });
  expect(commit).not.toHaveBeenCalled();
  session.flush();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(capture().soundfont.volume).toBe(45);
  session.discardEdits();
  expect(capture().soundfont.volume).toBe(100);
});
