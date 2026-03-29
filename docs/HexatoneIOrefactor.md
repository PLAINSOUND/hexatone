Note from 30 March session:  The next step is the persistence/reactivity slice, not more MTS feature work.

  Specifically, I’d read docs/HexatoneIOrefactor.md with this question in mind:

  How do we replace the current mixed settings flow with one clear model where:

  - UI state is stored once
  - runtime-derived values are not persisted
  - falsy values like 0 survive reloads correctly
  - synth/key reconstruction boundaries are explicit instead of patched ad hoc

  The concrete next implementation step I would take next session is:

  1. fix use-query falsy persistence behavior
  2. fix session-defaults parsing so 0 does not collapse to defaults
  3. define a first explicit split between persisted settings and derived runtime
     settings
  4. add tests around that split before touching more output logic

  That is the highest-leverage move now, because the recent bugs were mostly
  symptoms of unclear state ownership rather than bad MTS transport design.








# Hexatone IO Refactor

## Purpose

This document combines:

- the MIDI input and persistence redesign described in
  [persistence-refactor.md](./persistence-refactor.md)
- the MTS extraction and output redesign described in
  [MTSupdate.md](./MTSupdate.md)

into one implementation roadmap for Hexatone input/output architecture.

The goal is to prioritize immediate functional gains while refactoring the code
into clearer modules with better state boundaries, easier persistence policy,
and less duplicated tuning logic.

This is an architecture and execution document. It does not implement runtime
changes.

## Core View

Hexatone should be understood as one IO pipeline:

1. one or more user input sources produce note intent
2. note intent is mapped onto onscreen hexes
3. hexes become the central playable musical state
4. output engines render or transmit those hexes

The key architectural rule is:

- input logic chooses hexes
- output logic renders hexes
- tuning logic is shared, pure, and reusable
- persistence stores user choices, not transient runtime state

## High-Level Domain Model

## Input Side

Hexatone accepts:

- mouse
- touch
- computer keyboard
- MIDI input
  - single-channel
  - multichannel
  - MPE
  - controller geometry aware

Incoming MIDI may include:

- notes
- pitch bend
- modulation
- polyphonic aftertouch
- channel pressure
- MPE per-note dimensions
- in future, incoming retuning data

These inputs all converge on the same hex layer.

## Hex Layer

The onscreen hex grid is the musical hub.

It supports:

- direct triggering from all input sources
- independently tracked active layers
- sustain and latch
- retuning while notes are held
- snapshot capture for later sequencing use

Once a hex is triggered, the source no longer matters to downstream output
engines except where source-specific controller data must still be routed.

## Output Side

Hexatone currently has working output categories:

- built-in sample synth
- MPE synth
- MTS real-time tuning output
  - via system IAC
  - via MTS-ESP Mini in a host
  - directly to MTS-aware synths such as Serum and Pianoteq
- FluidSynth mirror path

What now needs redesign is the tuning-map output family so that it becomes a
coherent part of the same output architecture.

## Architectural Goals

## Immediate Gains

Priority should go first to changes that deliver user-visible value quickly:

1. unify and clarify MTS output modes
2. add Dynamic Bulk Dump Retuning
3. make Static Bulk Dump centered and musically logical
4. stop stale settings/state bugs around map numbers, device ids, anchors, and
   output reconstruction

## Structural Goals

At the same time, the refactor should:

- centralize persistence rules
- separate pure tuning logic from runtime transport logic
- separate input mapping logic from output synthesis logic
- reduce duplicated MTS code
- make settings represent domain concepts rather than historical implementation
  shortcuts

## Performance Goals

The refactor should improve performance by:

- reducing duplicated recomputation
- keeping pure tuning functions reusable and testable
- caching derived runtime map state where valid
- invalidating only on relevant settings changes
- keeping browser storage writes out of hot UI paths

## Input Model

## Input Mapping Targets

MIDI input should explicitly support two top-level mapping targets.

### 1. `hex_layout`

Incoming MIDI is interpreted as instructions for selecting onscreen hexes.

This has two submodes:

- `controller_geometry`
- `sequential`

Both require an anchor note and anchor channel concept.

Channel offset from the anchor channel transposes by:

- a user-specified number of scale degrees
- or a specified interval such as an equave/octave

This is the current implemented family of behavior.

### 2. `scale`

Incoming MIDI is interpreted as pitch intent to be mapped into the current
scale.

This target should become the home for:

- nearest-scale-degree mapping
- future dynamic retuning by tolerance and harmonic radius
- MIDI sequence playback into selected scale space
- pitch-driven rather than layout-driven input behavior

This target does not use anchor note or anchor channel.

## Input Processing Pipeline

Recommended conceptual flow:

1. physical input event arrives
2. event is decoded according to source type
3. event enters one input mapping strategy
4. mapping strategy chooses one or more target hex coordinates or degrees
5. hex layer activates/retunes/releases notes
6. output engines respond to hex state

This should replace the current situation where anchor logic, controller
geometry, persistence, and output assumptions are partially interleaved.

## Output Model

## Output Families

The output side should be modeled as a set of render/transport engines that all
consume the same hex state.

### 1. Sample Synth

- local rendering
- no external tuning transport

### 2. MPE Output

- external port
- per-note channelized expression

### 3. MTS Real-Time Output

- current functional path
- single-note real-time tuning message per carrier note
- supports MTS-aware synths and MTS-ESP workflows

### 4. MTS Bulk Dump Output

This should become a clear family with two explicit modes.

#### A. Dynamic Bulk Dump Retuning

Behavior:

- uses MTS1-style note allocation logic
- for each note:
  - choose carrier note
  - calculate target MTS triplet
  - patch that carrier slot in a maintained 128-note map
  - send one full non-real-time bulk dump
  - then trigger the MIDI note

This is effectively real-time MTS semantics over bulk-dump transport.

This is intended for synths that accept bulk dumps but not single-note
real-time MTS.

Testing should determine:

- whether raw performance is already sufficient
- whether note-on should be delayed slightly after bulk send
- whether reduced-range allocation is needed in practice

Initial recommendation:

- implement using MTS1 allocation semantics first
- keep the door open for an MTS2-like reduced-range option later

