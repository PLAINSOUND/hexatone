// Every SynthDef independently rejects unsupported 20 Hz-16 kHz requests,
// bounds derived delays and filters, and sanitizes its final audio. This
// protects direct OSC/MIDI callers as well as Hexatone's browser-side guard.

SynthDef(\pluck, { |freq, transpose=1, bend=1,
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0,
	quick_release=0, quick_release_time=0.1|

	var e, f, o, normal_release, effective_release;
	var requested_freq, comparable_freq, safe_freq, safe_bend, pitched_freq, valid_freq, freq_status;
	var shelf_freq, dfm_freq;
	var min_note_hz = 20;
	var max_note_hz = 16000;
	var min_filter_hz = 20;
	var max_filter_hz = SampleRate.ir * 0.45;

	requested_freq = freq * transpose;
	freq_status = CheckBadValues.kr(requested_freq, id: 100, post: 0);
	comparable_freq = Sanitize.kr(requested_freq, 0);
	safe_freq = Sanitize.kr(requested_freq, 440).clip(min_note_hz, max_note_hz);
	safe_bend = Sanitize.kr(bend, 1).clip(0.25, 4);
	pitched_freq = (safe_freq * safe_bend).clip(min_note_hz, max_note_hz);
	valid_freq = (freq_status < 1)
		* (comparable_freq >= min_note_hz)
		* (comparable_freq <= max_note_hz);
	off_vel = off_vel.linlin(0, 127, 0.1, 1);
	// Envelopes
	e = EnvGen.ar(Env(levels: [1, 1, 0.75, 0], times: [0.5, 1.5, 3], curve: 'sin'), doneAction: Done.freeSelf);
	normal_release = 0.05 + (off_vel * 3);
	effective_release = normal_release.blend(quick_release_time.max(0.001), quick_release.clip(0, 1));
	f = EnvGen.ar(Env.asr(attackTime: 0.00001, sustainLevel: 1.0, releaseTime: effective_release, curve: 'sin'), gate + Impulse.kr(0), doneAction: Done.freeSelf);
	// Noise Input
	o = Mix([
		WhiteNoise.ar(1) * on_vel.bilin(50, 0, 127, 0.85, 0.5, 1),
		BrownNoise.ar(1) * on_vel.bilin(50, 0, 127, 0.5, 0.85, 0.25) * safe_freq.explin(65, 4224, 0.5, 0)
	]);
	// Karplus-Strong
	o = Pluck.ar(
		in: o,
		trig: Impulse.ar(0),
		maxdelaytime: 1 / min_note_hz,
		delaytime: 1 / pitched_freq.lag(0.3),
		decaytime: on_vel.linlin(0, 127, 1, 8),
		coef: safe_freq.cpsmidi.linlin(45, 127, 1.5, 0.002) * on_vel.linlin(0, 127, 1, 0.4) * mod.explin(1, 2, 0.65, -0.038)
	);
	// Filtering
	shelf_freq = (2000 * ((safe_freq / 330.0) ** 0.65)).clip(min_filter_hz, max_filter_hz);
	dfm_freq = (safe_freq * 19 * ((330.0 / safe_freq) ** 0.35)).clip(min_filter_hz, max_filter_hz);
	o = BHiShelf.ar(o, shelf_freq, 0.85, -16);
	o = DFM1.ar(o, dfm_freq, 0.1, 1.0, 0.0, 0.0003, 0.6);
	o = LeakDC.ar(o);
	// Amplitude and Output
	o = o * 0.5 * on_vel.linexp(0, 127, 0.1, 1.5) * safe_freq.cpsmidi.linlin(60, 96, 1, 0.75) * e * f * Lag2.kr(vol * mod.linexp(1, 2, 1.075, 0.75), 0.3);
	o = Sanitize.ar(o * valid_freq, 0);

	Out.ar(0, o!2);
}).add.postln;


