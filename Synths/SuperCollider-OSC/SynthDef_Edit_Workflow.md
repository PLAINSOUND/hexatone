# SynthDef edit workflow

The editable source for Hexatone's SuperCollider and SuperSonic sounds is
`synths/SuperCollider-OSC/LumatoneSynths.scd`. The original NYKY version is in
`NYKY/Lumatone-SC/LumatoneSynths.scd`; keep that copy unchanged for comparison.

SuperSonic loads compiled `.scsyndef` files, not the `.scd` source. Editing the
source therefore requires recompiling and staging the definitions before
reloading Hexatone. A SynthDef-only change does not require rebuilding the WASM
engine, provided it uses UGens already included in the custom core.

## Edit, compile and reload

Run these commands from the Hexatone repository root:

1. Edit `synths/SuperCollider-OSC/LumatoneSynths.scd`.
2. Compile the definitions:

   ```sh
   /usr/bin/arch -arm64 /Applications/SuperCollider.app/Contents/MacOS/sclang -D tools/supersonic/compile.scd
   ```

   This command is for the current Apple Silicon setup. On other systems, use
   the installed `sclang` executable with the same `-D` and script arguments.
   SuperCollider needs the DFM1 extension and FormantTable installed. Compilation
   does not boot or alter a running audio server.

3. Package the generated definitions and update the vendor manifest:

   ```sh
   node tools/supersonic/package-assets.mjs
   ```

   This packages the complete existing custom core and corresponding sources,
   not just the SynthDefs. It requires the prepared `generated/dfm1-core` and
   pinned source checkouts described in `tools/supersonic/README.md`.

4. Stage the assets served by Hexatone:

   ```sh
   yarn supersonic:assets
   ```

5. Reload the browser tab and start audio. Simply toggling the sounds off and on
   can reuse the warm engine and will not reliably reload changed definitions.

Do not edit `public/supersonic/` directly: it is generated from the vendor bundle.
`yarn build` stages the vendor assets automatically, but does not compile `.scd`
source. For distribution, include the source changes and updated vendor assets
and manifest together.

## What the compiler changes

`tools/supersonic/compile.scd` reads the canonical source, assigns a fixed language
random seed, prefixes definition names with `hexlab_`, and writes binaries into
`tools/supersonic/generated/` instead of adding definitions to a running server.
The integrated engine loads `hexlab_pluck`, `hexlab_string`, `hexlab_formant` and
`hexlab_tone`; `formant_array` is also compiled but is not packaged as an integrated
layer.

The compiler also modifies the formant one-shot envelope to free its node when
the envelope finishes if recurring mode is off. Consequently, evaluating the
canonical `.scd` directly is not identical to loading its compiled browser
version. This transformation currently uses a literal source-string replacement;
check it when editing that envelope's syntax.

## Separate comparison laboratory

For experiments before packaging, compile and open `/supersonic-lab.html` on the
running development server. Select `Local build + DFM1` and boot the engine. The
lab reads definitions directly from `tools/supersonic/generated/`; reload the lab
after recompiling. Start at low listening volume and use one lab tab at a time.

For native-versus-browser comparison, evaluate `tools/supersonic/native.scd` in
SuperCollider and use the lab's native destination with `yarn osc-bridge`. Both
destinations load the same generated binaries, separating engine differences
from source differences. This does not itself compare the original NYKY sound
design with the current design: that requires separate builds or separately
named definitions.

## Original NYKY versus current definitions

Comparison made on 9 October 2026. These are source differences, not a claim that
every checked-in binary has already been rebuilt from the latest source.

| Area | Original → current |
| --- | --- |
| Expression parameters | `mod` and `filter`, normally 1–2, become `expressionY` and `pressure`, normally 0–1. Internally adding 1 preserves the original mappings. |
| Pitch smoothing | The original 300 ms lag becomes 50 ms across the layers. |
| Tone harmonic oscillator | `FSinOsc` becomes `SinOsc`. |
| String envelope | The original multiplies envelope `e` into the signal twice; the current version does so once, changing the attack and decay contour. |
| Random envelopes | Discrete compile-time `.choose` values become continuous `TRand` values selected at articulation. |
| Recurring string/formant | Added slower repeating envelopes and pauses; subsequent formant cycles can choose a different vowel. |
| Release | Added `quick_release` and `quick_release_time`, blending the original release with a requested release time. |
| Safety | Added 20 Hz–16 kHz note bounds, bend and filter bounds, output sanitisation, and a fixed pluck delay-buffer size. Extreme pitches can behave differently. |

For a first sound-design comparison, disable recurring envelopes, set Release
Envelope to 0%, and match frequencies, velocities, expression values and output
levels. Translate original `mod`/`filter` values by subtracting 1 when sending
`expressionY`/`pressure` to the current definitions. Existing Hexatone messages
will not drive the original expression controls without this adaptation.

The string's single-versus-double envelope multiplication is a particularly
useful first listening comparison. Keep the original untouched and adapt a
separate comparison copy rather than replacing the active definitions blindly.
