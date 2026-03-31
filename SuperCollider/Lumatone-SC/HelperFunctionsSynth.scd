
////////////////////
//	             //
//  MIDI PORTS  //
//             //
////////////////


~connectMIDIports = { |in, out|
	var in_ports, out_ports;

	"Connecting MIDI: ".post;
	if (MIDIClient.initialized == false) {
		"".postln; MIDIClient.init; "MIDIClient initialised".postln;
	} { "MIDIClient is already running".postln;};

	~midiin_ports = Array.fill(in.size, { |i| [nil, nil] });
	~midiout_ports = Array.fill(out.size, { |i| [nil, nil] });

	// look for in ports and connect them using findPort
	in_ports = { |name, sources_index|
		var d_name, p_name;

		t = nil; i = 0; a = false;
		"".postln;
		"Looking for MIDI input port: ".post; "\"".post; name.post; "\"".postln;
		MIDIClient.list;
		while { a.not && (i < MIDIClient.sources.size) } {
			t = MIDIClient.sources[i].asString;
			t = t.replace("MIDIEndPoint", "");
			t.removeAt(0);
			t.removeAt(t.size - 1);
			t = t.replace("\"", "");
			a = t.containsi(name);

			d_name = t.split($,)[0];
			p_name = t.split($,)[1].stripWhiteSpace;

			i = i + 1;
		};

		if (a) {
			"Found: ".post; ~midiin_ports[sources_index][0] = MIDIIn.findPort(d_name, p_name).postln;
			~midiin_ports[sources_index][1] = MIDIIn.connect(0, ~midiin_ports[sources_index][0]);
			"Connected!".postln;
		} { "\"".post; name.post; "\"".post; " not found".postln };
	};

	// look for out ports and connect them using newByName
	out_ports = { |name, destinations_index|
		var d_name, p_name;

		t = nil; i = 0; a = false;
		"".postln;
		"Looking for MIDI output port: ".post; "\"".post; name.post; "\"".postln;
		MIDIClient.list;
		while { a.not && (i < MIDIClient.destinations.size) } {
			t = MIDIClient.destinations[i].asString;
			t = t.replace("MIDIEndPoint", "");
			t.removeAt(0);
			t.removeAt(t.size - 1);
			t = t.replace("\"", "");
			a = t.containsi(name);

			d_name = t.split($,)[0];
			p_name = t.split($,)[1].stripWhiteSpace;

			i = i + 1;
		};

		if (a) {
			"Found: ".post; ~midiout_ports[destinations_index][0] = MIDIClient.destinations[i - 1].postln;
			~midiout_ports[destinations_index][1] = MIDIOut.newByName(d_name, p_name);
			a = false;
			"Connected!".postln;
		} { "\"".post; name.post; "\"".post; " not found".postln; }
	};

	if (in.size > 0) {
		"".postln;
		"Activated MIDI input ports will be enumerated in ~midiin_ports".postln;
		for (0, in.size - 1) { |i|
			in_ports.value(in[i], i);
		}
	} { "".postln; "No input ports specified".postln; "".postln; };

	if (out.size > 0) {
		"".postln;
		"Activated MIDI output ports will be enumerated in ~midiout_ports".postln;
		for (0, out.size - 1) { |i|
			out_ports.value(out[i], i);
		}
	} { "".postln; "No output ports specified".postln };

	"".postln;
};

~findPorts = {
	MIDIIn.disconnectAll;
	Platform.case(
		\windows,  { // use Tobias Erichsen's LoopMidi to make system-wide multiclient MIDI ports

			~connectMIDIports.value(~ports_in, ~ports_out);
		},

		\osx, { // turn on IAC bus in Audio MIDI Settings app


			~connectMIDIports.value(~ports_in, ~ports_out);

			if (~midiout_ports[0].notNil) {
				~midiout = ~midiout_ports[0][1];
				~midiout.latency = 0.0;
			};
	});
};