#### B. Static Bulk Dump

Behavior:

- build one 128-note map following scale-degree order
- play the map from the keyboard as a sequential instrument

This is the current DIRECT-style concept, but it should be musically centered
more intelligently.

## Static Bulk Dump Centering Rule

For Static Bulk Dump, the 128-note map should be centered around
`center_degree` on screen.

Reason:

- the 128-note range is limited
- centering around the visible/musical center maximizes useful coverage

Proposed centering algorithm:

1. determine the pitch of `center_degree`
2. search MIDI notes 57 through 72
   - `A3` through `C5`
3. choose the note whose 12edo pitch class best matches the frequency of
   `center_degree`
4. use that note as the central carrier for the tuning map

Examples:

- if center pitch is closest to 440 Hz, center on 69
- if center pitch is closest to 220 Hz, center on 57

This gives:

- more musically sensible keyboard placement
- better map coverage around the visible center
- a more logical relationship between screen center and external keyboard note

## Input/Output Correlation For Static Bulk Dump

Static Bulk Dump should line up with both main input families.

### `scale` input target

Nearest-scale-degree mapping should correlate smoothly to the centered static
map.

### `hex_layout` input target

The chosen anchor should trigger the center of the onscreen layout logically.

That means:

- the same centering logic should inform outgoing map construction
- and incoming anchor interpretation should align with that center

This is one of the main reasons input and output must be refactored together
rather than as separate subsystems.

## Persistence Principles

The persistence refactor still applies unchanged at the architectural level.

Core rules:

- one central runtime settings store
- one explicit hydration function
- one flat persistence registry
- URL, session, and local storage each have clear roles
- UI components do not write directly to browser storage

## Persisted vs Derived State

### Persisted User Choices

These belong in the settings/persistence system:

- selected input device
- input mapping target
- input layout mode
- anchor note/channel choices
- channel transposition behavior
- MPE input enabled state
- selected output engines
- output ports and channels
- MTS mode choices
- device ids
- map numbers
- auto-send preferences

### Derived Runtime State

These must not be persisted:

- live voice-pool occupancy
- active hex state
- sustained note runtime structures
- current dynamic bulk tuning map contents
- active carrier-slot ownership
- cached checksums
- any currently patched per-note tuning state

## Recommended Runtime Modules

The codebase should be reorganized around logical modules.

## 1. Input Mapping Module

Responsibilities:

- source decoding for MIDI/controller input
- `hex_layout` target mapping
- `scale` target mapping
- anchor interpretation
- controller geometry handling
- sequential channel transposition
- future harmonic-radius retuning selection for pitch-driven input

Candidate files:

- new `src/input/` module group
- logic currently spread across:
  - controller registry
  - `keys.js`
  - MIDI input wiring

## 2. Hex Interaction Module

Responsibilities:

- central active-note layer
- source merging
- sustain/latch/snapshot state
- note activation/release/retune API

This can continue to live near `keys.js`, but should be viewed as the central
musical state machine rather than as just UI drawing code.

## 3. Tuning Domain Module

Pure functions only.

Responsibilities:

- reference and degree conversion
- scale-relative pitch calculation
- center pitch derivation
- static map centering search
- MTS triplet encoding/decoding
- full 128-note map entry generation
- message serialization and checksum

Candidate files:

- `src/tuning/`
- or expanded/refactored `src/keyboard/mts-helpers.js`

## 4. Output Transport Module

Responsibilities:

- sample synth rendering
- MPE output
- MTS real-time transport
- MTS dynamic bulk transport
- MTS static bulk transport
- output-specific runtime caches/state

Candidate files:

- `src/output/`
- or refactored `src/midi_synth/` plus dedicated transport files

## 5. Persistence Module

Responsibilities:

- one settings registry
- hydration order
- persistence adapters
- migration from old key names where needed

## MTS Refactor Direction

The MTS redesign should be treated as:

- one shared tuning and allocation core
- multiple transport strategies

Not as separate ad hoc modes.

## Shared Core

The following must be shared between real-time MTS and Dynamic Bulk Dump:

- target pitch calculation
- carrier note selection
- voice stealing behavior
- MTS triplet encoding

The only difference should be transport:

- send single-note real-time sysex
- or patch/send full bulk dump

## Static Bulk Dump As A Distinct Output Strategy

Static Bulk Dump should use:

- sequential scale-degree map building
- centered map anchor based on `center_degree`
- note logic that follows the static keyboard map rather than real-time MTS
  carrier allocation

This is not merely "real-time MTS with bigger messages". It is a separate
strategy.

## Phased Roadmap

## Phase 1: Immediate Functional Fixes

Priority:

- high
- user-visible value

Goals:

- eliminate stale settings bugs
- clarify current MTS mode behavior
- prepare for Dynamic Bulk Dump

TO DO:

- ensure MTS settings changes rebuild or refresh the live runtime correctly
  - device id
  - map number
  - sysex/output mode
  - relevant anchor/center settings
- stop relying on accidental UI state persistence for live MTS behavior
- inventory all current MTS and DIRECT branches
- document current byte/message layouts in code comments/tests

Likely files:

- `src/app.jsx`
- `src/use-synth-wiring.js`
- `src/use-settings-change.js`
- `src/keyboard/keys.js`
- `src/settings/midi/mts.js`
- `src/settings/midi/midioutputs.js`

## Phase 2: Complete Pure Tuning Extraction

Priority:

- high
- foundation for all later work

Goals:

- make tuning logic reusable across input and output
- remove duplicated MTS math

TO DO:

- extract all pure MTS math into one canonical module
- remove duplicated `centsToMTS` / `mtsToMidiFloat`
- add pure helpers for:
  - one-note triplet generation
  - full-map generation
  - bulk-map patching
  - checksum regeneration
  - centered static-map anchor search in MIDI range 57..72
- add tests for:
  - triplet encoding boundaries
  - bulk dump headers
  - map centering selection

Likely files:

- `src/keyboard/mts-helpers.js`
- `src/midi_synth/index.js`
- new `src/tuning/` files

## Phase 3: Refactor Input Domain

Priority:

- high
- aligns with persistence-refactor

Goals:

