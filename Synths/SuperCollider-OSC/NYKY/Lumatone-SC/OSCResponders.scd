// OSCResponders.scd — direct OSC input from hexatone via osc-bridge
//
// hexatone owns node IDs and sends:
//   /s_new  synthName nodeId addAction targetGroup freq gate vol
//   /n_set  nodeId [key val ...]
//   /n_free nodeId
//
// No state-tracking arrays, no isPlaying checks, no MIDIFuncs.
// The SC side just routes /s_new to the correct server based on synth name.
//
// Server routing (matches LumatoneSynths.scd):
//   \pluck   → ~servers[1]
//   \string  → ~servers[2]
//   \formant → ~servers[3]
//   \tone    → ~servers[4]

// Map synth name → server index, matching the assignment in HelperFunctionsSynth
~osc_server_map = Dictionary.newFrom([
	\pluck,   1,
	\string,  2,
	\formant, 3,
	\tone,    4,
]);

// /s_new  — create a synth node
// Args: synthName(s) nodeId(i) addAction(i) targetGroup(i) [key(s) val(f) ...]
// The browser always sends vol:1.0; we override it with the current fader level.
~osc_s_new = OSCFunc({ |msg, time, addr|
	var synthName, nodeId, addAction, targetGroup, args, serverIdx, srv, volIdx;

	synthName   = msg[1].asSymbol;
	nodeId      = msg[2].asInteger;
	addAction   = msg[3].asInteger;
	targetGroup = msg[4].asInteger;
	args        = msg[5..].asArray;

	serverIdx = ~osc_server_map[synthName];
	if (serverIdx.notNil) {
		// Inject current fader level — replace the vol value in args
		volIdx = args.indexOf(\vol);
		if (volIdx.notNil) {
			args[volIdx + 1] = ~levels[serverIdx - 1].getValue;
		};

		srv = ~servers[serverIdx];
		srv.sendMsg(\s_new, synthName, nodeId, addAction, targetGroup, *args);
	} {
		("OSCResponders: unknown synth name — " ++ synthName).postln;
	};
}, '/s_new');

// /n_set — set parameters on a running node
// Args: nodeId(i) [key(s) val(f) ...]
// We broadcast to all servers since we don't track which server owns each node.
// scsynth silently ignores /n_set for unknown node IDs, so this is safe.
~osc_n_set = OSCFunc({ |msg, time, addr|
	var nodeId, args;
	nodeId = msg[1].asInteger;
	args   = msg[2..];
	// Broadcast to all synth servers (1..4) — safe, unknown nodes are ignored
	(1..4).do { |i| ~servers[i].sendMsg(\n_set, nodeId, *args) };
}, '/n_set');

// /n_free — free a node (fallback; gate=0 in /n_set is the normal release path)
~osc_n_free = OSCFunc({ |msg, time, addr|
	var nodeId;
	nodeId = msg[1].asInteger;
	(1..4).do { |i| ~servers[i].sendMsg(\n_free, nodeId) };
}, '/n_free');

"OSCResponders loaded — listening for /s_new, /n_set, /n_free".postln;