~resetArrays = {
	"Re-initialising arrays!".postln;
	~notes = Array.fill2D(16, 128, { [nil, nil, nil, nil] });
	~notes_status = Array.fill2D(16, 128, { [0,0,0,0] });

	~most_recent_note = []; // array to keep track of notes in order played
	~velocities = Array.fill2D(16, 128, { 0 }); // stores on-velocities

	// sustain pedal array for sustained notes (note-off velocities)
	~sustain_pedal = 0;
	~sustained = Array.fill2D(16, 128, { -1 }); // stores off-velocities IF sustain pedal is on

	~controlchange = Array.fill(128, {0});
};


///////////////
//	        //
//   MTS   //
//        //
///////////


//read incoming real-time MTS, single note change
~mts_in = { |src, val|
	if ([val[0], val[1], val[2], val[3], val[4]] == [-16, 127, 127, 8, 2]) {
		if (val.size == 12) {
			var pitch, channel, note;
			pitch = (val[8] + (val[9]/128.0) + (val[10]/16384.0));
			note = val[7];
			~tuningMap[val[5]][note] = pitch;
			~tuningMap[~current_map][note] = pitch; // copy incoming data to map currently active in MIDI responder functions!

			if (~internal_synth && ~mts_bend) {
				if (~most_recent_note[0].notNil) {
					channel = ~most_recent_channel - 1;

					(0..3).do { |synth| if(~notes[channel][note][synth].isPlaying)
						{ ~notes[channel][note][synth].set(\freq, pitch.midicps) }
					}
				}
			};

			if (~post_mts) {
				"MTS received: ".post; "Map ".post; val[5].postln;
				"Note ".post; val[7].post; " => ".post; pitch.postln;
			};
		};
	};
};

//~mts_in.free;


//////////////////////////
//	                   //
//   MIDI FUNCTIONS   //
//                   //
//////////////////////