- formalize `hex_layout` vs `scale`
- reduce anchor-related overload

TO DO:

- define runtime keys for:
  - `midiin_mapping_target`
  - `midiin_layout_mode`
  - `midiin_mpe`
  - sequential anchor note/channel
  - controller-specific anchor preferences
- separate:
  - geometry-based mapping
  - sequential mapping
  - scale-target mapping
- define how channel transposition is represented
- ensure future harmonic-radius logic has a clean home in `scale` target mode

Likely files:

- `docs/persistence-refactor.md`
- `src/use-settings-change.js`
- MIDI input handling code
- controller registry code
- new `src/input/` files

## Phase 4: Refactor Output Domain

Priority:

- high

Goals:

- define explicit output transport strategies
- stop mixing MTS semantics into `keys`

TO DO:

- define runtime output modes for:
  - sample
  - MPE
  - MTS real-time
  - MTS dynamic bulk
  - MTS static bulk
- define per-mode required settings
- move transport logic into output-specific modules
- keep `keys` focused on hex activation and orchestration

Likely files:

- `src/use-synth-wiring.js`
- `src/keyboard/keys.js`
- `src/midi_synth/index.js`
- new `src/output/` files

## Phase 5: Implement Dynamic Bulk Dump Retuning

Priority:

- highest new feature priority

Goals:

- support bulk-dump-only synths with MTS1-style behavior

TO DO:

- create maintained in-memory dynamic bulk map state
- on note-on:
  - choose carrier using MTS1 logic
  - compute triplet using shared MTS helper logic
  - patch carrier entry
  - send bulk dump
  - trigger note
- test whether a note-on delay is needed after sysex send
- define note-off and voice-steal behavior
- optionally leave MTS2-style reduced range as a later extension

Likely files:

- `src/midi_synth/index.js`
- `src/keyboard/mts-helpers.js`
- `src/use-synth-wiring.js`
- new transport-specific file

## Phase 6: Implement Centered Static Bulk Dump

Priority:

- high
- second major functionality gain

Goals:

- make the static tuning-map mode musically logical and better correlated with
  screen center

TO DO:

- implement center-pitch derivation from `center_degree`
- implement MIDI-note search in range 57..72
- choose best central carrier note by 12edo pitch-class fit
- build the static map around that center
- update outgoing keyboard note logic accordingly
- align input anchor behavior so the same center makes sense from the incoming
  MIDI side

Likely files:

- tuning helper module
- static bulk transport/output module
- input mapping module

## Phase 7: Unify Settings UX

Priority:

- medium

Goals:

- make user settings reflect domain concepts directly

TO DO:

- redesign MTS settings around:
  - transport mode
  - allocation mode where relevant
  - map number
  - device id
  - target port/channel
- decide whether DIRECT remains a user-facing label
  - recommended: yes, if it maps internally to static bulk mode
- decide whether `sysex_type` remains user-facing
  - recommended: no, replace with clearer transport naming

Likely files:

- `src/settings/midi/mts.js`
- `src/settings/midi/midioutputs.js`

## Phase 8: Centralize Persistence

Priority:

- medium
- must follow domain clarification, not precede it

Goals:

- make persistence consistent and explicit

TO DO:

- define a flat registry for all input/output/tuning settings
- classify each as:
  - URL-shareable
  - session-scoped
  - local preference
  - derived runtime only
- remove storage writes from UI components
- ensure dynamic map contents and runtime transport state are never persisted

Likely files:

- persistence registry
- `src/use-settings-change.js`
- `src/session-defaults.js`
- relevant UI components

## Specific TO DO Breakdown By Area

## A. Pure Tuning And MTS

TO DO:

- create canonical helpers for:
  - target pitch from cents/reference
  - MTS triplet encode/decode
  - full 128-note map generation
  - single-entry map patch
  - bulk dump serialization
  - checksum
  - centered static-map anchor selection
- remove duplicated tuning math from runtime synth files
- add tests before transport rewrites
- reexamine the core scale-math model so ratio-bearing scale data is not
  immediately flattened away into cents at parse time
- evaluate a hybrid math layer:
  - exact structural interval representation for JI-aware logic
  - cents/log2 frequency only at playback and MTS serialization boundaries
- review exponent-vector / monzo style representations as the preferred
  long-term exact form for JI scales
- investigate compatibility with the Scale Workshop / xenharmonic-devs math
  stack as a natural future integration path

## B. Input Mapping

TO DO:

- formalize `hex_layout` and `scale` as top-level mapping targets
- separate controller geometry from sequential mapping
- normalize anchor note/channel runtime keys
- preserve controller-specific preferences separately from sequential defaults
- define future insertion point for harmonic-radius-based nearest tuning

## C. Hex Runtime

TO DO:

- make the hex layer the explicit central note-state hub
- document source merging rules
- review sustain/latch/snapshot logic for clearer module boundaries
- ensure output engines depend on hex events, not input-device assumptions

## D. Output Transports

TO DO:

- separate:
  - sample synth
  - MPE synth
  - MTS real-time transport
  - dynamic bulk transport
  - static bulk transport
- share allocation/tuning code between real-time and dynamic bulk
- keep static bulk distinct because its note logic is different

## E. Settings And Persistence

TO DO:

- replace overloaded settings with explicit domain settings
- stop direct `sessionStorage` writes in UI code
- define hydration precedence in one place
- ensure settings changes invalidate exactly the right runtime caches

## Suggested Execution Order

1. fix immediate stale-state/runtime invalidation issues
2. extract and test pure tuning/MTS helpers
3. formalize input runtime model
4. formalize output runtime model
5. implement Dynamic Bulk Dump Retuning
6. implement centered Static Bulk Dump
7. redesign MTS/DIRECT settings UI
8. centralize persistence under the new model

This order provides early functionality gains without hardening the wrong
settings model first.

## Risks

- stale runtime settings if reconstruction boundaries stay unclear
- duplicated tuning logic if extraction is incomplete
- confusing UX if transport and allocation are still conflated
- performance issues in Dynamic Bulk Dump if note triggering occurs before bulk
  retune takes effect
- input/output mismatch if static bulk centering is implemented only on the
  output side

