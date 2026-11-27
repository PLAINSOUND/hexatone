# FluidSynth browser assets

Hexatone's experimental built-in SoundFont player uses the Plainsound FluidSynth fork,
compiled to WebAssembly and hosted in a JavaScript `AudioWorkletProcessor`.
These assets are kept separate from the app source so their upstream origin,
licenses, corresponding source and build inputs remain clear.

## Source and licenses

- FluidSynth source: the working-tree snapshot `sources/fluidsynth-smoothing.tar.gz`.
  Its base commit is recorded in `manifest.json`; the archive includes the
  uncommitted attenuation smoothing implementation used by this runtime.
- `gcem`: submodule commit `012ae73c6d0a2cb09ffe86475f5c6fba3926e200`.
- `signalsmith-audio-basics`: submodule commit
  `012d2be17b0eb6839628f8c73687c4ccccc1bb01`.
- The snapshot already includes the C++17 build change. The older release
  archive and `sources/emscripten-cxx17.patch` are retained for reference.
- The Hexatone-specific adapter is `sources/adapter_core.cpp`.

Corresponding upstream source snapshots are supplied under `sources/` as
archives. The adapter and patch are included alongside them. License texts for
the linked components are in `licenses/`: FluidSynth is LGPL-2.1, GCEM is
Apache-2.0, and Signalsmith Audio Basics is MIT. See each license for its full
terms. The source archives retain their upstream license and notice files too.

## Build provenance

The Hexatone adapter calibrates the default pitch-wheel modulator to 12800
cents. FluidSynth normalizes pitch-wheel sensitivity over 128 steps, so the
stock 12700-cent amount undershoots RPN bend ranges by 1/128 (9.375 cents per
octave). SoundFont-specific modulation overrides and recorded samples are
unchanged. `node tools/fluidsynth/pitch-smoke.mjs` checks the rendered WASM
pitch using a generated sine SoundFont; an optional bank path and program
number also check real instruments without a browser or MIDI device.

The runtime was built with Emscripten SDK 4.0.21 and CMake 4.4.3 from the
FluidSynth 2.6.1 source snapshot and the dependency revisions above. The
FluidSynth library is single-threaded and does not use Wasm Workers,
`SharedArrayBuffer`, or cross-origin isolation. Audio rendering is hosted by
`processor.js` in a browser AudioWorklet. The complete build and integration
command is `node tools/fluidsynth/build-runtime.mjs /path/to/fluidsynth /path/to/emscripten`.
It requires the initialized GCEM and Signalsmith submodules; matching dependency
archives are supplied in `sources/`. It packages the exact working-tree sources
and updates the manifest after building.

Pressure Smoothing and Expression Y Smoothing each accept 0–500 milliseconds in Hexatone;
zero bypasses slew. Pressure covers key and channel pressure; Expression Y covers
CC1 and CC74. Only existing unipolar linear/concave/convex attenuation modulators
are eligible, with eight routes per voice. Other destinations and unsupported
curves stay immediate. Times describe a full 127-unit move, so smaller moves
complete proportionally faster. A new note starts at the current controller value.
Live fader messages are coalesced to the newest values and applied at most 30
times per second, at render boundaries. Unchanged native settings are skipped
to avoid unnecessary per-voice callback scans. The underlying fork settings
still support up to 500 ms for other hosts.

Minimum Smoothing is shared by pressure and Expression Y, defaults to zero,
and cannot exceed the lowest enabled full-range time. A change of normalized
distance d takes max(minimum, full-range time * d). Each target change starts
a linear ramp from the current rendered value; identical targets do not restart
it. Equal minimum and full-range times give fixed-duration ramps. Zero full-range
time bypasses smoothing, even when the minimum is nonzero.

Optional latency diagnostics timestamp rendered attack blocks and observe the
first non-silent mixed-output block after 20 ms of silence. They do not measure
speaker onset. Signal scanning is disabled outside diagnostic sessions; pending
onset observations are bounded and expire after two seconds. SoundFont loading
also reports virtual-file, native-load and preset-setup durations.

`manifest.json` identifies the bundled version, source revisions and SHA-256
for every shipped file. `yarn fluidsynth:assets` verifies the manifest and
stages these files into the ignored `public/fluidsynth/` directory before the
app build. To update the runtime, rebuild the engine, replace the corresponding
files in this vendor directory, update source snapshots/license files as
needed, then run the manifest generator and the browser/backend tests before
committing the vendor bundle.

SoundFont and preset changes preserve the native synth, held voices, tuning maps,
and queued MIDI releases. New attacks use the newly selected bank/program.
Recently used native banks and their virtual files are kept under an estimated
256 MiB LRU budget (twice file bytes). The selected bank is always retained;
playing voices temporarily pin other banks. Eviction runs only when native
voices and the audible reverb tail are idle. Cache state and staged-byte counts are exposed in diagnostics.
A resident bank switches immediately without parsing. A cold bank selected
while voices play is staged until a new attack (or natural silence). A new
attack first fades the mixed FluidSynth output to zero over 40 ms; only the
following block installs the bank and dispatches queued events. Thus the first
cold attack is delayed by fade plus native loading; no background loading is
claimed. Staged requests may be replaced or canceled without locking the UI.
Cached selections are queried only after the processor advertises that key,
so older running worklets cannot strand the UI on an unsupported request.
The adapter guards unloading against active voices to avoid FluidSynth's threaded
lazy-unload path. A single-threaded Emscripten priority setter reports ENOTSUP;
threaded runtimes retain their native implementation. The core source snapshot is
unchanged; these lifecycle exports are supplied by the updated adapter.