// note-on function
~on = MIDIFunc.noteOn({ |on_vel, num, chan, src|

	var formants, /*f_as_midi,*/ mpe_note=0, mpe_notekill=0, mpe_bend=8192, mpe_channel=(-1);

	o = 0; // set number of equaves transposition (default to no transposition)

	if (~multichannel) { // only transpose when multichannel is set to true
		o = (chan % 8) - ~main_channel + 1;
		while { o <= -4 } { o = o + 8 };
		while { o > 4 } { o = o - 8 };
	};

	m = ~equave ** o;// determine multiplier
	t = ~transpose * m;

	f = ~tuningMap[~current_map][num].midicps;

	if (~post_note) { "IN noteon: ".post; [chan + 1, num, on_vel].post; " & ".post; o.post; " equave(s)".postln;
	};

	if (on_vel > 0) {
		~most_recent_note = ~most_recent_note.removeEvery([num + (chan * 128)]);
		~most_recent_note = ~most_recent_note.addFirst(num + (chan * 128));
		//"most recent note: ".post; [(~most_recent_note[0] / 128).floor.asInteger + 1, ~most_recent_note[0] % 128].postln;
		~most_recent_channel = chan + 1; // 1-16
		~velocities[chan][num] = on_vel;
		~sustained[chan][num] = -1;
	};

	// built-in sound synthesis
	if (~internal_synth) {
		// kill any already-sounding synth on this chan/num slot before retriggering
		// (use direct .set rather than makeBundle+s.sync, which does not actually wait)
		(0..3).do { |synth| if (~notes[chan][num][synth].isPlaying)
			{
				~notes[chan][num][synth].set(\off_vel, on_vel, \gate, 0); // kill a sounding pitch on the same chan/num combination; synth node will disappear by itself
				~notes[chan][num][synth] = nil; // clear the slot
			};
		};

		if (~notes_status[chan][num][0] != false) {
			~notes[chan][num][0] = Synth(\pluck, [\freq, f, \transpose, t, \bend, ~bend, \on_vel, on_vel, \mod, ~controlchange[~mod_cc], \vol, ~levels[0].getValue, \gate, 1], ~servers[1]); //send to server1
			NodeWatcher.register(~notes[chan][num][0]);
			~notes_status[chan][num][0] = "p";
		} {
			~notes_status[chan][num][0] = "k";
			~notes[chan][num][0].set(\off_vel, on_vel, \gate, 0); // node will disappear by itself
			~notes[chan][num][0] = nil;
		};

		if (~notes_status[chan][num][1] != false) {
			~notes[chan][num][1] = Synth(\string, [\freq, f, \transpose, t, \bend, ~bend, \on_vel, on_vel, \mod, ~controlchange[~mod_cc], \vol, ~levels[1].getValue, \gate, 1], ~servers[2]);
			//send to server2
			NodeWatcher.register(~notes[chan][num][1]);
			~notes_status[chan][num][1] = "p";
		} {
			~notes_status[chan][num][1] = "k";
			~notes[chan][num][1].set(\off_vel, on_vel, \gate, 0); // node will disappear by itself
			~notes[chan][num][1] = nil;
		};

		if (~notes_status[chan][num][2] != false) {
			formants = { FormantTable.rand }.value;

			~notes[chan][num][2] = Synth(\formant, [\formant_freq, formants[0], \formant_reso, formants[1], \formant_amp, formants[2], \freq, f, \transpose, t, \bend, ~bend, \on_vel, on_vel, \mod, ~controlchange[~mod_cc], \vol, ~levels[2].getValue, \gate, 1], ~servers[3]);
			//send to server3
			NodeWatcher.register(~notes[chan][num][2]);
			~notes_status[chan][num][2] = "p";
		} {
			~notes_status[chan][num][2] = "k";
			~notes[chan][num][2].set(\off_vel, on_vel, \gate, 0); // node will disappear by itself
			~notes[chan][num][2] = nil;
		};

		if (~notes_status[chan][num][3] != false) { // FIX: was [2], must check slot [3] for \tone
			~notes[chan][num][3] = Synth(\tone, [\freq, f, \transpose, t, \bend, ~bend, \on_vel, on_vel, \mod, ~controlchange[~mod_cc], \vol, ~levels[3].getValue, \gate, 1], ~servers[4]);
			//send to server4
			NodeWatcher.register(~notes[chan][num][3]);
			~notes_status[chan][num][3] = "p"; // playing
		} {
			~notes_status[chan][num][3] = "k"; // killed
			~notes[chan][num][3].set(\off_vel, on_vel, \gate, 0); // node will disappear by itself
			~notes[chan][num][3] = nil;
		};
	};
});

//~on.free;


// note-off
~off = MIDIFunc.noteOff({ |off_vel, num, chan, src|
	var mpe_channel=(-1);

	if (off_vel == 0) {
		off_vel = ~velocities[chan][num];
	};
	~velocities[chan][num] = 0; // reset to 0 velocity

	if (~sustain_pedal == 0) {
		if (~post_note) { "IN noteoff: ".post;[chan + 1, num, off_vel].postln};

		~most_recent_note = ~most_recent_note.removeEvery([num + (chan * 128)]);
		/*if (~most_recent_note[0].notNil) {
		"most recent note: ".post; [(~most_recent_note[0] / 128).floor.asInteger + 1, ~most_recent_note[0] % 128].postln };*/

		// built-in sound synthesis
		if (~internal_synth) {
			(0..3).do { |synth| if (~notes[chan][num][synth].isPlaying) {
				~notes[chan][num][synth].set(\off_vel, off_vel, \gate, 0); // node will disappear by itself
				~notes[chan][num][synth] = nil;
				~notes_status[chan][num][synth] = 0; // reset to initial state (was "r"; never reset back to 0 before)
			} {
				if (~notes_status[chan][num][synth].isNil && synth==3) { ~notes_status[chan][num][synth] = false }
			}
			};
		};
	} { ~sustained[chan][num] = off_vel } // else if sustain pedal is pressed	store the off velocity data
});

