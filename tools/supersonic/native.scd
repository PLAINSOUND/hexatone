// Evaluate this file in SuperCollider. Uses the default server, not the four
// existing Hexatone OSC servers. Does not kill/reboot servers or alter routing.
(
var directory = thisProcess.nowExecutingPath.dirname +/+ "generated";
s.waitForBoot {
    (directory +/+ "*.scsyndef").pathMatch.do { |path| s.sendMsg(\d_load, path) };
    s.sync;
    "Comparison definitions loaded. Browser native port should match:".postln;
    s.addr.port.postln;
};
)
