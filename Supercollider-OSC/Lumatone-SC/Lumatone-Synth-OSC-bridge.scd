// some OSC debug commands

"cat /tmp/osc-bridge.log".unixCmdGetStdOut.postln;
"pkill -f osc-bridge".unixCmd;
"lsof -i :8089".unixCmdGetStdOut.postln; // view whats going on

And add a temporary OSC monitor to see if /s_new messages are arriving:
~servers[1].dumpOSC(1);
~servers[1].queryAllNodes;

OSCFunc({ |msg| msg.postln }, '/s_new');
OSCFunc({ |msg| msg.postln }, '/n_set');

// terminal cmds
// lsof -i :8089
// lsof -ti :8089 | xargs kill -9

( // Run this first to set up and start five servers
// ~to_headphones and ~to_speakers assume you are running an aggregate device (macOS) with a 2 channel audio loopback device (Blackhole) on the first 2 channels, followed by Headphones on 3-4 and Built-In on 5-6; otherwise set the audio channels for headphones and speakers accordingly

var id = 57100, count = 0, cleanup, fiveservers = true;
Window.closeAll;
"pkill -f scsynth".unixCmd;
Server.all.do { |srv| srv.remove };
Server.all.clear;

Routine({

	if (fiveservers) {
		~servers = 5.collect { |i|
			Server.new("server"++i, NetAddr("localhost", id+i), Server.local.options)
		};
	} {
		~servers = [s,s,s,s,s];
	};

	~servers.do { |srv|
		srv.boot;
	};

	5.do { |i| ~servers[i].makeWindow };
}).play(AppClock);

5.do{ |i| ~servers[i].makeWindow }; // make server guis and functions to route audio

~to_headphones = { Out.ar(4, SoundIn.ar([0,1])) }; // route to headphones
~to_speakers = { Out.ar(2, SoundIn.ar([0,1])) }; // route to speakers

cleanup = {
	~servers.do { |item| item.quit.postln };
	"Servers quit".postln; "done!".postln; Window.closeAll;
};
CmdPeriod.doOnce(cleanup);
)

