# FluidSynth browser assets

Hexatone's experimental built-in SoundFont player uses FluidSynth 2.6.1,
compiled to WebAssembly and hosted in a JavaScript `AudioWorkletProcessor`.
These assets are kept separate from the app source so their upstream origin,
licenses, corresponding source and build inputs remain clear.

## Source and licenses

- FluidSynth source: upstream commit `71e85b2ca6bf48641ba7e2261d8f2640ae473773`
  from the Plainsound fork of `FluidSynth/fluidsynth`, release 2.6.1.
- `gcem`: submodule commit `012ae73c6d0a2cb09ffe86475f5c6fba3926e200`.
- `signalsmith-audio-basics`: submodule commit
  `012d2be17b0eb6839628f8c73687c4ccccc1bb01`.
- The FluidSynth build changes its project C++ standard from C++11 to C++17;
  that one-line source patch is in `sources/emscripten-cxx17.patch`.
- The Hexatone-specific adapter is `sources/adapter_core.cpp`.

Corresponding upstream source snapshots are supplied under `sources/` as
archives. The adapter and patch are included alongside them. License texts for
the linked components are in `licenses/`: FluidSynth is LGPL-2.1, GCEM is
Apache-2.0, and Signalsmith Audio Basics is MIT. See each license for its full
terms. The source archives retain their upstream license and notice files too.

## Build provenance

The runtime was built with Emscripten SDK 4.0.21 and CMake 4.4.3 from the
FluidSynth 2.6.1 source snapshot and the dependency revisions above. The
FluidSynth library is single-threaded and does not use Wasm Workers,
`SharedArrayBuffer`, or cross-origin isolation. Audio rendering is hosted by
`processor.js` in a browser AudioWorklet. The complete build and integration
notes are in `_codex/FLUIDSYNTH_WASM_INTEGRATION_REPORT.md`.

`manifest.json` identifies the bundled version, source revisions and SHA-256
for every shipped file. `yarn fluidsynth:assets` verifies the manifest and
stages these files into the ignored `public/fluidsynth/` directory before the
app build. To update the runtime, rebuild the engine, replace the corresponding
files in this vendor directory, update source snapshots/license files as
needed, then run the manifest generator and the browser/backend tests before
committing the vendor bundle.
