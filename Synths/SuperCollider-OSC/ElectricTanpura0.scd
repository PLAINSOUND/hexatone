
s.waitForBoot{

	//////////////////
	//	           //
	// SynthDefs  //
	//           //
	/////////////(

	~bus = Bus.audio(s,2);
	~ampBus = 4.collect{|i| Bus.control(s).set(0); };

	SynthDef(\pluck, {|freq,amp| var e,o;
		e = EnvGen.ar(Env([1,1,0],[10,10],'sin'),doneAction:2);
		o = WhiteNoise.ar(1!2);
		o = Pluck.ar(
			in: o,
			trig: Impulse.ar(0),
			maxdelaytime: 1/freq,
			delaytime: 1/freq,
			decaytime: 60,
			coef: freq.explin(77,660,0.1,0.004)
		);
		o = BHiShelf.ar(o,2000,2,-30);
		o = BHiPass.ar(o,freq*0.9);
		o = LeakDC.ar(o);
		o = o*Lag2.kr(amp,0.2)*e;
		Out.ar(~bus,o);
	}).add;

	SynthDef(\string, {|freq,amp| var ee,e,o;
		e = EnvGen.ar(Env([0,1,1,0],[2,10,10],'sin'),doneAction:2);
		o = WhiteNoise.ar(1!2);
		o = Pluck.ar(
			in: o,
			trig: Impulse.ar(0),
			maxdelaytime: 1/freq,
			delaytime: 1/freq,
			decaytime: 30,
			coef: freq.explin(140,300,0.025,0.0014)
		) * e;
		o = BHiShelf.ar(o,2000,2,-21);
		o = BHiPass.ar(o,freq*0.9);
		o = LeakDC.ar(o);
		o = o*Lag2.kr(amp,0.2)*e;
		Out.ar(~bus,o*0.2);
	}).add;

	SynthDef(\tone, {|freq,dur,amp,gate=1| var e,o;
		e = EnvGen.ar(Env([0,1,0],[[4,5,6,7,8,9].choose,[9,10,11,12,13,14].choose],'sin',1),gate,doneAction:2);
		o = Saw.ar(freq);
		o = LPF.ar(o,freq*4);
		o = BLowPass.ar(o,1800);
		o = BPeakEQ.ar(o,freq,1,-8);
		o = o!2 * e * In.kr(Lag2.kr(amp,0.2));
		o = LeakDC.ar(o) * AmpComp.kr(freq,100,0.4);
		Out.ar(~bus,o*0.2);
	}).add;

	SynthDef(\formantL, {
		|
		freq,
		formant_freq = #[1,1,1,1,1],
		formant_reso = #[1,1,1,1,1],
		formant_amp = #[1,1,1,1,1],
		dur,
		amp,
		gate = 1
		|
		var e = EnvGen.ar(Env([0,1,0],[dur*0.5,dur*0.5],curve: 'sin'),gate,doneAction:2);
		var o = Saw.ar(freq);
		o = Mix.new(BBandPass.ar(o, formant_freq, formant_reso, formant_amp));
		o = LPF.ar(o,freq*7);
		o = BLowPass.ar(o,2000);
		o = BPeakEQ.ar(o,freq,1,-3);
		o = LeakDC.ar(o) * AmpComp.kr(freq,100,0.4);
		o = o * e * 3.65 * Lag2.kr(amp,0.2);
		Out.ar(~bus,Pan2.ar(o,-1));
	}).add;


	SynthDef(\formantR, {
		|
		freq,
		formant_freq = #[1,1,1,1,1],
		formant_reso = #[1,1,1,1,1],
		formant_amp = #[1,1,1,1,1],
		dur,
		amp,
		gate = 1
		|
		var e = EnvGen.ar(Env([0,1,0],[dur*0.5,dur*0.5],curve: 'sin'),gate,doneAction:2);
		var o = Saw.ar(freq);
		o = Mix.new(BBandPass.ar(o, formant_freq, formant_reso, formant_amp));
		o = LPF.ar(o,freq*7);
		o = BLowPass.ar(o,2000);
		o = BPeakEQ.ar(o,freq,1,-3);
		o = LeakDC.ar(o) * AmpComp.kr(freq,100,0.4);
		o = o * e * 3.65 * Lag2.kr(amp,0.2);
		Out.ar(~bus,Pan2.ar(o,1));
	}).add;

	SynthDef(\master,{
		var o = In.ar(~bus,2);
		o = BPeakEQ.ar(o,200,2,-6);
		Out.ar(0,o);
	}).add;

	s.sync;

	Synth(\master);

	s.sync;

	//////////////
	//	       //
	// Pbinds //
	//       //
	//////////

	~pluck = Pbind(*[
		instrument: \pluck,
		delta: PLseq([1,1],1),
		freq: PLseq([[0],PL(\c,1)],1),
		amp: PLnaryFunc({|i| if(i[0]==0,{0},{~ampBus[0].asMap}) }, PLseq([[0],PL(\c,1)],1)),
		lag: PLnaryFunc({|i|
			if( i.size>1,
				{(
					(0..(i.size-1))/(i.size-1)).lincurve(0,1.0,0,
					[2/1,3/2,4/3,7/6,8/7,9/8].choose, // arpeggio time
					[1/2,2/3,3/4,6/7,7/8,8/9].choose // curvature
				)},
				{
					0
			});
		},PLseq([[0],PL(\c,1)],1))
	]);

	~tambura = Pbind(*[
		instrument: \string,
		freq: PLseq(\c),
		amp: PLnaryFunc({|i| if(i[0]==0,{0},{~ampBus[1].asMap}) }, PL(\c)),
		delta: Prand([4/1,3/1,8/3,7/3,16/7,9/4],inf),
	]);
	~tambura.play;

	~formantTonesL = Pbind(*[
		instrument: \formantL,
		freq: PLseq(\c),

		formant_table: 	Pfunc { FormantTable.rand },
		formant_freq: 	Pkey(\formant_table).collect{|i| i[0] },
		formant_reso: 	Pkey(\formant_table).collect{|i| i[1] },
		formant_amp: 	Pkey(\formant_table).collect{|i| i[2] },

		delta:	Pwhite(1,9),
		dur: 	Pwhite(8,16),

		amp: PLnaryFunc({|i| if(i[0]==0,{0},{~ampBus[2].asMap}) }, PL(\c)),

	]);
	~formantTonesL.play;

	~formantTonesR = Pbind(*[
		instrument: \formantR,
		freq: PLseq(\c),

		formant_table: 	Pfunc { FormantTable.rand },
		formant_freq: 	Pkey(\formant_table).collect{|i| i[0] },
		formant_reso: 	Pkey(\formant_table).collect{|i| i[1] },
		formant_amp: 	Pkey(\formant_table).collect{|i| i[2] },

		delta:	Pwhite(1,9),
		dur: 	Pwhite(8,16),

		amp: PLnaryFunc({|i| if(i[0]==0,{0},{~ampBus[2].asMap}) }, PL(\c)),

	]);
	~formantTonesR.play;

	~sawTones = [];

	//////////////
	//	       //
	//  MIDI  //
	//       //
	//////////

	//MIDIClient.init;
	//MIDIIn.connectAll;
	//MIDIdef.cc(\cc11, {arg num; ~c11 = num; ~c11 = ~c11/127.0; {v.valueAction = ~c11;}.defer;}, 11);
	//MIDIdef.cc(\cc12, {arg num; ~c12 = num; ~c12 = ~c12/127.0; {u.valueAction = ~c12;}.defer;}, 12);
	//MIDIdef.cc(\cc13, {arg num; ~c13 = num; ~c13 = ~c13/127.0; {q.valueAction = ~c13;}.defer;}, 13);
	//MIDIdef.cc(\cc14, {arg num; ~c14 = num; ~c14 = ~c14/127.0; {z.valueAction = ~c14;}.defer;}, 14);
	//MIDIdef.cc(\cc47, {arg num; ~c47 = num; 'CC47: '.post; ~c47.postln; ~c47 = ~c47/127.0; {z.valueAction = ~c47;}.defer;}, 47);
	//MIDIdef.cc(\cc48, {arg num; ~c48 = num; 'CC48: '.post; ~c48.postln; ~c48 = ~c48/127.0; {z.valueAction = ~c48;}.defer;}, 47);

	//////////////
	//	   //
	//  GUI   //
	//       //
	//////////

	w = Window.new("Electric Tanpura",Rect((Window.screenBounds.width)*3/4,(Window.screenBounds.height/2)-((Window.screenBounds.width/4-200)/4),
		Window.screenBounds.width/4,(Window.screenBounds.height/2)+((Window.screenBounds.width/4-200)/4)-60)).front;
	// GUI window
	CmdPeriod.doOnce({ w.close; });

	x = Window.new("Bar",Rect(0,(Window.screenBounds.height/2)-((Window.screenBounds.width/4-200)/4),
		(Window.screenBounds.width)*3/4,(Window.screenBounds.height/2)+((Window.screenBounds.width/4-200)/4)-60)).front;
	// GUI window
	CmdPeriod.doOnce({ x.close; });

	v = GUI.slider.new(w,Rect(40,40,(Window.screenBounds.width/4-200)/4,(Window.screenBounds.height/2)-180)); // slider 1
	//v.value = 0.0;
	v.action = {  ~ampBus[0].set(v.value) };

	u = GUI.slider.new(w,Rect(80+((Window.screenBounds.width/4-200)/4),40,(Window.screenBounds.width/4-200)/4,(Window.screenBounds.height/2)-180));  // slider 2
	//u.value = 0.0;
	u.action = {  ~ampBus[1].set(u.value) };

	q = GUI.slider.new(w,Rect(120+(2*(Window.screenBounds.width/4-200)/4),40,(Window.screenBounds.width/4-200)/4,(Window.screenBounds.height/2)-180));  // slider 3
	//q.value = 0.0;
	q.action = { ~ampBus[2].set(q.value) };

	z = GUI.slider.new(w,Rect(160+(3*(Window.screenBounds.width/4-200)/4),40,(Window.screenBounds.width/4-200)/4,(Window.screenBounds.height/2)-180));  // slider 4
	//z.value = 0.0;
	z.action = { ~ampBus[3].set(z.value) };

	// Buttons

	// previous chord

	b = GUI.button.new(w,Rect(40,(Window.screenBounds.height/2)-100,(Window.screenBounds.width/4-200)/4,(Window.screenBounds.width/4-200)/4));

	b.action = {

		~n = ~n - 1 % ~score.size;
		n.value = (~n);
		~c = ~score[~n];

		[~c/~f].do{|i| var o = i;

		};

		if ( ~sawTones.size>0, {
			~sawTones.do{|i| i.set(\gate,0)}; ~sawTones = [];
		});

		if ( ~c[0]!=0, {
			~sawTones = ~c.collect{|i|
				Synth(\tone,[
					freq:i,amp:~ampBus[3],
					attack: [4,5,6,7,8,9].choose,
					release: [9,10,11,12,13,14].choose,
				])
			}
		});

		~pluckPlayer.stop;
		~pluckPlayer = ~pluck.play;

	};

	// next chord

	f = GUI.button.new(w,Rect(160+(3*(Window.screenBounds.width/4-200)/4),(Window.screenBounds.height/2)-100,(Window.screenBounds.width/4-200)/4,(Window.screenBounds.width/4-200)/4));

	f.action = {

		~n = ~n + 1 % ~score.size;
		n.value = (~n);
		~c = ~score[~n];

		[~c/~f].do{|i| var o = i;

		};

		~sawTones.do{|i| i.set(\gate,0) };

		if( ~c[0]!=0, {
			~sawTones = ~c.collect{|i|
				Synth(\tone,[
					freq:i,amp:~ampBus[3],
					attack: [4,5,6,7,8,9].choose,
					release: [9,10,11,12,13,14].choose,
				])
			}
		});

		~pluckPlayer.stop;
		~pluckPlayer = ~pluck.play;

	};

	// Number box current chord number

	n = NumberBox.new(x,Rect(40,40,((Window.screenBounds.width)*3/4)-80,(Window.screenBounds.height/2)+((Window.screenBounds.width/4-200)/4)-140));
	n.clipLo = 0;
	n.action = { ~n = n.value.clip(0,~score.size) };
	n.value = 0;
	n.font = Font.new("Roboto", bold:false, size:320, usePointSize:true);
	n.align = \center;
	n.normalColor = Color.grey;

	// Make arrow keys execute next/previous chord action

	~keycode = { |i|
		Platform.case(
			\windows, { i[0] },
			\osx,     { i[1] },
			\linux,   { i[0] }
		);
	};

	// KeyCodeResponder.tester;
	// k.free;

	~key = KeyCodeResponder.new;
	~key.register(~keycode.([37,123]), false, false, false, false, b.action); // left arrow
	~key.register(~keycode.([39,124]), false, false, false, false, f.action); // right arrow
	~key.register(~keycode.([77,46]), false, false, false, false, {"m".postln;}); // m key
	~key.register(~keycode.([85,32]), false, false, false, false, {"p".postln;}); // p key
	~key.register(~keycode.([27,53]), false, false, false, false,  {n.valueAction=0;~c = ~score[~n]; // exc key

		[~c/~f].do{|i| var o = i;

		};

		if ( ~sawTones.size>0, {
			~sawTones.do{|i| i.set(\gate,0)}; ~sawTones = [];
		});

		if ( ~c[0]!=0, {
			~sawTones = ~c.collect{|i|
				Synth(\tone,[
					freq:i,amp:~ampBus[3],
					attack: [4,5,6,7,8,9].choose,
					release: [9,10,11,12,13,14].choose,
				])
			}
		});

		~pluckPlayer.stop;
		~pluckPlayer = ~pluck.play;

	};);

	v.keyDownAction = ~key;
	u.keyDownAction = ~key;
	q.keyDownAction = ~key;
	z.keyDownAction = ~key;
	f.keyDownAction = ~key;
	b.keyDownAction = ~key;
	n.keyDownAction = ~key;

	// Control – values and lists

	~n = 0;
	~c = ~score[~n];



    //////////////
	//	       //
	//  OSC   //
	//       //
	//////////



OSCdef.new (
	\push1,
	{
		arg msg, time, addr, port;
		{
				if(msg[1]==1,
				{

		~n = ~n - 1 % ~score.size;
		n.value = (~n);
		~c = ~score[~n];

		[~c/~f].do{|i| var o = i;

		};

		if ( ~sawTones.size>0, {
			~sawTones.do{|i| i.set(\gate,0)}; ~sawTones = [];
		});

		if ( ~c[0]!=0, {
			~sawTones = ~c.collect{|i|
				Synth(\tone,[
					freq:i,amp:~ampBus[3],
					attack: [4,5,6,7,8,9].choose,
					release: [9,10,11,12,13,14].choose,
				])
			}
		});

		~pluckPlayer.stop;
		~pluckPlayer = ~pluck.play;

	};
			);

		}.defer;
	},
	'/0/push1'
);
OSCdef.new (
	\push2,
	{
		arg msg, time, addr, port;
		{
				if(msg[1]==1,
				{

		~n = ~n + 1 % ~score.size;
		n.value = (~n);
		~c = ~score[~n];

		[~c/~f].do{|i| var o = i;

		};

		~sawTones.do{|i| i.set(\gate,0) };

		if( ~c[0]!=0, {
			~sawTones = ~c.collect{|i|
				Synth(\tone,[
					freq:i,amp:~ampBus[3],
					attack: [4,5,6,7,8,9].choose,
					release: [9,10,11,12,13,14].choose,
				])
			}
		});

		~pluckPlayer.stop;
		~pluckPlayer = ~pluck.play;

	};

			);

		}.defer;
	},
	'/0/push2'
);
OSCdef.new (
	\push3,
	{
		arg msg, time, addr, port;
		{
			if(msg[1]==1,
				{n.valueAction=0;
		~c = ~score[~n];

		[~c/~f].do{|i| var o = i;

		};

		if ( ~sawTones.size>0, {
			~sawTones.do{|i| i.set(\gate,0)}; ~sawTones = [];
		});

		if ( ~c[0]!=0, {
			~sawTones = ~c.collect{|i|
				Synth(\tone,[
					freq:i,amp:~ampBus[3],
					attack: [4,5,6,7,8,9].choose,
					release: [9,10,11,12,13,14].choose,
				])
			}
		});

		~pluckPlayer.stop;
		~pluckPlayer = ~pluck.play;

	}
			);

		}.defer;
	},
	'/0/push3'
);
OSCdef.new (
	\tanpurafader1,
	{
		arg msg, time, addr, port;
		{
			v.valueAction=(msg[1]);

		}.defer;
	},
	'/0/fader1'
);
OSCdef.new (
	\tanpurafader2,
	{
		arg msg, time, addr, port;
		{
			u.valueAction=(msg[1]);

		}.defer;
	},
	'/0/fader2'
);
OSCdef.new (
	\tanpurafader3,
	{
		arg msg, time, addr, port;
		{
			q.valueAction=(msg[1]);

		}.defer;
	},
	'/0/fader3'
);
OSCdef.new (
	\tanpurafader4,
	{
		arg msg, time, addr, port;
		{
			z.valueAction=(msg[1]);

		}.defer;
	},
	'/0/fader4'
);

	}