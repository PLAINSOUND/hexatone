SynthDef(\pluck, { |freq, transpose=1, bend=1,
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0|

	var e, f, o;

	freq = freq * transpose;
	off_vel = off_vel.linlin(0, 127, 0.1, 1);
	// Envelopes
	e = EnvGen.ar(Env(levels: [1, 1, 0.75, 0], times: [0.5, 1.5, 3], curve: 'sin'), doneAction: Done.freeSelf);
	f = EnvGen.ar(Env.asr(attackTime: 0.00001, sustainLevel: 1.0, releaseTime: (0.05 + (off_vel * 3)), curve: 'sin'), gate + Impulse.kr(0), doneAction: Done.freeSelf);
	// Noise Input
	o = Mix([
		WhiteNoise.ar(1) * on_vel.bilin(50, 0, 127, 0.85, 0.5, 1),
		BrownNoise.ar(1) * on_vel.bilin(50, 0, 127, 0.5, 0.85, 0.25) * freq.explin(65, 4224, 0.5, 0)
	]);
	// Karplus-Strong
	o = Pluck.ar(
		in: o,
		trig: Impulse.ar(0),
		maxdelaytime: 8 / freq,
		delaytime: 1 / ((freq * bend).lag(0.3)),
		decaytime: on_vel.linlin(0, 127, 1, 8),
		coef: freq.cpsmidi.linlin(45, 127, 1.5, 0.002) * on_vel.linlin(0, 127, 1, 0.4) * mod.explin(1, 2, 0.65, -0.038)
	);
	// Filtering
	o = BHiShelf.ar(o, 2000 * ((freq / 330.0) ** 0.65), 0.85, -16);
	o = DFM1.ar(o, freq * 19 * ((330.0 / freq ) ** 0.35), 0.1, 1.0, 0.0, 0.0003, 0.6);
	o = LeakDC.ar(o);
	// Amplitude and Output
	o = o * 0.5 * on_vel.linexp(0, 127, 0.1, 1.5) * freq.cpsmidi.linlin(60, 96, 1, 0.75) * e * f * Lag2.kr(vol * mod.linexp(1, 2, 1.075, 0.75), 0.3);

	Out.ar(0, o!2);
}).add.postln;


SynthDef(\string, { |freq, transpose=1, bend=1,
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0|

	var e, f, o, amp;

	freq = freq * transpose;
	amp = on_vel.linexp(0, 127, 0.2, 1);
	off_vel = off_vel.linlin(0, 127, 1, 0.2);

	e = EnvGen.ar(Env([0, 1, 1, 0], [(on_vel.linexp(0, 127, 2.5, 1)), [1,1.25,1.5,1.75,2].choose, [1,1.5,2,2.5].choose * off_vel], 'sin'), doneAction:Done.freeSelf);
	f = EnvGen.ar(Env.asr(attackTime: 0.001, sustainLevel: 1.0, releaseTime: (0.5 + (off_vel * 3)), curve:'sin'), gate + Impulse.kr(0), doneAction: Done.freeSelf);

	o = WhiteNoise.ar(1);
	o = Pluck.ar(
		in: o,
		trig: Impulse.ar(0),
		maxdelaytime: 8 / freq,
		delaytime: 1 / ((freq*bend).lag(0.3)),
		decaytime: 1 + (on_vel.linlin(0,127,20,1) * 19),
		coef: freq.explin(110, 3300, 0.08 * Lag2.kr(mod.linexp(1, 2, 3, 0.08), 0.03), 0.004)
	) * e;

	o = BHiShelf.ar(o, 2000, 2, -16);
	o = BHiPass.ar(o,freq * 0.9);
	o = LeakDC.ar(o);

	o = o * Lag2.kr(amp * vol * on_vel.linexp(0, 127, 0.15, 1.0) * freq.explin(88, 1100, 0.1, 1) * mod.linexp(1, 2, 1.0, 0.16), 0.2) * e * f;

	Out.ar(0, o!2);
}).add.postln;