SynthDef(\string, { |freq, transpose=1, bend=1,
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0,
	quick_release=0, quick_release_time=0.1, sustain_mode=0, retrigger_mode=0|

	var e, f, o, amp, normal_release, effective_release, articulation_trigger, one_shot;
	var requested_freq, comparable_freq, safe_freq, safe_bend, pitched_freq, valid_freq, freq_status;
	var min_note_hz = 20;
	var max_note_hz = 16000;
	var min_filter_hz = 20;
	var max_filter_hz = SampleRate.ir * 0.45;

	requested_freq = freq * transpose;
	freq_status = CheckBadValues.kr(requested_freq, id: 110, post: 0);
	comparable_freq = Sanitize.kr(requested_freq, 0);
	safe_freq = Sanitize.kr(requested_freq, 440).clip(min_note_hz, max_note_hz);
	safe_bend = Sanitize.kr(bend, 1).clip(0.25, 4);
	pitched_freq = (safe_freq * safe_bend).clip(min_note_hz, max_note_hz);
	valid_freq = (freq_status < 1)
		* (comparable_freq >= min_note_hz)
		* (comparable_freq <= max_note_hz);
	amp = on_vel.linexp(0, 127, 0.2, 1);
	off_vel = off_vel.linlin(0, 127, 1, 0.2);

	normal_release = 0.5 + (off_vel * 3);
	effective_release = normal_release.blend(quick_release_time.max(0.001), quick_release.clip(0, 1));
	f = EnvGen.ar(Env.asr(attackTime: 0.001, sustainLevel: 1.0, releaseTime: effective_release, curve:'sin'), gate + Impulse.kr(0), doneAction: Done.freeSelf);
	articulation_trigger = Impulse.kr(0) + Dust.kr(0.32 * retrigger_mode.clip(0, 1) * gate.clip(0, 1));
	one_shot = EnvGen.ar(Env([0, 1, 1, 0], [(on_vel.linexp(0, 127, 2.5, 1)), [1,1.25,1.5,1.75,2].choose, [1,1.5,2,2.5].choose * off_vel], 'sin'), articulation_trigger);
	// Sustain supplies the held body; retrigger adds recurring Tanpura-like attacks.
	e = SelectX.ar(sustain_mode.clip(0, 1).lag(0.05), [one_shot, f + (one_shot * retrigger_mode.clip(0, 1) * 0.35)]);

	o = WhiteNoise.ar(1);
	o = Pluck.ar(
		in: o,
		trig: Impulse.ar(0),
		maxdelaytime: 1 / min_note_hz,
		delaytime: 1 / pitched_freq.lag(0.3),
		decaytime: 1 + (on_vel.linlin(0,127,20,1) * 19),
		coef: safe_freq.explin(110, 3300, 0.08 * Lag2.kr(mod.linexp(1, 2, 3, 0.08), 0.03), 0.004)
	) * e;

	o = BHiShelf.ar(o, 2000, 2, -16);
	o = BHiPass.ar(o, (safe_freq * 0.9).clip(min_filter_hz, max_filter_hz));
	o = LeakDC.ar(o);

	o = o * Lag2.kr(amp * vol * on_vel.linexp(0, 127, 0.15, 1.0) * safe_freq.explin(88, 1100, 0.1, 1) * mod.linexp(1, 2, 1.0, 0.16), 0.2) * e * f;
	o = Sanitize.ar(o * valid_freq, 0);

	Out.ar(0, o!2);
}).add.postln;


SynthDef(\formant_array, { |freq, transpose=1, bend=1,
	formant_freq = #[1, 1, 1, 1, 1],
	formant_reso = #[1, 1, 1, 1, 1],
	formant_amp = #[1, 1, 1, 1, 1],
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0,
	quick_release=0, quick_release_time=0.1, sustain_mode=0, retrigger_mode=0|

	var e, f, o, amp, normal_release, effective_release, articulation_trigger, one_shot;
	var requested_freq, comparable_freq, safe_freq, safe_bend, pitched_freq, valid_freq, freq_status;
	var body_lpf_freq;
	var min_note_hz = 20;
	var max_note_hz = 16000;
	var min_filter_hz = 20;
	var max_filter_hz = SampleRate.ir * 0.45;

	requested_freq = freq * transpose;
	freq_status = CheckBadValues.kr(requested_freq, id: 120, post: 0);
	comparable_freq = Sanitize.kr(requested_freq, 0);
	safe_freq = Sanitize.kr(requested_freq, 440).clip(min_note_hz, max_note_hz);
	safe_bend = Sanitize.kr(bend, 1).clip(0.25, 4);
	pitched_freq = (safe_freq * safe_bend).clip(min_note_hz, max_note_hz);
	valid_freq = (freq_status < 1)
		* (comparable_freq >= min_note_hz)
		* (comparable_freq <= max_note_hz);
	formant_freq = Sanitize.kr(formant_freq, 1000).clip(min_filter_hz, max_filter_hz);
	formant_reso = Sanitize.kr(formant_reso, 0.1).clip(0.001, 2);
	formant_amp = Sanitize.kr(formant_amp, 0).clip(0, 2);
	amp = on_vel.linlin(0, 127, 0, 1);
	off_vel = off_vel.linlin(0, 127, 2, 1);

	normal_release = 0.02 + off_vel;
	effective_release = normal_release.blend(quick_release_time.max(0.001), quick_release.clip(0, 1));
	f = EnvGen.ar(Env.asr(attackTime: 0.001, sustainLevel: 1.0, releaseTime: effective_release, curve:'sin'), gate, doneAction: Done.freeSelf);
	articulation_trigger = Impulse.kr(0) + Dust.kr(0.2 * retrigger_mode.clip(0, 1) * gate.clip(0, 1));
	one_shot = EnvGen.ar(Env([0, 1, 0], [[1, 2, 3, 4].choose, 0.4 * [3, 4, 5, 6, 7].choose], curve: 'sin'), articulation_trigger);
	e = SelectX.ar(sustain_mode.clip(0, 1).lag(0.05), [one_shot, f + (one_shot * retrigger_mode.clip(0, 1) * 0.35)]);
	o = Saw.ar(pitched_freq.lag(0.3));

	o = Mix.new(BBandPass.ar(o, formant_freq, formant_reso, formant_amp));
	body_lpf_freq = (Lag2.kr(650 * mod.expexp(1, 2, 1, 1.65), 0.5) * safe_freq.explin(27.5, 110, 0.25, 1)).clip(min_filter_hz, max_filter_hz);
	o = BLowPass.ar(o, body_lpf_freq);
	o = BPeakEQ.ar(o, safe_freq.clip(min_filter_hz, max_filter_hz), 1, -16);
	o = HPF.ar(o, safe_freq.clip(min_filter_hz, max_filter_hz));
	o = LeakDC.ar(o);

	o = o * e * f * 3 * Lag2.kr(amp * vol, 0.4) * filter.explin(1, 2, 1, 1.4).lag2(0.04);
	o = Sanitize.ar(o * valid_freq, 0);

	Out.ar(0, o!2);
}).add.postln;

