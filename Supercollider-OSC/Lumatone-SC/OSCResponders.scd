// OSCResponders.scd — direct OSC input from hexatone via osc-bridge
//
// hexatone owns node IDs and sends:
//   /s_new  synthName nodeId addAction targetGroup freq gate vol  → routed by synth name to correct server
//   /n_set  nodeId [key val ...]                                  → broadcast to all servers (unknown nodes ignored)
//   /n_free nodeId                                                → broadcast to all servers
//   /n_set on layer ports (57101-57104)                          → sent directly to scsynth, bypasses sclang
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
	(1..4).do { |i| ~servers[i].sendMsg(\n_set, nodeId, *args) };
}, '/n_set');

// /n_free — free a node (fallback; gate=0 in /n_set is the normal release path)
~osc_n_free = OSCFunc({ |msg, time, addr|
	var nodeId;
	nodeId = msg[1].asInteger;
	(1..4).do { |i| ~servers[i].sendMsg(\n_free, nodeId) };
}, '/n_free');

"OSCResponders loaded — listening for /s_new, /n_set, /n_free".postln;