SynthDef(\formant, { |freq, transpose=1, bend=1,
	formant_freq = #[1, 1, 1, 1, 1],
	formant_reso = #[1, 1, 1, 1, 1],
	formant_amp = #[1, 1, 1, 1, 1],
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0|

	var e, f, o, amp;

	freq = freq * transpose;
	amp = on_vel.linlin(0, 127, 0, 1);
	off_vel = off_vel.linlin(0, 127, 2, 1);

	e = EnvGen.ar(Env([0, 1, 0], [[1, 2, 3, 4].choose, 0.4 * [3, 4, 5, 6, 7].choose], curve: 'sin'), gate + Impulse.kr(0), doneAction: Done.freeSelf);
	f = EnvGen.ar(Env.asr(attackTime: 0.001, sustainLevel: 1.0, releaseTime: (0.02 + off_vel), curve:'sin'), gate, doneAction: Done.freeSelf);
	o = Saw.ar((freq * bend).lag(0.3));

	o = Mix.new(BBandPass.ar(o, formant_freq, formant_reso, formant_amp));
	o = BLowPass.ar(o, Lag2.kr(650 * mod.expexp(1, 2, 1, 1.65), 0.5) * freq.explin(27.5, 110, 0.25, 1));
	o = BPeakEQ.ar(o, freq, 1, -16);
	o = HPF.ar(o, freq);
	o = LeakDC.ar(o);

	o = o * e * f * 32 * Lag2.kr(amp * vol, 0.4) * filter.explin(1, 2, 1, 1.4).lag2(0.04);

	Out.ar(0, o!2);
}).add.postln;


SynthDef(\tone, { |freq, transpose=1, bend=1,
	on_vel=64, off_vel=64, mod=1, filter=1, gate=0, vol=0|

	var e, o;
	var attack_time = on_vel.bilin(70, 0, 127, 0.00001, 0.08, 0.000001);
	var rise_time = on_vel.bilin(70, 0, 127, 0.005, 0.7, 0.00005);
	var release_time = off_vel.bilin(70, 0, 127, 0.012, 0.12, 0.0012);
	var sustain_level = on_vel.bilin(70, 0, 127, 1.65, 1.25, 2);

	freq = freq * transpose;
	e = EnvGen.ar(Env.adsr(attackTime: attack_time, decayTime: rise_time, sustainLevel: sustain_level, releaseTime: release_time, peakLevel: 0.5, curve: 0), gate + Impulse.kr(0), doneAction: Done.freeSelf);
	p = FSinOsc.ar([1,2,3] * freq * bend.lag(0.3), mul: [1, 0.25 * mod.expexp(1, 2, 1, 2) * filter.explin(1, 2, 1, 2).lag2(0.04), 0.125 * mod.expexp(1, 2, 1, 4) * filter.explin(1, 2, 1, 4).lag2(0.04)]);

	o = Saw.ar(freq * bend.lag(0.3));

	o = DFM1.ar(o, freq * 3 * mod.linexp(1, 2, 0.9, 2).lag(0.75) * filter.linexp(1, 2, 0.7, 1.33).lag2(0.4), 0.3);
	o = LPF.ar(o, freq * 2 * ((330.0 / freq ) ** 0.9));
	o = BPeakEQ.ar(o, freq, 1.2, -26);
	o = BPeakEQ.ar(o, 160, 1.5, -4);
	o = BPeakEQ.ar(o, 800, 1, -2);
	o = HPF.ar(o, 110);

	o = o * e * Lag2.kr(vol, 0.2);
	p = p * 0.025 * e * Lag2.kr(vol, 0.2) * freq.linlin(800, 1400, 0, 1) * filter.explin(1, 2, 1, 1.8).lag2(0.04) * freq.explin(1400, 3300, 1, 0.45) * mod.expexp(1, 2, 1, 0.9).lag(0.35);
	o = o * mod.expexp(1, 2, 1.4, 1.1).lag(0.35) * freq.linlin(1300, 1600, 1, 0) * filter.explin(1, 2, 1, 2).lag2(0.04);

	Out.ar(0, 0.4 * (p + o)!2);
}).add.postln;

postln("Synths loaded !");
"".postln;