## Review Gates

Before calling the refactor complete, verify:

1. one pure tuning module is the single source of truth for MTS math
2. input mapping targets are explicit and persistence-ready
3. hex state is the shared center of the IO architecture
4. Dynamic Bulk Dump uses MTS1 allocation semantics with bulk transport
5. Static Bulk Dump centers around `center_degree` using the 57..72 search rule
6. output settings changes always reach the live runtime
7. persistence stores only user choices, not transport/runtime caches

## Immediate Next Actions

If implementation starts now, the first concrete tasks should be:

1. audit current live-runtime invalidation for all MTS-related settings
2. extract the centered static-map anchor calculation as a pure helper
3. extract real-time MTS triplet generation from `midi_synth/index.js`
4. define one runtime object describing MTS output mode
5. prototype Dynamic Bulk Dump Retuning behind that runtime object

## Concrete Implementation Spec

This section translates the roadmap into specific code changes against the
current codebase.

## Target Module Layout

Recommended new structure:

```text
src/
  input/
    mapping-targets.js
    hex-layout-mapper.js
    scale-mapper.js
    controller-preferences.js
  tuning/
    pitch-model.js
    mts-format.js
    tuning-map.js
    center-anchor.js
  output/
    output-modes.js
    mts-runtime.js
    mts-realtime-transport.js
    mts-bulk-dynamic-transport.js
    mts-bulk-static-transport.js
  persistence/
    settings-registry.js
    hydrate-settings.js
    storage-adapters.js
```

This does not need to land in one step. The first implementation can keep
existing files and extract functions into these modules incrementally.

## Scale Math Direction

The current codebase largely converts incoming scale data into cents early and
then carries tuning logic forward in floating-point/log-frequency form. This is
pragmatic for playback and MTS packing, but it also throws away exact ratio
identity too early for future harmonic and JI-sensitive features.

This should be revisited as part of the IO refactor.

Recommended direction:

- preserve exact interval structure when a scale originates as ratios or other
  exact forms
- avoid repeated ratio -> cents -> ratio conversions in the core model
- keep playback/output math in cents or log2-frequency space only where
  approximation is actually needed
- use exact interval representations for:
  - harmonic-radius evaluation
  - nearest valid tuning selection
  - future tuning-aware persistence/export behavior
  - cross-tool compatibility with Scale Workshop style math

Likely target architecture:

- parse layer:
  - retain original ratio-bearing or exact scale representation
- domain layer:
  - expose exact interval objects and derived cents/log views
- output layer:
  - serialize to MTS bytes from derived float/log values only at the boundary

Exponent vectors / monzos should be evaluated seriously here. They avoid
numerator/denominator blow-up from repeated ratio multiplication while still
preserving exact harmonic identity more faithfully than flattening everything to
floating-point cents immediately.

This is especially relevant because Hexatone is expected to grow:

- dynamic retuning by tolerance
- harmonic-radius based selection
- deeper collaboration with the Scale Workshop developers
- possible future sharing of interval math or exact pitch-model utilities

## Phase 1 Concrete Changes

Goal:

- fix immediate state invalidation and create stable runtime mode objects

### 1. Add runtime-mode derivation in `src/use-synth-wiring.js`

Current issue:

- `use-synth-wiring.js` branches directly on legacy settings
- MTS mode decisions are spread across `output_mts`, `output_direct`,
  `midi_mapping`, and `sysex_type`

Implement:

- a small pure adapter function near the top of `src/use-synth-wiring.js`
- or in a new `src/output/output-modes.js`

Suggested shape:

```js
export function deriveOutputRuntime(settings, midi) {
  const outputs = [];

  if (settings.output_sample) {
    outputs.push({ kind: "sample" });
  }

  if (
    settings.output_mts &&
    settings.midi_device !== "OFF" &&
    settings.midi_channel >= 0
  ) {
    outputs.push({
      kind: "mts",
      portId: settings.midi_device,
      channel: settings.midi_channel,
      allocationMode:
        settings.midi_mapping === "MTS2" ? "mts2" : "mts1",
      transportMode: "single_note_realtime",
      deviceId: settings.device_id ?? 127,
      mapNumber: settings.tuning_map_number ?? 0,
    });
  }

  if (
    settings.output_direct &&
    settings.direct_device !== "OFF" &&
    settings.direct_channel >= 0
  ) {
    outputs.push({
      kind: "mts",
      portId: settings.direct_device,
      channel: settings.direct_channel,
      allocationMode: "static_map",
      transportMode: "bulk_static_map",
      deviceId: settings.direct_device_id ?? 127,
      mapNumber: settings.direct_tuning_map_number ?? 0,
    });
  }

  return outputs;
}
```

Benefit:

- one place translates legacy settings into domain concepts
- later phases can change the UI without changing the synth runtime contract

### 2. Make reconstruction dependencies explicit in `src/app.jsx`

Current issue:

- `structuralSettings` is the reconstruction boundary
- stale values occur when relevant MTS keys are not part of that boundary

Implement:

- add all runtime-significant input/output mode keys to the structural settings
  dependency list
- later replace this with mode-object identity derived from the persistence
  store

Suggested rule for now:

- if a setting changes synth creation, tuning-map content, note routing,
  controller mapping, or active output transport, it belongs in the structural
  dependency list

### 3. Stop direct storage writes for newly touched settings first

Current issue:

- `src/settings/midi/mts.js`
- `src/settings/midi/index.js`
- `src/settings/midi/midioutputs.js`

still write to `sessionStorage` directly.

Immediate implementation:

- do not rewrite all persistence yet
- but any settings touched during the IO refactor should stop writing directly
- route them through one helper in `use-settings-change.js`

Suggested temporary helper:

```js
function persistSessionKey(key, value) {
  if (value == null) sessionStorage.removeItem(key);
  else sessionStorage.setItem(key, String(value));
}
```

This is still transitional, but better than storage writes embedded in UI code.

## Phase 2 Concrete Changes: Pure Tuning Extraction

### 1. Split `src/keyboard/mts-helpers.js` into smaller helpers

Current issue:

- `mtsTuningMap(...)` is too coarse
- `src/midi_synth/index.js` still contains duplicate MTS math

