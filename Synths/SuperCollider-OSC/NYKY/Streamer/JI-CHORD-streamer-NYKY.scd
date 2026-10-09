(

////////////////////////////
//                        //
//   JI CHORD STREAMER    //
//                        //
////////////////////////////

~server = ~servers[0]; // use if Lumatone Synth is also active!
// ~server = s; // otherwise uncomment to use default server

~server.waitForBoot{

	var maxNumVoices, list, panning, synths, current_synth, synthDefs;
	var lastChord, currentChord;
	var num, func, jump, use, bar, step, keycode;

	"scores.scd".loadRelative;

	~score = ~scores[0][2]; // choose a score
	~ampBus = Bus.control(~server).set(0);

	/* t synth is a filtered brown noise sound by Thomas Nicholson;
	u synth is a quasi reed organ with a softer lift
	by Marcus Pal and Marc Sabat;
	v synth is a filtered saw;
	each iteration of 16 has a different panning in the left-right field */

	SynthDef(\t, { |freq, vel=72, fade=0.04, bend=1, gate=1, filter=1, amp=0, pan=0, release=0|
		var exc, klank;

		exc = BrownNoise.ar([0.007, 0.007]);
		freq = freq * bend.lag2(0.04);
		klank = (Klank.ar(`[
			Array.series(12, freq, freq), // filter frequencies
			Array.geom(12, 1, rrand(0.72, 0.84)), // filter amplitudes
			Array.fill(12, {rrand(5.0,20.0)}) // filter decay times
		], exc) * 0.08).softclip;
		klank = BPeakEQ.ar(klank, 55, 0.66, 6);
		klank = klank * Env([0, 0.9, 0], [0.2, 1 + release],'lin', releaseNode:1).kr(2, gate);
		klank = klank * Lag2.kr(vel.bilin(72, 1, 127, 0.6, 0.1, 0.9), fade) * In.kr(Lag2.kr(amp, 0.25));
		Out.ar(0, 0.5 * Pan2.ar(klank, pan));
	}).add;


	SynthDef(\u, { |freq, vel=72, fade=0.04, bend=1, gate=1, filter=1, amp=0, pan=0, release=0|
		var ampEnv, filterEnv, o;

		ampEnv= Env([0,1,1.8,0], [freq.explin(55,550,0.32,0.18), freq.explin(55,550,1.5,0.5), 0.035 + release], 'lin', 2);
		ampEnv = EnvGen.ar(ampEnv, gate, doneAction:2);

		filterEnv = Env([0.1,0.9,1], [freq.explin(55, 550, 0.36, 0.24), 1.5], \exp);
		filterEnv = EnvGen.ar(filterEnv);

		o = Saw.ar(freq * bend.lag2(0.04), 0.7);
		o = DFM1.ar(o, (freq * filter.lag2(0.04) * freq.explin(55, 550, 12, 8)).clip(55, 17600).lag(0.5) * filterEnv, freq.explin(55, 330, 0.6, 0.1));
		o = LPF.ar(o, freq * 5 * ((440 / freq) ** 0.66));

		o = BPeakEQ.ar(o, freq, 1, -5);
		o = BPeakEQ.ar(o, freq * 2.5, 1, -20);
		o = BPeakEQ.ar(o, freq * 4, 1, -5);

		o = BPeakEQ.ar(o, 200, 2, -8);

		o = o * AmpCompA.kr(freq, 55, 0.5, 1);

		o = o * Lag2.kr(vel.bilin(72, 1, 127, 0.6, 0.1, 0.9), fade) * ampEnv * In.kr(Lag2.kr(amp, 0.25));

		Out.ar(0, 0.5 * Pan2.ar(o, pan));
	}).add;


	SynthDef(\v, { |freq, vel=72, fade=0.04, bend=1, gate=1, filter=1, amp=0, pan=0, release=0|
		var e, o;

		e = Env([0, 1, 0],[0.16, 0.24 + release], 'sin', releaseNode:1).kr(2, gate);

		o = Saw.ar(freq * bend.lag2(0.04));
		o = BPF.ar(o, freq * 3 * filter.lag2(0.04));
		o = BLowPass.ar(o, freq * 16 / 3, 5);

		o = BPeakEQ.ar(o, freq * 13 / 3, 5, -12);

		o = o * Lag2.kr(vel.bilin(72, 1, 127, 0.6, 0.1, 0.9), fade) * e * 2.75 * In.kr(Lag2.kr(amp, 0.25));

		Out.ar(0, 0.5 * Pan2.ar(o, pan));
	}).add;





	maxNumVoices = ~score.collect{ |i| i.size }.maxItem;
	list = nil!maxNumVoices; // initialise array in which the sounding Synths will go

	panning = [-0.75, 0.75, -0.65, 0.65, -0.55, 0.55, -0.45, 0.45, -0.35, 0.35, -0.25, 0.25, -0.15, 0.15, -0.05, 0.05];

	synths = [\t, \u, \v];
	current_synth = 1; synthDefs = Array.fill(16, { synths[current_synth] } ); // choose which synth will sound new notes

	lastChord = [];
	num = 0;

	func = { |step, jump=1| // TODO fix show correct bars are accessible

		num = (num + step) % ~score.size;
		n.value = num;

		use = jump * num;
		bar = (use + 2) / 3;
		bar = bar.trunc;
		("chord").post; (": ").post; (num).asInteger.postln;

		currentChord = ~score[use];

		// release old note if not identical to new note in both frequency and index/voice
		lastChord.do({ |f, i|
			if (currentChord[i] != f, {
				if (f != 0, { // don't try to release non-existing 0-frequency synths
					list[i].set(\gate, 0);
					list[i] = nil;
				});
			});
		});

		// add new note if not identical to old note in both frequency and index/voice
		currentChord.do({ |f, i|
			if (lastChord[i] != f, {
				if (f != 0, { // don't add 0-frequency synths
					list[i] = Synth(synthDefs[i % 16],[freq:f, amp:~ampBus, gate:1, pan:panning[i]], ~server);
				});
			});
		});

		lastChord = currentChord;
		lastChord = currentChord;

	};


	keycode = { |i|
		Platform.case(
			\windows, { i[0] },
			\osx,     { i[1] },
			\linux,   { i[0] }
		);
	};

	// KeyCodeResponder.tester;
	// k.free;

	k = KeyCodeResponder.new;
	k.register(keycode.([37,123]), false, false, false, false, {func.(step:-1, jump:1)}); // left arrow
	k.register(keycode.([39,124]), false, false, false, false, {func.(step:1, jump:1)}); // right arrow
	k.register(keycode.([77,46]), false, false, false, false, {func.(step:0, jump:0)}); // m key
	k.register(keycode.([85,32]), false, false, false, false, {func.(step:0, jump:1)}); // p key
	k.register(keycode.([27,53]), false, false, false, false, { n.value = 0; num = 0; func.(step:0, jump:0) }); // esc key

	// Number box with current chord number

	w = Window.new(
		"JI CHORD STREAMER",
		Rect(
			Window.screenBounds.width * 6 / 7, // position of left of window from left of screen
			0, // position of bottom of window from bottom of screen
			Window.screenBounds.width / 7, // width of window
			(Window.screenBounds.height / 2) - 72 //height of window
	)).front;
	w.background = 'light slate blue';

	r = w.bounds;

	n = NumberBox.new(w,
		Rect(
		20 + (r.width / 6),
		10,
		r.width - (r.width / 6) - 30,
		(r.height / 2)
	));
	n.clipLo = 0;
	n.step = 1;
	n.shift_scale = 10;
	n.action = { num = n.value % ~score.size; v.focus };
	n.value = 0;
	n.font = Font.new("Roboto Condensed", bold:false, size:120, usePointSize:true);
	n.align = \center;
	n.normalColor = Color.grey;

	v = GUI.slider.new(w,
		Rect(
			10,
			10,
			(r.width / 6),
			(r.height / 2),
		));
	v.knobColor = 'orange';
	v.background = 'light gray';
	v.action = { ~ampBus.set(v.value); }; // use slider to control volume

	j = StaticText(w, Rect(10, (r.height / 2) + 10, r.width - 10, (r.height / 2) - 10));
	j.align = \left;
	j.string = "Adjust volume and activate shortcuts with the slider.\n\nSelect chords in the number display by typing or dragging; 'esc' = reset to start. Move through chords using the arrow keys: 'right' = next; 'left' = previous; 'm' = mute; 'u' = unmute / retrigger current chord.\n\nTo close and stop sound, press 'ctrl/cmd' and period ('.').";
	j.font = Font("Roboto Condensed", 15);

	v.keyDownAction = k;
	v.focus;

	CmdPeriod.doOnce( { w.close } );
	"streaming";

};

)

Marcus Pal / Marc Sabat 14.3.2021 Stockholm / Berlin