//~off.free;


// polytouch further modifies brightness per note
~polytouch = MIDIFunc.polytouch({ |val, num, chan, src|
	var mpe_channel, mpe_note;

	~filter = (val + 1).linlin(1, 128, 1, 2);

	if (~post_polytouch) {
		"IN polytouch ".post; [chan + 1, num, val].postln;
	};

	if (~internal_synth) {
		(2..3).do { |synth| if (~notes[chan][num][synth].isPlaying) {
			~notes[chan][num][synth].set(\filter, ~filter)
		}};
	};
});

//~polytouch.free;


// apply pitch bend to last played note

~pitchbend = MIDIFunc.bend({ |val=8192, chan, src|
	var scaled, sign=1;
	var channel, note, mpe_val, mpe_channel, mpe_bend_offset, mpe_bend;

	if (~s_curve) { // apply a sinusoidal S-curve to incoming bend data
		scaled = val - 8192;
		if (scaled > 0) { sign = -1 } { sign = 1 };
		scaled = scaled / 8192;
		scaled = 4096 * sign * (scaled.cosPi - 1);
		scaled = 8192 + scaled;
		scaled = scaled.round.asInteger.clip(0, 16383);
		val = scaled;
	};

	if (~post_bend) {
		"IN bend ".post; [chan + 1, val].postln;
	};

	if (~internal_synth && ~mts_bend.not) {
		if (~most_recent_note[0].notNil) {
			channel = ((~most_recent_note[0] / 128).floor).asInteger;
			note = ~most_recent_note[0] % 128;
			// "bend-target: [".post; channel.post; ", ".post; note.post; "] ".postln;
			~bend = (val).clip(1,16383).linexp(1, 16383, 1 / ~bendwheel, ~bendwheel);
			(0..3).do { |synth| if(~notes[channel][note][synth].isPlaying)
				{ ~notes[channel][note][synth].set(\bend, ~bend) }
			}
		};
	};
});


//~pitchbend.free