Implement these pure functions first:

```js
// src/tuning/mts-format.js
export function encodeMtsTriplet(targetMidiFloat) {
  const note = Math.floor(targetMidiFloat);
  if (note < 0) return [0, 0, 0];
  if (note > 127) return [127, 127, 126];

  let fine = Math.round((targetMidiFloat - note) * 16384);
  if (fine === 16384) fine = 16383;

  return [
    note,
    Math.floor(fine / 128),
    fine & 127,
  ];
}
```

```js
// src/tuning/tuning-map.js
export function patchTuningEntry(entries, midiNote, triplet) {
  const next = entries.slice();
  next[midiNote] = triplet;
  return next;
}
```

```js
// src/tuning/mts-format.js
export function buildBulkDumpMessage({
  deviceId,
  mapNumber,
  name,
  entries,
}) {
  const asciiName = Array.from({ length: 16 }, (_, i) => {
    const code = i < (name || "").length ? name.charCodeAt(i) : 32;
    return code > 31 && code < 128 ? code : 32;
  });

  const bytes = [126, deviceId, 8, 1, mapNumber, ...asciiName];
  for (const triplet of entries) bytes.push(...triplet);

  let checksum = 0;
  for (let i = 1; i < bytes.length; i++) checksum ^= bytes[i];
  bytes.push(checksum & 0x7f);
  return bytes;
}
```

These functions should replace the inlined versions gradually.

### 2. Extract centered static-map anchor logic

This is one of the first new pure helpers worth implementing.

Suggested file:

- `src/tuning/center-anchor.js`

Suggested shape:

```js
export function chooseStaticMapCenterMidi(centerPitchHz) {
  let best = 69;
  let bestError = Infinity;

  for (let midi = 57; midi <= 72; midi++) {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const ratio = centerPitchHz / hz;
    const centsError = Math.abs(1200 * Math.log2(ratio));
    const pitchClassError = Math.min(centsError % 1200, 1200 - (centsError % 1200));

    if (pitchClassError < bestError) {
      best = midi;
      bestError = pitchClassError;
    }
  }

  return best;
}
```

Refinement note:

- the exact error metric may need adjustment
- but the helper should stay pure and independently tested

### 3. Extract center pitch derivation

Current inputs already exist in normalized settings:

- `fundamental`
- `degree0toRef_asArray`
- `scale`
- `equivInterval`
- `center_degree`

Suggested helper:

```js
export function computeCenterPitchHz({
  fundamental,
  degree0ToRefCents,
  scale,
  equivInterval,
  centerDegree,
}) {
  const degree0Hz = fundamental / (2 ** (degree0ToRefCents / 1200));
  const octs = Math.floor(centerDegree / scale.length);
  const red = ((centerDegree % scale.length) + scale.length) % scale.length;
  const cents = octs * equivInterval + scale[red];
  return degree0Hz * (2 ** (cents / 1200));
}
```

## Phase 3 Concrete Changes: Input Runtime Model

### 1. Introduce transitional runtime keys in `src/app.jsx`

Keep current persisted keys for now, but derive new runtime keys before passing
to the rest of the app.

Suggested transitional derived object:

```js
const inputRuntime = {
  target: settings.midiin_mapping_target || "hex_layout",
  layoutMode: settings.midi_passthrough ? "sequential" : "controller_geometry",
  mpeEnabled: !!settings.midiin_mpe,
  seqAnchorNote: settings.midiin_seq_anchor_note ?? settings.midiin_central_degree ?? 60,
  seqAnchorChannel: settings.midiin_seq_anchor_channel ?? settings.midiin_anchor_channel ?? 1,
  stepsPerChannel: settings.midiin_steps_per_channel,
  legacyChannelMode: settings.midiin_channel_legacy,
};
```

This lets implementation begin before persistence key migration is complete.

### 2. Create input mapping adapters

Suggested file:

- `src/input/mapping-targets.js`

Suggested API:

```js
export function mapMidiEventToHexIntent(event, runtime, controllerInfo) {
  if (runtime.target === "scale") {
    return mapPitchIntentToScale(event, runtime);
  }
  if (runtime.layoutMode === "controller_geometry") {
    return mapControllerGeometryToHex(event, runtime, controllerInfo);
  }
  return mapSequentialToHex(event, runtime);
}
```

Initial implementation can be wrappers around current functions, not a full
rewrite.

### 3. Decouple imports/exports from `midiin_central_degree`

Current issue:

- `.scl`, `.ascl`, `.kbm`, parse/export code still embeds
  `midiin_central_degree`

Immediate approach:

- keep file compatibility
- introduce adapters in parse/export code so legacy file values populate
  `midiin_seq_anchor_note` during runtime normalization

## Phase 4 Concrete Changes: Output Runtime And Transports

### 1. Refactor `create_midi_synth(...)`

Current signature is overloaded:

```js
create_midi_synth(
  midiin_device,
  midiin_central_degree,
  midi_output,
  channel,
  midi_mapping,
  velocity,
  fundamental,
  sysex_type,
  device_id
)
```

Replace with a mode object.

Suggested new signature:

```js
create_midi_synth({
  output,
  channel,
  velocity,
  tuningContext,
  mode,
})
```

Where:

```js
const tuningContext = {
  fundamental: settings.fundamental,
  referenceDegree: settings.reference_degree,
  degree0ToRef: settings.degree0toRef_asArray,
  scale: settings.scale,
  equivInterval: settings.equivInterval,
  centerDegree: settings.center_degree,
};

const mode = {
  kind: "mts",
  allocationMode: "mts1",
  transportMode: "single_note_realtime",
  deviceId: settings.device_id,
  mapNumber: settings.tuning_map_number,
  anchorNote: settings.midiin_central_degree,
};
```

This is a major readability improvement even before deeper refactors land.

### 2. Introduce transport objects

Suggested interface:

```js
class MtsTransport {
  noteOn(allocation, noteContext) {}
  noteOff(allocation, noteContext) {}
  retune(allocation, noteContext) {}
  refreshMap(tuningContext) {}
}
```

Concrete transports:

- `RealtimeSingleNoteTransport`
- `BulkDynamicMapTransport`
- `BulkStaticMapTransport`

