# SuperSonic / native SuperCollider comparison

Comparison laboratory using pinned SuperSonic 0.88.0 packages. The separate lab
does not modify Hexatone's audio context or routing. An experimental integrated
output is now available separately in I/O (see below).
Use one laboratory tab at a time; its dedicated group/node range is shared by
instances. Start with low listening volume.

## Integrated Hexatone output (experimental)

Run `yarn install` and `yarn supersonic:assets` for local development.
The tested custom core, SynthDefs and corresponding source archives are committed
under `vendor/supersonic/`. Staging verifies their SHA-256 manifest and copies them,
the pinned npm client and licences into ignored `public/supersonic/`.
`yarn build` stages automatically, including in GitHub Pages CI. No Rust,
Emscripten or SuperCollider installation is required for ordinary deployment.
Pages serves the source archives alongside the engine at
`/hexatone/supersonic/sources/`; see `/hexatone/supersonic/README.md`.

Maintainers changing DSP must rebuild the core or recompile SynthDefs as described
below, test them, then run `node tools/supersonic/package-assets.mjs` and commit
the updated vendor bundle/manifest together with the source edits. Run staging
again before testing the integrated output. Generated working files remain ignored.

Enable **OSC** in I/O. **Local SuperSonic
(experimental)** and Retrigger default on; raster-only release defaults off.
The four layer faders, quick-release and retrigger
controls are shared with the external backend. Unchecking restores the external
bridge URL. A destination change panics the old output, then the normal live
output handoff replays held voices after the new candidate is ready. Other
outputs and logical held-note state are retained. Restore I/O also stores this
choice. Local mode creates no WebSocket connection.

Ordinary output-off releases voices and keeps the old engine alive until its
tails end; it rejects new notes while draining. Future attacks are purged before
the gates are released. PANIC also stops these retired engines. An eight-second
cleanup fallback and a four-retiring-engine limit bound resources during rapid
toggles. Changing local/external destination still uses immediate panic.

One local engine owns four layer groups and an isolated audio context; no
application-wide audio context or server root is shared with the comparison lab.
Sequencer timestamps are converted to the audio clock. Local PANIC clears queued
events, and disposal closes the engine/context and removes gesture listeners.
Failed/stale candidates use the normal async output cleanup path. Missing assets
or definitions fail visibly in the console rather than silently substituting a
different filter. This first integration needs real-device/mobile and fast
polyphonic playback testing; it is not yet a replacement for the native setup.

Regression checks: `yarn test src/supersonic_synth src/osc_synth/index.test.js
src/hooks/use-synth-wiring-lifecycle.test.jsx`. With Vite on port 5176, run
`node tools/supersonic/integration-smoke.mjs` (or set `HEXATONE_TEST_URL`).

For the Pages production-path check, build with `VITE_BASE_PATH=/hexatone/ yarn build`,
serve with `VITE_BASE_PATH=/hexatone/ yarn preview --host 127.0.0.1 --port 5176`,
then run `HEXATONE_TEST_URL=http://127.0.0.1:5176/hexatone node tools/supersonic/integration-smoke.mjs --production`.
This uses the actual bundled adapter and checks audible output, scheduled-note
cancellation, PANIC, smooth release and engine disposal. The browser test needs
the upstream Playwright installation described below; ordinary CI builds do not.

## Prepare

Run `yarn install`, then compile the existing Lumatone definitions:

```sh
/Applications/SuperCollider.app/Contents/MacOS/sclang -D tools/supersonic/compile.scd
```

On another OS use the installed `sclang` executable with the same arguments.
The compiler requires the same extensions as your normal SuperCollider setup,
including DFM1. It does not boot an audio server. Generated files are ignored by
Git; regenerate after changing the source. The fixed language random seed keeps
compile-time choices reproducible. Audio noise/Dust remain stochastic.

Run `yarn start` and open `/supersonic-lab.html` on the displayed localhost URL.
Select **Local build + DFM1** (build instructions below), or the stock package for
comparison, then click **Boot SuperSonic and check definitions**. Reload the page
to change cores. The log reports each definition's
load result individually: native compilation does not prove browser compatibility.
No CDN or downloaded sound pack is used. Core WASM assets remain separately served
from node_modules or the ignored generated directory, not bundled into the application.

## Build the DFM1 core

Toolchain versions are recorded in `TOOLCHAIN.md`. Fetch the pinned sources once:

```sh
git clone https://github.com/samaaron/supersonic.git tools/supersonic/upstream-088
git -C tools/supersonic/upstream-088 checkout 8a82576df1e6367484ed9ea711e2cc19267f986a
git -C tools/supersonic/upstream-088 submodule update --init --recursive
git clone https://github.com/supercollider/sc3-plugins.git tools/supersonic/sc3-plugins
git -C tools/supersonic/sc3-plugins checkout fa926d6b554acef35b2fd9deb2f996085fa86bd7
```

Run `npm ci` inside `tools/supersonic/upstream-088`. Activate the installed Emscripten
SDK in the build shell (`source /Users/marcsabat/Dev/emsdk/emsdk_env.sh` on this
machine), with Rust/Cargo on PATH. Before applying the extension, the optional
unmodified comparison core can be built and saved from the upstream directory:

```sh
bash scripts/build-web.sh --release
mkdir -p ../generated/baseline-core
cp -R packages/supersonic-scsynth-core/. ../generated/baseline-core/
```

Then from Hexatone's root:

```sh
bash tools/supersonic/build-dfm1.sh
node tools/supersonic/browser-smoke.mjs dfm1
node tools/supersonic/browser-smoke.mjs dfm1 sab
```

