// Offline comparison build. Never boots or changes a running audio server.
// Compile once; load these identical binaries into native SC and SuperSonic.
(
var root = thisProcess.nowExecutingPath.dirname.dirname.dirname;
var output = root +/+ "tools/supersonic/generated";
var source = File.readAllString(root +/+ "Synths/SuperCollider-OSC/LumatoneSynths.scd");
File.mkdir(output);
thisThread.randSeed = 260926;
// Lab formants free themselves when the existing gradual one-shot envelope
// finishes. Keep native performance definitions unchanged. Held/retrigger modes
// retain their original lifetime for any other consumer of these binaries.
source = source.replace(
    "curve: 'sin'), articulation_trigger);",
    "curve: 'sin'), articulation_trigger, doneAction: 2 * (1 - held_mode));"
);
// Namespace definitions and write files rather than .add to a live server.
source = source.replace("SynthDef(\\", "SynthDef(\\hexlab_");
source = source.replace("}).add.postln;", "}).writeDefFile(" ++ output.quote ++ ");");
try {
    source.interpret;
    "Hexatone comparison SynthDefs exported".postln;
    0.exit;
} { |error|
    error.reportError;
    1.exit;
};
)