This can initially be simple objects rather than classes.

### 3. Dynamic bulk transport sketch

```js
function createBulkDynamicTransport({ output, deviceId, mapNumber, name, entries }) {
  let currentEntries = entries;

  return {
    noteOn({ carrier, triplet, velocity, channel }) {
      currentEntries = patchTuningEntry(currentEntries, carrier, triplet);
      const dump = buildBulkDumpMessage({
        deviceId,
        mapNumber,
        name,
        entries: currentEntries,
      });

      output.sendSysex([dump[0]], dump.slice(1));
      output.send([0x90 + channel, carrier, velocity]);
    },

    noteOff({ carrier, velocity, channel }) {
      output.send([0x80 + channel, carrier, velocity]);
    },

    refreshMap(nextEntries) {
      currentEntries = nextEntries;
    },
  };
}
```

Immediate note:

- this is intentionally simple
- later versions can add guard timing if hardware testing requires it

### 4. Static bulk transport sketch

```js
function createBulkStaticTransport({ output, deviceId, mapNumber, name, entries }) {
  let sent = false;

  return {
    ensureMapSent() {
      if (sent) return;
      const dump = buildBulkDumpMessage({ deviceId, mapNumber, name, entries });
      output.sendSysex([dump[0]], dump.slice(1));
      sent = true;
    },

    noteOn({ midiNote, velocity, channel }) {
      this.ensureMapSent();
      output.send([0x90 + channel, midiNote, velocity]);
    },

    noteOff({ midiNote, velocity, channel }) {
      output.send([0x80 + channel, midiNote, velocity]);
    },

    refreshMap(nextEntries) {
      entries = nextEntries;
      sent = false;
    },
  };
}
```

## Phase 5 Concrete Changes: `keys.js`

### 1. Reduce `Keys` responsibility

Current `Keys` owns:

- full map creation
- send-map orchestration
- sustained-note patching

Target:

- `Keys` should call runtime output methods instead

Suggested change sequence:

1. keep `mtsSendMap()` as compatibility wrapper
2. make it delegate to the output runtime object
3. once transports are stable, remove transport-specific logic from `Keys`

Compatibility wrapper sketch:

```js
mtsSendMap = (midiOutput) => {
  if (!this.synth?.sendTuningMap) return;
  this.synth.sendTuningMap({ output: midiOutput });
};
```

### 2. Keep active-note protection only where needed

The current bulk-send path in `keys.js` patches active slots before sending.

Implementation decision:

- keep this behavior only for static bulk transports if testing shows it is
  needed
- for dynamic bulk transport, carrier ownership should live with the transport
  runtime itself

## Phase 6 Concrete Changes: UI And Settings

### 1. Introduce new user-facing transport names

Recommended settings model:

```js
{
  mts_output_mode: "realtime" | "bulk_dynamic" | "bulk_static",
  mts_allocation_mode: "mts1" | "mts2" | "static_map",
  mts_device_id: 127,
  mts_map_number: 0,
}
```

Transitional mapping:

- current MTS section:
  - `output_mts + MTS1 + sysex_type 127` -> `realtime + mts1`
- new dynamic bulk:
  - `output_mts + bulk_dynamic` -> `bulk_dynamic + mts1`
- current DIRECT:
  - `output_direct` -> `bulk_static + static_map`

### 2. UI snippet sketch

```jsx
<label>
  MTS Output Mode
  <select
    value={settings.mts_output_mode}
    onChange={(e) => onChange("mts_output_mode", e.target.value)}
  >
    <option value="realtime">Real-Time Single Note</option>
    <option value="bulk_dynamic">Dynamic Bulk Dump</option>
    <option value="bulk_static">Static Bulk Dump</option>
  </select>
</label>
```

```jsx
{settings.mts_output_mode !== "bulk_static" && (
  <label>
    Allocation
    <select
      value={settings.mts_allocation_mode}
      onChange={(e) => onChange("mts_allocation_mode", e.target.value)}
    >
      <option value="mts1">128 Notes Polyphonic</option>
      <option value="mts2">Reduced Range</option>
    </select>
  </label>
)}
```

This is clearer than continuing to expose `sysex_type`.

## Phase 7 Concrete Changes: Persistence Registry

### 1. Introduce a real registry object

Suggested file:

- `src/persistence/settings-registry.js`

Suggested shape:

```js
export const SETTINGS_REGISTRY = [
  { key: "midiin_mapping_target", scope: "session", storage: { kind: "session" } },
  { key: "midiin_layout_mode", scope: "session", storage: { kind: "session" } },
  { key: "midiin_seq_anchor_note", scope: "session", storage: { kind: "session" } },
  { key: "mts_output_mode", scope: "session", storage: { kind: "session" } },
  { key: "mts_allocation_mode", scope: "session", storage: { kind: "session" } },
  { key: "mts_map_number", scope: "session", storage: { kind: "session" } },
  { key: "mts_device_id", scope: "session", storage: { kind: "session" } },
];
```

This should supersede the hardcoded `sessionDefaults` object over time.

### 2. Replace `useQuery` storage coupling

Current issue in `src/use-query.js`:

- URL and localStorage are coupled
- defaults and storage precedence are embedded directly in the hook

Implementation target:

- `useQuery` should eventually only reflect URL share-state
- hydration should happen before the hook via a settings store or hydration
  helper

Short-term transitional helper:

```js
const hydratedDefaults = hydrateSettings({
  appDefaults,
  presetDefaults,
  localStorage,
  sessionStorage,
  urlSearch: document.location.search,
});

const [settings, setSettings] = useQuery(spec, hydratedDefaults, skipKeys);
```

This lets the hook shrink later without blocking the refactor.

## Suggested Test Plan

### Pure unit tests

Add first:

- `encodeMtsTriplet()`
- `buildBulkDumpMessage()`
- `chooseStaticMapCenterMidi()`
- `computeCenterPitchHz()`

### Runtime transport tests

Add next:

- dynamic bulk transport patches only one slot per note-on
- static bulk transport resends only when map changes
- real-time and dynamic bulk produce the same carrier and triplet for the same
  note context

### Integration tests

