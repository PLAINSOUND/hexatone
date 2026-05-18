// servers
5.do { |i| ~servers[i].reboot}; // reboot all
5.do { |i| ~servers[i].quit}; // quit all
5.do { |i| ~servers[i].boot}; // boot all

// post window
(
~post_mts = true;
~post_note = true;
);

~post_bend = true;
~post_polytouch = true;
~post_cc = true;

(
~post_mts = false;
~post_note = false;
);

~post_bend = false;
~post_polytouch = false;
~post_cc = false;

// built-in audio
~headphones = ~to_headphones.play(~servers[0]); // play on headphones
~headphones.free;
~speakers = ~to_speakers.play(~servers[0]); // play on speakers
~speakers.free;

// MIDI ports
~ports_in = ["mts"]; ~ports_out = []; // set MIDI ports!

// SYSEX
MIDIIn.addFuncTo(\sysex, ~mts_in); "MTS input activated".postln; "".postln;// respond to MTS, alters built-in tuning map; run after activating MIDIClient and ports ....
MIDIIn.removeFuncFrom(\sysex, ~mts_in); "MTS input deactivated".postln; "".postln;

( // kill MIDI responder functions
~mts_in.free; ~mts_out.free;
~on.free; ~off.free; ~polytouch.free; ~pitchbend.free; ~cc.free;
MIDIClient.disposeClient; // kill MIDI
"HelperFunctionsSynth.scd".loadRelative; //reload functions
);

( // reset MIDI ports if you change them.
MIDIClient.disposeClient; // kill MIDI
~resetArrays.value(); ~findPorts.value();
"Active MIDIEndPoints:".postln;
"In: ".postln; ~midiin_ports.do ({ |item, index| "~midiin_ports[0][".post; index.post; "]: ".postln; item[0].postln });
"Out: ".postln; ~midiout_ports.do ({ |item, index| "~midiout_ports[0][".post; index.post; "]: ".postln; item[0].postln }); "".postln;
);