( // MAIN PATCH -- run this after booting servers
// Lumatone and MTS multi-channel imput to internal synth and/or MPE output∞

// var TODO get rid of unneeded global/environment variables

~internal_synth = true;
~ports_in = ["mts"]; ~ports_out = [];

// ── MODE SWITCH ──────────────────────────────────────────────────────────────
// true  = hexatone sends OSC directly via osc-bridge (no MIDI responders)
// false = traditional MIDI responders (HelperFunctionsSynth.scd)
~use_osc = true;
// ─────────────────────────────────────────────────────────────────────────────

// choose active tuning map manually and post complete array
~current_map = 0; "Current Tuning Map => ".post; ~current_map.postln;

//code to print current map to Post window
//Post << ~tuningMap[~current_map];

"LumatoneSynths.scd".loadRelative;
"TuningMaps.scd".loadRelative;

if (~use_osc) {
	"OSCResponders.scd".loadRelative;

	// Auto-start the osc-bridge using the pre-built self-contained binary.
	// No Node.js installation required — binary is in osc-bridge/dist/.
	// Build with: yarn build-bridge
	// Log output → /tmp/osc-bridge.log.
	~repo_path = thisProcess.nowExecutingPath.dirname.dirname.dirname;
	~bridge_bin = ~repo_path +/+ (
		if ("uname -m".unixCmdGetStdOut.stripWhiteSpace == "arm64")
		{ "osc-bridge/dist/osc-bridge-arm64" }
		{ "osc-bridge/dist/osc-bridge-x64" }
	);

	if (File.exists(~bridge_bin).not) {
		"WARNING: osc-bridge binary not found at: ".post; ~bridge_bin.postln;
		"Run 'yarn build-bridge' in the hexatone repo to build it.".postln;
	} {
		~bridge_pid = ("sh -c "
			++ (~bridge_bin.shellQuote ++ " > /tmp/osc-bridge.log 2>&1 & echo $!").shellQuote
		).unixCmdGetStdOut.stripWhiteSpace.asInteger;

		if (~bridge_pid > 0) {
			"osc-bridge started (PID ".post; ~bridge_pid.post;
			"). Log: /tmp/osc-bridge.log".postln;
		} {
			"WARNING: osc-bridge failed to start — check /tmp/osc-bridge.log".postln;
		};
	};

	"OSC mode active — hexatone connects on ws://localhost:8089".postln;
} {
	"HelperFunctionsSynth.scd".loadRelative;
	MIDIIn.addFuncTo(\sysex, ~mts_in); "MTS input activated".postln;
	"MIDI responder mode active".postln;
};
"".postln;

// SYNTHS and TUNINGS MAPS are loaded from file: LumatoneSynths.scd
// MTS and MIDI functions are loaded from file: HelperFunctions.scd
// incoming real-time MTS, single note change works OK on macOS but
// WARNING: on Windows this can crash the interpreter
// (due to a currently unknown bug in PortMIDI implementation)


///////////////////////////
//	                    //
//   MIDI CONNECTIONS  //
//                    //
///////////////////////
// uses a helper Function to search for MIDI EndPoints by keywords

~findPorts.value;
"Active MIDIEndPoints:".postln;
"In: ".postln; ~midiin_ports.do ({ |item, index| "~midiin_ports[0][".post; index.post; "]: ".postln; item[0].postln });
"Out: ".postln; ~midiout_ports.do ({ |item, index| "~midiout_ports[0][".post; index.post; "]: ".postln; item[0].postln });
"".postln;


////////////////
//	         //
//   VARS   //
//         //
////////////

// MIDI to Post window
~post_note = false;
~post_bend = false;
~post_polytouch = false;
~post_cc = false;

~post_mts = false;

// change these values to true for multichannnel input (channels in 1-16 format) with per-channel transposition; true is for incoming MTS on any channel
~multichannel = false;
~main_channel = 4; // relevant for multichannel, sets channel for note 60=C4
if (~multichannel) { "Channel for untransposed playback => ".post; ~main_channel.postln };

~equave = 2; // ratio for octave or other interval of repetition
~cents_transpose = 0; // specify a cents transposition and change flag below
~use_cents_to_transpose = false;

if (~use_cents_to_transpose) {
	~transpose = 2 ** (~cents_transpose / 1200);
} { // default is to use a ratio, which is easier for specifying Hz
	~transpose = 440 / 440; // specify frequency ratio transposition for example if the tuning map defaults to A 440Hz and you would like A 443Hz, set this to 443 / 440
};

// polyphony arrays have one slot per possible MIDI note across all cahnnels
~notes = Array.fill2D(16, 128, { [nil, nil, nil, nil] });
~notes_status = Array.fill2D(16, 128, { [0,0,0,0] }); // keep track of note-on and -off status in case off function is evaluated before on...
//Post << ~notes_status;
~most_recent_note = []; // array to keep track of notes in order played
~velocities = Array.fill2D(16, 128, { 0 }); // stores on-velocities

// sustain pedal array for sustained notes (note-off velocities)
~sustain_pedal = 0;
~sustained = Array.fill2D(16, 128, { -1 }); // stores off-velocities IF sustain pedal is on

// bend : pitch-bend wheel is applied to most recent note ONLY; use if mts bend is turned off
~bendwheel = 28 / 27; // fixed ratio for maximum pitch bend
~bend = 1; // center value (ratio)
~s_curve = false; // apply a raised-cosine S-curve to incoming wheel data
~mts_bend = true;

// cc's from any channel
~controlchange = Array.fill(128, {0});
~mod_cc = 1; // set cc number for timbral modification


//////////////////////////
//	                   //
//   MIDI FUNCTIONS   //
//                   //
//////////////////////
// in external file HelperFunctions.scd


///////////////
//	        //
//  KEYS   //
//        //
///////////

// esc key kills any hanging synth nodes
// test keycodes using UnicodeResponder.tester;

k = UnicodeResponder.new;

k.register(27, false, false, false, false,
	{
		if (~internal_synth) {
			"Killing all stored synths!".postln;
			(0..3).do
			{ |synth| (0..127).do
				{ |note| (0..15).do
					{ |chan| if (~notes[chan][note][synth].isPlaying) {
						~notes[chan][note][synth].set(\off_vel, 64, \gate, 0);
						~notes[chan][note][synth] = nil;} // all ~notes off
					}
				}
			};
			"Killing all synths on server!".postln;
			4.do{ |i| ~servers[i+1].defaultGroup.set(\off_vel, 64, \gate, 0) };
		};
});

View.globalKeyDownAction = k;


//////////////
//	       //
//  GUI   //
//       //
//////////

~modelPrototype = (
	value: 0,
	getValue: { |self| self[\value] },
	value_: { |self, newValue|
		self[\value] = newValue;
		self.changed(\value, newValue);
	},
	destroy: { |self| self.changed(\didFree) }
);

~levels = Array.fill(4, { ~modelPrototype.copy.put(\value, 0.0) });
~maps = Array.fill(1, { ~modelPrototype.copy.put(\value, 0.0) });
~channels = Array.fill(1, { ~modelPrototype.copy.put(\value, 0.0) });
~labels = ["PLUCK", "BUZZ", "FORMANT", "SAW"];

if (~use_osc.not) {
	// Timbral mod fader — mirrors ~controlchange[~mod_cc] (mod wheel CC1).
	// Internal value 0–1 maps to the exponential 1–2 range used by the synths.
	~mod_model = ~modelPrototype.copy.put(\value, 0.0);

	~sliders = ~levels.collect { |model, i|
		Slider()
		.background_(Color.fromHexString("#aaaaaa"))
		.orientation_(\vertical)
		.value_(model.getValue)
		.action_({ |view|
			model.value = view.value;
			~numbers[i].value = view.value;

			if (~internal_synth) {
				(0..15).do { |channel|
					(0..127).do { |note| if (~notes[channel][note][i].isPlaying)
						{ ~notes[channel][note][i].set(\vol,view.value) }
					}
				}
			};
		})
		.onClose_({ ~controllers_levels[i].remove })
	};

	~numbers = ~levels.collect { |model, i|
		NumberBox()
		.font_(Font("Plainsound Text", 15))
		.align_(\center)
		.clipLo_(0.0)
		.clipHi_(1.0)
		.minDecimals_(2)
		.scroll_step_(0.1)
		.step_(0.01)
		.value_(model.getValue)
		.action_({ |view|
			model.value = view.value;
			~sliders[i].value = view.value;

			if (~internal_synth) {
				(0..15).do { |channel|
					(0..127).do { |note| if (~notes[channel][note][i].isPlaying)
						{ ~notes[channel][note][i].set(\vol,view.value)}
					}
				}
			}
		})
		.onClose_({ ~controllers_levels[i].remove })
	};

	~mod_slider = Slider()
	.background_(Color.fromHexString("#88aaaa"))
	.orientation_(\vertical)
	.value_(~mod_model.getValue)
	.action_({ |view|
		var modVal = view.value.linexp(0, 1, 1, 2); // 0–1 → 1–2 exponential
		~mod_model.value = view.value;
		~mod_number.value = view.value;
		~controlchange[~mod_cc] = modVal;
		(0..15).do { |channel|
			(0..127).do { |note|
				(0..3).do { |synth| if (~notes[channel][note][synth].isPlaying)
					{ ~notes[channel][note][synth].set(\mod, modVal) }
				}
			}
		};
	})
	.onClose_({ ~controller_mod.remove });

	~mod_number = NumberBox()
	.font_(Font("Plainsound Text", 15))
	.align_(\center)
	.clipLo_(0.0)
	.clipHi_(1.0)
	.minDecimals_(2)
	.scroll_step_(0.1)
	.step_(0.01)
	.value_(~mod_model.getValue)
	.action_({ |view|
		var modVal = view.value.linexp(0, 1, 1, 2);
		~mod_model.value = view.value;
		~mod_slider.value = view.value;
		~controlchange[~mod_cc] = modVal;
		(0..15).do { |channel|
			(0..127).do { |note|
				(0..3).do { |synth| if (~notes[channel][note][synth].isPlaying)
					{ ~notes[channel][note][synth].set(\mod, modVal) }
				}
			}
		};
	})
	.onClose_({ ~controller_mod.remove });

	~controller_mod = SimpleController(~mod_model)
	.put(\value, { |object, whatChanged, value|
		defer {
			~mod_slider.value = value;
			~mod_number.value = value;
		}
	})
	.put(\didFree, {
		defer {
			~mod_slider.remove;
			~mod_number.remove;
		}
	});

	~tuning = ~maps.collect { |model, i|
		NumberBox()
		.font_(Font("Plainsound Text", 15))
		.align_ (\center)
		.clipLo_(0)
		.clipHi_(127)
		.scroll_step_(1)
		.step_(1)
		.value_(model.getValue)
		.value_(0)
		.action_({ |view|
			model.value = view.value;
			~current_map = view.value;
		})
		.onClose_({ ~controllers_maps[i].remove })
	};

	~octave = ~channels.collect { |model, i|
		NumberBox()
		.font_(Font("Plainsound Text", 15))
		.align_ (\center)
		.clipLo_(1)
		.clipHi_(16)
		.scroll_step_(1)
		.step_(1)
		.value_(model.getValue)
		.value_(4)
		.action_({ |view|
			model.value = view.value;
			~main_channel = view.value;
		})
		.onClose_({ ~controllers_channels[i].remove })
	};

	~controllers_levels = ~levels.collect { |model, i|
		SimpleController(model)
		.put(\value, { |object, whatChanged, value|
			defer {
				~sliders[i].value = value;
				~numbers[i].value = value;
			}
		})
		.put(\didFree, {
			defer {
				~sliders[i].remove;
				~numbers[i].remove;
			}
		})
	};

	~controllers_maps = ~maps.collect { |model, i|
		SimpleController(model)
		.put(\value, { |object, whatChanged, value|
			defer {
				~tuning[i].value = value;
			}
		})
		.put(\didFree, {
			defer {
				~tuning[i].remove;
			}
		})
	};

	~controllers_channels = ~channels.collect { |model, i|
		SimpleController(model)
		.put(\value, { |object, whatChanged, value|
			defer {
				~octave[i].value = value;
			}
		})
		.put(\didFree, {
			defer {
				~octave[i].remove;
			}
		})
	};

	w = Window.new("Hpschd Tanpura Organ",
		Rect(
			Window.screenBounds.width * 6 / 7,
			Window.screenBounds.height * 3 / 5,
			Window.screenBounds.width / 7,
			(Window.screenBounds.height * 2 / 5)
	)).front; // GUI window

	w.layout = VLayout(
		HLayout(
			VLayout(
				StaticText().string_(~labels[0]).align_(\center).font_(Font("Plainsound Text", 11)),
				~sliders[0], ~numbers[0]
			),
			VLayout(
				StaticText().string_(~labels[1]).align_(\center).font_(Font("Plainsound Text", 11)),
				~sliders[1], ~numbers[1]
			),
			VLayout(
				StaticText().string_(~labels[2]).align_(\center).font_(Font("Plainsound Text", 11)),
				~sliders[2], ~numbers[2]
			),
			VLayout(
				StaticText().string_(~labels[3]).align_(\center).font_(Font("Plainsound Text", 11)),
				~sliders[3], ~numbers[3]
			),
			VLayout(
				StaticText().string_("MOD").align_(\center).font_(Font("Plainsound Text", 11))
					.stringColor_(Color.fromHexString("#226666")),
				~mod_slider,
				~mod_number
			)
		)
	);

	w.front;
} {
	"OSC mode active — SuperCollider GUI faders hidden".postln;
};

~cleanup_midi = {
	if (w.notNil) { w.close; };

	// Stop the osc-bridge process if it was started in OSC mode
	if (~use_osc && ~bridge_pid.notNil && (~bridge_pid > 0)) {
		("kill " ++ ~bridge_pid).unixCmd;
		"osc-bridge stopped".postln;
	} {
		~mts_in.free;
		~mts_out.free;
		~on.free;
		~off.free;
		~polytouch.free;
		~pitchbend.free;
		~cc.free;
		"MIDIFunc's freed".postln;
		MIDIIn.disconnectAll;
		MIDIClient.disposeClient;
		"MIDIClient disposed".postln;
	};

	// Free OSC responders if in OSC mode
	if (~use_osc) {
		~osc_s_new.free;
		~osc_n_set.free;
		~osc_n_free.free;
		"OSCFuncs freed".postln;
	};

	~servers.do { |item| item.quit.postln };
	"Servers quit".postln;

	"done!".postln;

	Window.closeAll;
};

CmdPeriod.doOnce(~cleanup_midi);

if (~use_osc.not) { "Use faders to mix the Synths!"; };

)


//////////////////
//	           //
//   EXTRAS   //
//           //
/////////////

( // kill hanging Synths
(0..3).do { |synth| (0..15).do
	{ |chan| 127.do
		{ |note| if (~notes[chan][note][synth].isPlaying) {
			~notes[chan][note][synth].set(\off_vel, 64, \gate,0);
			~notes[chan][note][synth] = nil;} } } }; // all ~notes off
)

( // free MIDIFunc's if needed
~mts.free;
~on.free;
~off.free;
~polytouch.free;
~pitchbend.free;
~cc.free;

"MIDIFunc's freed";
)

( // diconnect MIDI
MIDIIn.disconnectAll;
MIDIClient.disposeClient;
)


// check what is going on
~servers[0].queryAllNodes;

// code to kill lost synths
4.do{ |i| ~servers[i+1].defaultGroup.set(\gate, 0) };

4.do { |i| ~servers[i+1].freeAll };
~servers[0].freeAll; // free output routing

Server.killAll; Window.closeAll; // kill all servers