Later:

- changing map number updates outgoing message headers
- changing center degree rebuilds static bulk map anchor
- changing input mapping target changes note-to-hex behavior without affecting
  unrelated output engines

## Recommended Development Sequence

Concrete order of code changes:

1. add pure centered-anchor helpers and tests
2. add pure MTS formatting helpers and tests
3. add `deriveOutputRuntime()` and use it in `use-synth-wiring.js`
4. refactor `create_midi_synth()` to accept a mode object
5. extract real-time transport object
6. implement dynamic bulk transport object
7. implement centered static bulk transport object
8. make `keys.js` delegate to transport/runtime
9. introduce new UI settings names with compatibility adapters
10. replace direct storage writes with persistence-registry-driven updates

## What To Avoid

- do not redesign persistence keys and UI labels before the runtime mode object
  exists
- do not implement Dynamic Bulk Dump by copying the current `MidiHex` math into
  another class without extracting shared helpers first
- do not keep `keys.js` as the owner of transport semantics
- do not persist dynamic map contents or active allocation state

## Phase 1 Build Sheet

This section defines the first concrete implementation slice to build and test.

Scope of Phase 1:

- no UI redesign yet
- no persistence-registry replacement yet
- no Dynamic Bulk Dump transport yet
- yes to pure helper extraction
- yes to runtime mode derivation
- yes to stale-state fixes required for later work

The desired outcome is:

- one pure helper layer for centered static-map calculations and core MTS
  formatting
- one runtime mode object for output creation
- one safer synth wiring path that no longer relies on scattered branching
- no stale MTS map/device settings in the live runtime

## Phase 1 Deliverables

Deliverable 1:

- add pure tuning helpers for center pitch and static bulk map centering

Deliverable 2:

- add pure MTS formatting helpers that can later be reused by both real-time
  and bulk transports

Deliverable 3:

- derive one output runtime object from current legacy settings

Deliverable 4:

- refactor `create_midi_synth()` to accept a config object without changing user
  behavior

Deliverable 5:

- ensure all current MTS-relevant settings reach the live runtime

## File-By-File Work Plan

## 1. `src/keyboard/mts-helpers.js`

Purpose in Phase 1:

- keep this as the canonical pure tuning/MTS file for now
- add smaller helpers without breaking current callers

Add these exports:

- `computeCenterPitchHz`
- `chooseStaticMapCenterMidi`
- `buildBulkDumpMessage`
- `buildRealtimeSingleNoteMessage`
- `buildTuningMapEntries`
- `patchTuningEntry`

Keep these exports for compatibility:

- `centsToMTS`
- `mtsToMidiFloat`
- `degree0ToRef`
- `computeNaturalAnchor`
- `mtsTuningMap`

Suggested implementation order inside the file:

1. add `computeCenterPitchHz`
2. add `chooseStaticMapCenterMidi`
3. extract the current 128-entry loop from `mtsTuningMap()` into
   `buildTuningMapEntries`
4. extract the current bulk-dump serialization into `buildBulkDumpMessage`
5. add `patchTuningEntry`
6. reimplement `mtsTuningMap()` in terms of those smaller helpers

Suggested code sketch:

```js
export function buildTuningMapEntries({
  tuningMapDegree0,
  scale,
  equave,
  fundamental,
  degree0toRefAsArray,
}) {
  const entries = [];
  const fundamentalCents = 1200 * Math.log2(fundamental / 440);
  const degree0Cents = fundamentalCents - degree0toRefAsArray[0];
  const mapOffset = degree0Cents - 100 * (tuningMapDegree0 - 69);

  for (let i = 0; i < 128; i++) {
    const targetCents =
      scale[(i - tuningMapDegree0 + 128 * scale.length) % scale.length] +
      mapOffset +
      equave *
        (Math.floor((i - tuningMapDegree0 + 128 * scale.length) / scale.length) - 128);

    entries[i] = typeof targetCents === "number"
      ? centsToMTS(tuningMapDegree0, targetCents)
      : [127, 127, 127];
  }

  return entries;
}
```

```js
export function patchTuningEntry(entries, midiNote, triplet) {
  const next = entries.slice();
  next[midiNote] = triplet;
  return next;
}
```

Done means:

- existing `mtsTuningMap()` behavior is preserved
- new helpers are individually testable
- no MTS byte math is duplicated in new code added after this point

## 2. `src/keyboard/mts-helpers.test.js` or equivalent new test file

Purpose in Phase 1:

- create a test harness before transport refactors

Add tests for:

- `computeCenterPitchHz`
  - center degree 0
  - non-zero center degree
- `chooseStaticMapCenterMidi`
  - 220 Hz -> 57
  - 440 Hz -> 69
  - a value between candidates
- `buildBulkDumpMessage`
  - header placement for device id and map number
  - 16-char name padding
  - checksum correctness
- `patchTuningEntry`
  - only one slot changed

Suggested test sketch:

```js
it("chooses A4 for a 440 Hz center pitch", () => {
  expect(chooseStaticMapCenterMidi(440)).toBe(69);
});
```

Done means:

- these helpers can be changed later without relying on manual MIDI inspection

## 3. `src/use-synth-wiring.js`

Purpose in Phase 1:

- derive one output runtime object from legacy settings
- stop creating synths directly from scattered booleans

Add a pure helper in this file first:

- `deriveOutputRuntime(settings, midi)`

Suggested returned structure:

```js
{
  sample: { enabled: true, instrument, fundamental, referenceDegree, scale },
  mpe: null | { ... },
  outputs: [
    {
      family: "mts",
      transportMode: "single_note_realtime",
      allocationMode: "mts1",
      port: midi.outputs.get(settings.midi_device),
      channel: settings.midi_channel,
      deviceId: settings.device_id ?? 127,
      mapNumber: settings.tuning_map_number ?? 0,
    },
    {
      family: "mts",
      transportMode: "bulk_static_map",
      allocationMode: "static_map",
      port: midi.outputs.get(settings.direct_device),
      channel: settings.direct_channel,
      deviceId: settings.direct_device_id ?? 127,
      mapNumber: settings.direct_tuning_map_number ?? 0,
    },
  ],
}
```

