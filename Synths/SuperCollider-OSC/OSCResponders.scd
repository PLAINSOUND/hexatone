// OSCResponders.scd — direct OSC input from hexatone via osc-bridge
//
// hexatone owns node IDs and sends:
//   /s_new  synthName nodeId addAction targetGroup freq gate vol  → routed by synth name to correct server
//   /n_set  nodeId [key val ...]                                  → broadcast to all servers (unknown nodes ignored)
//   /n_free nodeId                                                → broadcast to all servers
//   /n_set on layer ports (57101-57104)                           → sent directly to scsynth, bypasses sclang
//
// The volume faders send /n_set to node 1 (default group) directly on the scsynth
// server ports (57101-57104) via osc-bridge — sclang is not in that path.
//
// Server routing (matches LumatoneSynths.scd):
//   \pluck   → ~servers[1]  port 57101
//   \string  → ~servers[2]  port 57102
//   \formant → ~servers[3]  port 57103
//   \tone    → ~servers[4]  port 57104

// Map synth name → server index, matching the assignment in HelperFunctionsSynth

~osc_server_map = Dictionary.newFrom([
	\pluck,   1,
	\string,  2,
	\formant, 3,
	\tone,    4,
]);

[
	\osc_s_new,
	\osc_n_set,
	\osc_n_free,
	\osc_jitter,
	// Temporary tone debug responders retained for future use.
	// \tone_on_debug,
	// \tone_gate_debug,
	// \tone_env_done_debug,
	// \tone_silence_debug,
].do { |name|
	var responder = currentEnvironment.at(name);
	if (responder.notNil) { responder.free };
};

// /s_new  — create a synth node
// Args: synthName(s) nodeId(i) addAction(i) targetGroup(i) [key(s) val(f) ...]
// Hexatone sends the current layer volume in the \vol arg, so note-ons reflect
// the browser mixer state immediately after refresh or UI changes.

~osc_s_new = OSCFunc({ |msg, time, addr|
	var synthName, nodeId, addAction, targetGroup, args, serverIdx, srv;

	synthName   = msg[1].asSymbol;
	nodeId      = msg[2].asInteger;
	addAction   = msg[3].asInteger;
	targetGroup = msg[4].asInteger;
	args        = msg[5..].asArray;

	serverIdx = ~osc_server_map[synthName];
	if (serverIdx.notNil) {
		srv = ~servers[serverIdx];
		srv.sendMsg(\s_new, synthName, nodeId, addAction, targetGroup, *args);
	} {
		("OSCResponders: unknown synth name — " ++ synthName).postln;
	};
}, '/s_new');

// /n_set — set parameters on a running node
// Args: nodeId(i) [key val ...]
// Broadcast to all servers — scsynth silently ignores unknown node IDs.

~osc_n_set = OSCFunc({ |msg, time, addr|
	var nodeId, args;
	nodeId = msg[1].asInteger;
	args   = msg[2..];
	// Temporary sclang-side gate-off trace retained for future debugging.
	// if (args.includesEqual(\gate) and: { args.includesEqual(0) }) {
	// 	("OSCResponders /n_set gate=0 node " ++ nodeId ++ " args: " ++ args).postln;
	// };
	(1..4).do { |i| ~servers[i].sendMsg(\n_set, nodeId, *args) };
}, '/n_set');

// /n_free — free a node (fallback; gate=0 in /n_set is the normal release path)

~osc_n_free = OSCFunc({ |msg, time, addr|
	var nodeId;
	nodeId = msg[1].asInteger;
	// Temporary sclang-side n_free trace retained for future debugging.
	// ("OSCResponders /n_free node " ++ nodeId).postln;
	(1..4).do { |i| ~servers[i].sendMsg(\n_free, nodeId) };
}, '/n_free');

~osc_jitter_last_ms = nil;

// /hex/jitter — browser/bridge timing probe for OSC jitter measurement
// Args:
//   seq(i) kind(s) browserPerfMs(f) browserDeltaMs(f) voiceId(i)
//   bridgePerfMs(f) bridgeDeltaMs(f)
~osc_jitter = OSCFunc({ |msg, time, addr|
	var seq, kind, browserPerf, browserDelta, voiceId, bridgePerf, bridgeDelta, scNowMs, scDelta;
	seq = msg[1].asInteger;
	kind = msg[2].asString;
	browserPerf = msg[3].asFloat;
	browserDelta = msg[4].asFloat;
	voiceId = msg[5].asInteger;
	bridgePerf = msg[6].asFloat;
	bridgeDelta = msg[7].asFloat;
	scNowMs = SystemClock.seconds * 1000;
	scDelta = if(~osc_jitter_last_ms.notNil) { scNowMs - ~osc_jitter_last_ms } { 0 };
	~osc_jitter_last_ms = scNowMs;
	(
		"OSCJIT seq=" ++ seq
		++ " kind=" ++ kind
		++ " voice=" ++ voiceId
		++ " browserΔ=" ++ browserDelta.round(0.001)
		++ "ms bridgeΔ=" ++ bridgeDelta.round(0.001)
		++ "ms scΔ=" ++ scDelta.round(0.001)
		++ "ms"
	).postln;
}, '/hex/jitter');

// Temporary tone SendReply responders retained for future debugging.
// These post in sclang even though note / gate messages are being sent directly
// to the layer server ports, because SendReply travels from the synth node back
// to the language process.
//
// ~tone_on_debug = OSCFunc({ |msg|
// 	var nodeId = msg[3].asInteger;
// 	var freq = msg[4];
// 	var onVel = msg[5];
// 	var offVel = msg[6];
// 	var releaseTime = msg[7];
// 	("toneOn node=" ++ nodeId
// 		++ " freq=" ++ freq
// 		++ " on_vel=" ++ onVel
// 		++ " off_vel=" ++ offVel
// 		++ " release_time=" ++ releaseTime).postln;
// }, '/toneOn');
//
// ~tone_gate_debug = OSCFunc({ |msg|
// 	var nodeId = msg[3].asInteger;
// 	var gate = msg[4];
// 	var offVel = msg[5];
// 	var releaseTime = msg[6];
// 	("toneGateOff node=" ++ nodeId
// 		++ " gate=" ++ gate
// 		++ " off_vel=" ++ offVel
// 		++ " release_time=" ++ releaseTime).postln;
// }, '/toneGateOff');
//
// ~tone_env_done_debug = OSCFunc({ |msg|
// 	var nodeId = msg[3].asInteger;
// 	var releaseTime = msg[4];
// 	("toneEnvDone node=" ++ nodeId
// 		++ " release_time=" ++ releaseTime).postln;
// }, '/toneEnvDone');
//
// ~tone_silence_debug = OSCFunc({ |msg|
// 	var nodeId = msg[3].asInteger;
// 	("toneSilence node=" ++ nodeId).postln;
// }, '/toneSilence');

"OSCResponders loaded — listening for /s_new, /n_set, /n_free, /hex/jitter".postln;