The script checks source revisions, applies `dfm1-registration.patch`, and copies
the eight original TJUGens/DFM1 source files into the static plugin build. No DSP
substitution or source alteration is made. The resulting core is saved under
`generated/dfm1-core`; the npm-installed core remains untouched. The build can be
repeated with the patch already applied. Do not overwrite the baseline with a
patched build. Source checkouts and binaries are ignored by Git.

The smoke test uses upstream's installed Playwright dependency and local Brave;
set `HEXATONE_BROWSER` to another Chromium executable if needed. It renders each
instrument, checks finite nonzero output, and exercises parameter changes and
cleanup. This is not a native/browser waveform-equivalence or latency test.

DFM1 is GPL-licensed: its licence is copied to `DFM1-COPYING` beside the core's
licence. Any distribution of this custom binary must also meet the applicable
source-distribution requirements; retain the pinned sources and integration patch.
The current toolchain emits a nonfatal Rust debug-stripping warning about missing
`libLLVM.dylib`; both builds completed despite it.

## Native comparison

1. In SuperCollider open and evaluate `tools/supersonic/native.scd` as a saved file.
   It loads the SAME compiled files into the default server; it does not replace
   the existing `pluck`, `string`, `formant` or `tone` definitions.
2. Note the server port printed in SuperCollider (normally 57110).
3. Run `yarn osc-bridge` in another terminal.
4. Enter that native server port in the page, then connect the bridge.
5. Select browser or native destination, choose a sound and press Attack. Change
   frequency, mod, filter, level and retrigger settings while sounding.
   Release ends the gate; PANIC frees only the laboratory group, including tails.

Changing destination clears both comparison groups to avoid overlapping A/B tails.
Native replies are not forwarded by the existing bridge: watch the SC post window
for load/node errors. A connected WebSocket is NOT confirmation of a running server.
If the bridge drops while native notes are held, stop those notes in SuperCollider;
unload cleanup cannot be guaranteed after a connection is lost.

This is manual A/B, not a synchronised latency benchmark. Use matching hardware
sample rate, comparable output levels and the same audio device. Built-in formant
filters are randomly selected per attack from Hexatone's vocal preset table on
both destinations. Separate attacks may therefore use different vowels; they are
not an identical-preset A/B test. Formant uses its gradual one-shot envelope and
automatically frees itself on completion when Retrigger is off. Retrigger applies
to both Buzz and Formant; the old Sustain control is retired.
Recompile definitions and reload them on both destinations after this change.
No external four-server OSC dispatcher is needed for this test.

The shared Lumatone definitions cycle independently per layer and per held note.
Each envelope finishes, then waits a random interval before restarting. Buzz
re-excites Pluck each time (rather than merely modulating a decaying excitation),
with a 3–6 s swell, 1–3 s plateau, 3–6 s decay and 1–4 s gap, randomly varied
per cycle (the quicker non-retriggered shape is unchanged). Formant cycles last 8–16 s with
1–9 s gaps, and choose fresh vocal filters each time. Non-cycling formants retain
the shorter live-playing envelope. FormantTable is required by sclang at compile
time; its 25 presets become SynthDef constants, not a runtime browser extension.
This is inspired by ElectricTanpura's Pbinds, not an exact reproduction: it uses
one bounded voice per layer/note, without their overlapping stereo child voices.
All recurrence lives in the DSP graph, with no main-thread timers or animation
frames. Note-off stops recurrence and retains the natural/quick-release policy.
Saved Sustain settings are ignored. Re-evaluate
`Synths/SuperCollider-OSC/LumatoneSynths.scd` in the native setup
after updating; recompile/stage local definitions and reload Hexatone for WASM.
`node tools/supersonic/browser-smoke.mjs dfm1 postMessage envelopes` additionally
checks the held attack and natural versus overridden note-off lifetimes.
Use `node tools/supersonic/browser-smoke.mjs dfm1 postMessage cycles` for the
longer recurrence check: it renders each layer for 44 seconds and checks later
audible cycles, quiet gaps and release cleanup. Both passed on 2026-09-27.

## Limits and next gate

Verified on 2026-09-26: installed SuperCollider 3.14.1 compiled all five definitions.
The unmodified local core booted in headless Brave at 48 kHz using postMessage;
string and formant rendered, while pluck and tone failed with
`UGen 'DFM1' not installed.` With the original DFM1 compiled in, all four
instruments loaded and rendered finite, nonzero audio without server errors in
both postMessage and SharedArrayBuffer modes.
The page
checks server failure replies plus a sync barrier because loadSynthDef's promise
alone resolved even for these failures. No filter substitution has been made.
Audible native/browser comparison and mobile performance remain user test steps.
Three adapter tests, ESLint for the prototype, credits check and production build passed.

- The comparison page has a single logical note at a time, with normal release
  overlap. The integrated output uses OSC's existing polyphonic voice interface.
  No cyclic child-voice generation or SoundFont layer yet.
- Uses legacy instrument controls, not a new universal pressure mapping.
- Natural browser node completion clears the laboratory's active node reference.
  Native completion cannot be observed through the one-way bridge; late updates
  to naturally completed native plucks can report a missing node harmlessly.
- The separate prototype context is deliberate. Production integration must use
  shared audio ownership and preserve Hexatone's mobile recovery and sound handoff.
- Next gate: confirm compatible definitions and audible A/B behaviour, then add
  recorded expression trajectories and bounded polyphonic comparison tests before
  exposing SuperSonic as an ordinary Hexatone output.

See ../../codex/planning/SUPERSONIC_SYNTHDEF_IMPLEMENTATION_NOTES.md for the DSP
comparison and articulation recommendations. The client and core dependency
licences are supplied in their installed packages (MIT client, GPL core).