Implementation steps:

1. create `deriveOutputRuntime()`
2. replace `wantMts` / `wantDirect` branching with derived objects
3. pass a single config object into `create_midi_synth()`
4. preserve current behavior for sample, MPE, OSC, and FluidSynth

Suggested code sketch:

```js
const runtime = deriveOutputRuntime(settings, midi);

for (const out of runtime.outputs) {
  promises.push(
    create_midi_synth({
      outputMode: out,
      tuningContext: {
        fundamental: settings.fundamental,
        degree0toRefAsArray: settings.degree0toRef_asArray,
        scale: settings.scale,
        equivInterval: settings.equivInterval,
        centerDegree: settings.center_degree,
      },
      legacyInputAnchor: settings.midiin_central_degree,
      velocity: settings.midi_velocity,
    }),
  );
}
```

Done means:

- all MIDI synth creation comes through one structured object
- the direct path and real-time MTS path are described consistently

## 4. `src/midi_synth/index.js`

Purpose in Phase 1:

- convert synth construction from positional args to object args
- extract reusable per-note MTS math helpers without changing transport yet

Change:

- `create_midi_synth(...)`

From:

```js
create_midi_synth(
  midiin_device,
  midiin_central_degree,
  midi_output,
  channel,
  midi_mapping,
  velocity,
  fundamental,
  sysex_type,
  device_id
)
```

To:

```js
create_midi_synth({
  outputMode,
  tuningContext,
  legacyInputAnchor,
  velocity,
})
```

Inside `src/midi_synth/index.js`, add small internal helpers:

- `resolveCarrierPool(allocationMode, idealNote, pools)`
- `buildRealtimeAllocation(cents, degree0toRefRatio, fundamental, allocationMode, pools, coords)`

Suggested code sketch:

```js
function resolveCarrierPool(allocationMode, idealNote, pools) {
  if (allocationMode === "mts1") return pools.mts1;
  return idealNote <= 88 ? pools.mts2Low : pools.mts2High;
}
```

```js
function buildRealtimeAllocation({
  cents,
  centsPrev,
  centsNext,
  degree0toRefRatio,
  fundamental,
  allocationMode,
  pools,
  coords,
}) {
  const ref = fundamental / degree0toRefRatio;
  const refOffset = 1200 * Math.log2(ref / 261.6255653);
  const refCents = cents + refOffset;
  const targetMidiFloat = (refCents * 0.01) + 60;
  const idealNote = Math.max(0, Math.min(Math.round(targetMidiFloat), 127));
  const pool = resolveCarrierPool(allocationMode, idealNote, pools);
  const allocation = pool.noteOn(coords, targetMidiFloat);
  return { refCents, targetMidiFloat, idealNote, pool, allocation };
}
```

Phase 1 rule:

- keep the actual send behavior unchanged
- just make the math accessible and structured for Phase 2

Done means:

- synth creation uses a readable config object
- real-time allocation logic is no longer a single opaque block

## 5. `src/app.jsx`

Purpose in Phase 1:

- fix stale runtime invalidation

Update the `structuralSettings` dependency list to include:

- `settings.device_id`
- `settings.tuning_map_number`
- `settings.direct_device_id`
- `settings.direct_tuning_map_number`

Also review whether Phase 1 should include:

- `settings.center_degree`
- already present
- `settings.reference_degree`
- already present

Done means:

- changing either MTS map number or device id causes the live runtime to
  reflect the new values without requiring unrelated reconstruction

## 6. `src/settings/midi/mts.js`

Purpose in Phase 1:

- do not redesign the UI yet
- only stop embedding persistence assumptions in the component if touched

If touched during Phase 1:

- remove direct `sessionStorage.setItem(...)` calls for:
  - `sysex_type`
  - `device_id`
  - `tuning_map_number`

Replace with:

- `props.onChange(...)`
- plus a single persistence helper in the settings layer, not the component

Phase 1 can defer this if keeping scope tight, but if the component is edited,
do not add more direct storage writes.

## 7. `src/settings/midi/midioutputs.js`

Purpose in Phase 1:

- leave layout/UI mostly as-is
- avoid making DIRECT logic more entangled

If touched during Phase 1:

- stop reinforcing the old model via comments like
  `"DIRECT always uses non-real-time bulk map"`
- replace with terminology that matches future runtime modes:
  - `"bulk static map"`

No UI redesign required yet.

## Phase 1 Detailed Sequence

1. add helper tests first
2. extract `computeCenterPitchHz`
3. extract `chooseStaticMapCenterMidi`
4. extract `buildTuningMapEntries`
5. extract `buildBulkDumpMessage`
6. add `deriveOutputRuntime()` in `use-synth-wiring.js`
7. refactor `create_midi_synth()` to object args
8. update `use-synth-wiring.js` call sites
9. update `app.jsx` structural dependencies
10. run tests and manually verify live MTS map/device changes

## Phase 1 Acceptance Criteria

All of the following must be true:

1. there is one pure function that computes center pitch from normalized tuning
   settings
2. there is one pure function that chooses the static bulk center MIDI note in
   the 57..72 range
3. there is one pure function that serializes a bulk dump from 128 entries
4. `create_midi_synth()` no longer takes positional arguments
5. `use-synth-wiring.js` derives output runtime modes before synth creation
6. changing `device_id`, `tuning_map_number`, `direct_device_id`, or
   `direct_tuning_map_number` reaches the live runtime
7. Phase 1 does not change visible behavior yet except fixing stale-setting bugs

## Manual Verification Checklist

After Phase 1, verify manually:

- real-time MTS still sends notes exactly as before
- DIRECT/static bulk still sends a bulk map and plays notes exactly as before
- changing MTS map number updates outgoing header bytes
- changing DIRECT map number updates outgoing bulk-dump header bytes
- changing MTS device id updates outgoing header bytes
- changing DIRECT device id updates outgoing bulk-dump header bytes
- no regression in sample synth, MPE, or OSC initialization

## Phase 1 Follow-On

If Phase 1 completes cleanly, the next implementation step should be:

- Phase 2a: add `BulkDynamicMapTransport` using the new helper layer

That is the first point where the new user-visible feature should be built.