SynthDef(\formant, { |freq, transpose=1, bend=1,
	ff0=800, ff1=1150, ff2=2900, ff3=3900, ff4=4950,
	fr0=0.1, fr1=0.078, fr2=0.041, fr3=0.033, fr4=0.028,
	fa0=1.0, fa1=0.5,   fa2=0.025, fa3=0.1,  fa4=0.003,
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0,
	quick_release=0, quick_release_time=0.1, sustain_mode=0, retrigger_mode=0|

	var e, f, o, amp, normal_release, effective_release, articulation_trigger, one_shot;
	var requested_freq, comparable_freq, safe_freq, safe_bend, pitched_freq, valid_freq, freq_status;
	var body_lpf_freq, safe_formants, safe_formant_reso, safe_formant_amp;
	var min_note_hz = 20;
	var max_note_hz = 16000;
	var min_filter_hz = 20;
	var max_filter_hz = SampleRate.ir * 0.45;

	requested_freq = freq * transpose;
	freq_status = CheckBadValues.kr(requested_freq, id: 130, post: 0);
	comparable_freq = Sanitize.kr(requested_freq, 0);
	safe_freq = Sanitize.kr(requested_freq, 440).clip(min_note_hz, max_note_hz);
	safe_bend = Sanitize.kr(bend, 1).clip(0.25, 4);
	pitched_freq = (safe_freq * safe_bend).clip(min_note_hz, max_note_hz);
	valid_freq = (freq_status < 1)
		* (comparable_freq >= min_note_hz)
		* (comparable_freq <= max_note_hz);
	safe_formants = [ff0, ff1, ff2, ff3, ff4].collect { |value|
		Sanitize.kr(value, 1000).clip(min_filter_hz, max_filter_hz)
	};
	safe_formant_reso = Sanitize.kr([fr0, fr1, fr2, fr3, fr4], 0.1).clip(0.001, 2);
	safe_formant_amp = Sanitize.kr([fa0, fa1, fa2, fa3, fa4], 0).clip(0, 2);
	amp = on_vel.linlin(0, 127, 0, 1);
	off_vel = off_vel.linlin(0, 127, 2, 1);

	normal_release = 0.02 + off_vel;
	effective_release = normal_release.blend(quick_release_time.max(0.001), quick_release.clip(0, 1));
	f = EnvGen.ar(Env.asr(attackTime: 0.001, sustainLevel: 1.0, releaseTime: effective_release, curve:'sin'), gate, doneAction: Done.freeSelf);
	articulation_trigger = Impulse.kr(0) + Dust.kr(0.2 * retrigger_mode.clip(0, 1) * gate.clip(0, 1));
	one_shot = EnvGen.ar(Env([0, 1, 0], [[1, 2, 3, 4].choose, 0.4 * [3, 4, 5, 6, 7].choose], curve: 'sin'), articulation_trigger);
	e = SelectX.ar(sustain_mode.clip(0, 1).lag(0.05), [one_shot, f + (one_shot * retrigger_mode.clip(0, 1) * 0.35)]);
	o = Saw.ar(pitched_freq.lag(0.3));

	o = Mix.new(BBandPass.ar(o, safe_formants, safe_formant_reso, safe_formant_amp));
	body_lpf_freq = (Lag2.kr(650 * mod.expexp(1, 2, 1, 1.65), 0.5) * safe_freq.explin(27.5, 110, 0.25, 1)).clip(min_filter_hz, max_filter_hz);
	o = BLowPass.ar(o, body_lpf_freq);
	o = BPeakEQ.ar(o, safe_freq.clip(min_filter_hz, max_filter_hz), 1, -16);
	o = HPF.ar(o, safe_freq.clip(min_filter_hz, max_filter_hz));
	o = LeakDC.ar(o);

	o = o * e * f * 3 * Lag2.kr(amp * vol, 0.4) * filter.explin(1, 2, 1, 1.4).lag2(0.04);
	o = Sanitize.ar(o * valid_freq, 0);

	Out.ar(0, o!2);
}).add.postln;


