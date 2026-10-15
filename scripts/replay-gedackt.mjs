import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import createFluidSynth from '../vendor/fluidsynth/fluidsynth.js';

const font = readFileSync('/Users/marcsabat/soundfonts/PlainsoundOrganGedackt.sf2');
const wasm = readFileSync(new URL('../vendor/fluidsynth/fluidsynth.wasm', import.meta.url));
const source = readFileSync(new URL('../vendor/fluidsynth/processor.js', import.meta.url), 'utf8').replace(/^import .*\n/, '');
// Exact note timing from the supplied log, relative to 01:56:41.194.
const pairs = [[0,60,85],[661,62,735],[1215,60,1305],[1882,62,1950],
  [2482,60,2849],[2849,62,3218],[3218,60,3584],[3584,62,3937],
  [3937,60,4320],[4320,62,4552],[4552,64,4838],[4838,66,4935],
  [4935,64,5100],[5100,62,5250],[5250,60,5370],[5370,62,5454],
  [5454,64,5684],[5684,62,5769],[5769,60,5933],[5933,62,6014],
  [6014,64,6120]];

async function replay(mode) {
  let Processor, ready;
  const readyPromise = new Promise(resolve => { ready = resolve; });
  const context = { createFluidSynth, sampleRate:48000, currentFrame:0, currentTime:0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage(message) {
      if(message.type === 'ready') ready();
      if(message.type === 'error') throw new Error(message.message);
    }}; }}, registerProcessor:(_name, implementation) => { Processor = implementation; }};
  runInNewContext(source, context);
  const processor = new Processor({processorOptions:{wasmBytes:wasm}});
  await readyPromise;
  processor.handleMessage({type:'load-soundfont',bytes:font});
  processor.handleMessage({type:'select-program',bank:0,program:0});
  processor.dispatchMidi([0xb0,7,100]);
  const events = [];
  for(const [on,note,off] of pairs) {
    events.push({ms:on,note,on:true},{ms:off,note,on:false});
  }
  // Stable sort preserves previous note-off before the next note-on.
  events.sort((a,b)=>a.ms-b.ms);
  const output = new Float32Array(48000*8);
  let eventIndex=0;
  const channels=[new Float32Array(128),new Float32Array(128)];
  for(let frame=0;frame<output.length;frame+=128) {
    while(eventIndex<events.length && Math.round(events[eventIndex].ms*48)<=frame) {
      const event=events[eventIndex++];
      if(event.on && mode !== 'notes') {
        processor.dispatchMidi([0xe0,0,64]);
        processor.dispatchMidi([0xb0,74,64]);
        processor.dispatchMidi([0xd0,0]);
      }
      if(event.on && mode === 'mts') processor.dispatchMidi([
        0xf0,127,127,8,2,0,1,event.note,event.note,0,0,0xf7]);
      processor.dispatchMidi([event.on?0x90:0x80,event.note,event.on?72:0]);
      if(!event.on && mode !== 'notes') processor.dispatchMidi([0xd0,0]);
    }
    context.currentFrame=frame; context.currentTime=frame/48000;
    processor.process([], [channels]);
    output.set(channels[0].subarray(0,Math.min(128,output.length-frame)),frame);
  }
  let peak=0,maxStep=0;
  for(let i=1;i<output.length;i++) {
    peak=Math.max(peak,Math.abs(output[i]));
    maxStep=Math.max(maxStep,Math.abs(output[i]-output[i-1]));
  }
  processor.module._ps_destroy(processor.synth);
  return {output,peak,maxStep};
}
const results={};
for(const mode of ['notes','controllers','mts']) {
  results[mode]=await replay(mode);
  console.log(mode, {peak:results[mode].peak,maxSampleStep:results[mode].maxStep});
}
for(const mode of ['controllers','mts']) {
  let maxDifference=0;
  for(let i=0;i<results.notes.output.length;i++) maxDifference=Math.max(maxDifference,
    Math.abs(results.notes.output[i]-results[mode].output[i]));
  console.log(mode,'versus notes-only maximum waveform difference:',maxDifference);
}