// any cc converted to an exponential value between 1 and 2
~cc = MIDIFunc.cc({ |val, num, chan, src|
	c = (val+1).linexp(0,127,1,2); // i
	~controlchange[num] = c;

	if (~post_cc) {
		"IN cc ".post; [chan + 1, num, val].postln;
	};

	if (num == ~mod_cc) { // timbral modulation controller

		if (~internal_synth) {
			(0..15).do { |channel|
				(0..127).do { |note|
					(0..3).do { |synth| if(~notes[channel][note][synth].isPlaying)
						{ ~notes[channel][note][synth].set(\mod, ~controlchange[~mod_cc]) }
					}
				}
			}
		};
	};

	if (num == 64) { // sustain pedal
		~sustain_pedal = val;

		if (val > 0) {
			if (~post_cc) { "sustaining!".postln }
		}
		{ if (~post_cc) { "releasing!".postln };
			(0..15).do { |channel|
				(0..127).do { |note|
					if (~sustained[channel][note] >= 0) {

						if (~post_note) {
							"IN noteoff: ".post; [channel + 1, note, ~sustained[channel][note]].postln
						};

						~most_recent_note = ~most_recent_note.removeEvery([note + (channel * 128)]);

						if (~internal_synth) {
							(0..3).do { |synth|
								if (~notes[channel][note][synth].isPlaying) {
									~notes[channel][note][synth].set(\off_vel, ~sustained[channel][note], \gate, 0);
									~notes[channel][note][synth] = nil;
								};
							}
						};

						~sustained[channel][note] = -1; // reset the slot after releasing
					}
				}
			};
		}
	};

	if (num == 121) { // reset all controllers
		var vel;
		if (~sustain_pedal > 0) {
			~sustain_pedal = 0;
			if (~post_cc) { " releasing sustain pedal!".postln }
		};

		(0..127).do { |controller| ~controlchange[controller] = 1 };

		(0..15).do { |channel|
			(0..127).do { |note|
				vel = 64;
				if (~sustained[channel][note] >= 0)
				{ vel = ~sustained[channel][note];
					[channel, note, vel].post;
					" off-vel from sustain!".postln;
					~sustained[channel][note] = -1; // reset the slot
				}
				{ if (~velocities[channel][note] > 0) {
					vel = ~velocities[channel][note];
					[channel, note, vel].post;
					" off-vel = on-vel!".postln;
					~velocities[channel][note] = 0;
				}};

				~most_recent_note = ~most_recent_note.removeEvery([note + (channel * 128)]);

				if (~internal_synth) {
					(0..3).do { |synth| if (~notes[channel][note][synth].isPlaying)
						{ ~notes[channel][note][synth].set(\off_vel, vel, \gate, 0);
							~notes[channel][note][synth] = nil;
					}}
				};
			}
		};
	};

	if (num == 123) { // all notes off
		var vel;
		(0..15).do { |channel|
			(0..127).do { |note|
				vel = 64;
				if (~sustained[channel][note] >= 0) {
					// note held by sustain pedal — release it now (FIX: was an orphaned block, never executed)
					vel = ~sustained[channel][note];
					[channel, note, vel].post;
					" are held by sustain pedal — releasing!".postln;
					~sustained[channel][note] = -1;
					~most_recent_note = ~most_recent_note.removeEvery([note + (channel * 128)]);
					if (~internal_synth) {
						(0..3).do { |synth|
							if (~notes[channel][note][synth].isPlaying) {
								~notes[channel][note][synth].set(\off_vel, vel, \gate, 0);
								~notes[channel][note][synth] = nil;
						}};
					};
				} {
					if (~velocities[channel][note] > 0) {
						vel = ~velocities[channel][note];
						[channel, note, vel].post;
						" all-notes-off using-note-on-velocity!".postln;
						~velocities[channel][note] = 0;
					};

					~most_recent_note = ~most_recent_note.removeEvery([note + (channel * 128)]);

					if (~internal_synth) {
						(0..3).do { |synth|
							if (~notes[channel][note][synth].isPlaying) {
								~notes[channel][note][synth].set(\off_vel, vel, \gate, 0);
								~notes[channel][note][synth] = nil;
						}};

						4.do{ |i| ~servers[i+1].defaultGroup.set(\gate, 0) };

					};
				};
			};
		};
	};

	if (~internal_synth) {

		if (num == 4) { // level of pluck
			~levels[0].value = val.linlin(0,127,0,1);
			(0..15).do { |channel|
				(0..127).do { |note| if (~notes[channel][note][0].isPlaying)
					{ ~notes[channel][note][0].set(\vol,~levels[0].getValue)}
			}};
		};

		if (num == 14) { // level of buzz
			~levels[1].value = val.linlin(0,127,0,1);
			(0..15).do { |channel|
				(0..127).do { |note| if (~notes[channel][note][1].isPlaying)
					{ ~notes[channel][note][1].set(\vol,~levels[1].getValue)}
			}};
		};

		if (num == 9) { // level of formant
			~levels[2].value = val.linlin(0,127,0,1);
			(0..15).do { |channel|
				(0..127).do { |note| if (~notes[channel][note][2].isPlaying)
					{ ~notes[channel][note][2].set(\vol,~levels[2].getValue)}
			}};
		};

		if (num == 3) { // level of saw
			~levels[3].value = val.linlin(0,127,0,1);
			(0..15).do { |channel|
				(0..127).do { |note| if (~notes[channel][note][3].isPlaying)
					{ ~notes[channel][note][3].set(\vol,~levels[3].getValue)}
			}};
		};
	};

});

//~cc.free;

//~on.free; ~off.free; ~polytouch.free; ~pitchbend.free; ~cc.free;