SynthDef(\tone, { |freq, transpose=1, bend=1,
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0,
	quick_release=0, quick_release_time=0.1|

	var e, o, p, output, effective_release;
	var requested_freq, comparable_freq, safe_freq, safe_bend, pitched_freq, valid_freq, freq_status;
	var dfm_freq, tone_lpf_freq;
	var min_note_hz = 20;
	var max_note_hz = 16000;
	var min_filter_hz = 20;
	var max_filter_hz = SampleRate.ir * 0.45;
	var attack_time = on_vel.bilin(70, 0, 127, 0.00001, 0.08, 0.000001);
	var rise_time = on_vel.bilin(70, 0, 127, 0.005, 0.7, 0.00005);
	var release_time = off_vel.bilin(70, 0, 127, 0.012, 0.12, 0.0012);
	var sustain_level = on_vel.bilin(70, 0, 127, 1.65, 1.25, 2);

	requested_freq = freq * transpose;
	freq_status = CheckBadValues.kr(requested_freq, id: 140, post: 0);
	comparable_freq = Sanitize.kr(requested_freq, 0);
	safe_freq = Sanitize.kr(requested_freq, 440).clip(min_note_hz, max_note_hz);
	safe_bend = Sanitize.kr(bend, 1).clip(0.25, 4);
	pitched_freq = (safe_freq * safe_bend).clip(min_note_hz, max_note_hz);
	valid_freq = (freq_status < 1)
		* (comparable_freq >= min_note_hz)
		* (comparable_freq <= max_note_hz);
	effective_release = release_time.blend(quick_release_time.max(0.001), quick_release.clip(0, 1));
	e = EnvGen.ar(Env.adsr(attackTime: attack_time, decayTime: rise_time, sustainLevel: sustain_level, releaseTime: effective_release, peakLevel: 0.5, curve: 0), gate + Impulse.kr(0), doneAction: Done.freeSelf);
	p = SinOsc.ar([1,2,3] * pitched_freq.lag(0.3), mul: [1, 0.25 * mod.expexp(1, 2, 1, 2) * filter.explin(1, 2, 1, 2).lag2(0.04), 0.125 * mod.expexp(1, 2, 1, 4) * filter.explin(1, 2, 1, 4).lag2(0.04)]);

	o = Saw.ar(pitched_freq.lag(0.3));

	dfm_freq = (safe_freq * 3 * mod.linexp(1, 2, 0.9, 2).lag(0.75) * filter.linexp(1, 2, 0.7, 1.33).lag2(0.4)).clip(min_filter_hz, max_filter_hz);
	tone_lpf_freq = (2 * (330.0 ** 0.9) * (safe_freq ** 0.1)).clip(min_filter_hz, max_filter_hz);
	o = DFM1.ar(o, dfm_freq, 0.3);
	o = LPF.ar(o, tone_lpf_freq);
	o = BPeakEQ.ar(o, safe_freq.clip(min_filter_hz, max_filter_hz), 1.2, -26);
	o = BPeakEQ.ar(o, 160, 1.5, -4);
	o = BPeakEQ.ar(o, 800, 1, -2);
	o = HPF.ar(o, 110);

	o = o * e * Lag2.kr(vol, 0.2);
	p = p * 0.025 * e * Lag2.kr(vol, 0.2) * safe_freq.linlin(800, 1400, 0, 1) * filter.explin(1, 2, 1, 1.8).lag2(0.04) * safe_freq.explin(1400, 3300, 1, 0.45) * mod.expexp(1, 2, 1, 0.9).lag(0.35);
	o = o * mod.expexp(1, 2, 1.4, 1.1).lag(0.35) * safe_freq.linlin(1300, 1600, 1, 0) * filter.explin(1, 2, 1, 2).lag2(0.04);

	output = Sanitize.ar(0.4 * (p + o) * valid_freq, 0);
	Out.ar(0, output!2);
}).add.postln;

postln("Synths loaded !");
"".postln;
