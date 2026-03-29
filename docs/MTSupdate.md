# MTS Update Plan

## Purpose

This document maps out the code changes needed to:

- continue supporting the current MTS real-time single-note workflow
- extract the remaining MTS logic into a clearer domain module
- add an alternate "real-time behavior via bulk dump" output mode
- align the MTS settings model with the persistence refactor direction in
  [persistence-refactor.md](./persistence-refactor.md)

This is a design note only. It does not implement runtime changes.

## Summary

Hexatone currently has two distinct MTS-related behaviors:

1. `output_mts` + `midi_mapping = "MTS1" | "MTS2"`
   - choose a carrier note per played note
   - calculate one 3-byte MTS tuning value for that carrier
   - send one real-time single-note tuning sysex
   - then trigger the note

2. `output_direct`
   - precompute a full 128-note tuning map for the current scale
   - send one non-real-time bulk tuning dump
   - then play plain MIDI note-on/off on a fixed channel

The requested new behavior is a third mode:

3. real-time carrier selection with non-real-time transport
   - keep the same carrier-note choice used by the real-time path
   - keep the same calculated 3-byte MTS tuning value for that carrier
   - instead of sending one single-note real-time message:
     - rewrite one entry in a maintained 128-note tuning map
     - send the full non-real-time bulk dump
     - then trigger the note
   - this allows synths that only accept bulk tuning dumps to behave like the
     real-time MTS modes

This mode is effectively "MTS1/MTS2 note allocation semantics over bulk-dump
transport".

## Current Code Shape

### 1. Pure helper layer

`src/keyboard/mts-helpers.js`

Currently contains:

- `centsToMTS(note, bend)`
- `mtsToMidiFloat(mts)`
- `degree0ToRef(reference_degree, scale)`
- `computeNaturalAnchor(...)`
- `mtsTuningMap(...)`

This file is the correct start of the extraction, but it still mixes:

- low-level byte math
- full-map generation
- assumptions about one specific map-building strategy

It does not yet expose the smaller units needed for the new mode, especially:

- calculate tuning bytes for one target note
- build a bulk dump from an already-prepared 128-entry tuning array
- patch one entry in an existing 128-entry tuning array and recompute checksum

### 2. Real-time note logic

`src/midi_synth/index.js`

`MidiHex` currently owns too much of the MTS domain:

- choosing the carrier slot via `VoicePool`
- computing the target MIDI float and fine tuning
- building the 4-byte internal `mts` representation
  - `[slot, tt, yy, zz]`
- sending the real-time sysex message
- updating `keymap`
- retuning held notes

This logic is the basis for the requested Sequential-compatible behavior, so it
must be extracted rather than duplicated.

### 3. Bulk-map send logic

`src/keyboard/keys.js`

`mtsSendMap()` currently:

- sends the current `this.mts_tuning_map`
- patches active/sustained notes into the outgoing bulk dump
- sends either:
  - 128 real-time note-specific sysex messages, or
  - one non-real-time bulk dump

This function currently assumes the source of truth is a full map already built
for the whole scale. It does not yet support:

- maintaining a mutable per-output bulk map that is updated note-by-note
- patching one carrier entry chosen by the real-time allocator
- sending the resulting dump as part of note-on sequencing

### 4. Settings and persistence

Relevant files:

- `src/settings/midi/mts.js`
- `src/settings/midi/midioutputs.js`
- `src/app.jsx`
- `src/use-settings-change.js`
- `src/session-defaults.js`

The persistence-refactor document establishes that:

- persistence policy should be centralized
- browser storage should not be written from UI components
- runtime state should reflect clear domain concepts rather than overloaded
  settings

The current MTS settings do not yet follow that direction.

## Design Direction

## Separate Three Concerns

The MTS domain should be split into three layers.

### A. Pitch and encoding math

Pure functions only. No WebMidi, no Keys instance, no synth object, no UI.

Suggested responsibilities:

- derive absolute target pitch from:
  - scale-relative cents
  - reference/fundamental
  - degree-0 offset
- encode one target pitch as MTS bytes
- decode MTS bytes back to pitch when needed
- build one 128-entry tuning-data array
- patch one slot in a 128-entry tuning-data array
- serialize a 128-entry array into bulk-dump sysex bytes
- serialize one slot update into single-note real-time sysex bytes

### B. Carrier allocation and note state

Runtime logic that decides which MIDI carrier note to use.

Suggested responsibilities:

- `MTS1` full-range allocation
- `MTS2` limited-range allocation
- note stealing policy
- maintaining per-note carrier ownership
- knowing which carrier slot a held note currently occupies

This remains coupled to `VoicePool`, but not to sysex byte layout.

### C. Transport strategies

Runtime logic that decides how the encoded tuning reaches the synth.

Three transport strategies are needed:

1. `single_note_realtime`
   - current `MTS1` / `MTS2` behavior

2. `bulk_static_map`
   - current DIRECT behavior
   - one map for the scale, sent when settings change or on demand

3. `bulk_dynamic_map`
   - requested new behavior
   - map persists in memory
   - each note-on rewrites one slot and resends the full dump

The critical insight is that `single_note_realtime` and `bulk_dynamic_map`
should share carrier allocation and pitch calculation, and differ only at the
final transport step.

## Proposed Extraction

## 1. Expand `mts-helpers.js` into a fuller domain module

Either keep the current file and extend it, or split it into several files
under something like `src/mts/`.

Suggested functions:

- `computeReferenceCents(fundamental, degree0toRefRatioOrCents, ...)`
- `computeTargetMidiFloatFromCents(cents, fundamental, degree0toRefRatio)`
- `encodeMtsTriplet(targetMidiFloat)`
  - returns `[tt, yy, zz]`
- `buildRealtimeSingleNoteMessage({ deviceId, mapNumber, carrierNote, triplet })`
- `buildBulkTuningData({ tuningMapDegree0, scale, equave, fundamental, degree0toRef })`
  - returns `Array(128)` of `[tt, yy, zz]`
- `buildBulkDumpMessage({ deviceId, mapNumber, name, entries })`
- `patchBulkTuningEntry(entries, carrierNote, triplet)`
- `recomputeBulkChecksum(messageBytes)`

Important change:

`mtsTuningMap(...)` is currently too coarse. It combines:

- deriving the 128 tuning entries
- formatting as either realtime-per-note or non-realtime bulk

Those should be separate.

## 2. Remove duplicated MTS math from `src/midi_synth/index.js`

`src/midi_synth/index.js` currently defines another copy of:

- `centsToMTS`
- `mtsToMidiFloat`

It also computes the real-time note tuning inline inside `MidiHex`.

That should be replaced with imports from the extracted MTS domain layer.

Suggested refactor:

- keep `VoicePool` decisions in `midi_synth`
- move MTS encoding math out
- convert `MidiHex` to ask a helper for:
  - target MIDI float
  - carrier-specific triplet
  - transport message bytes

This will make the new bulk-dynamic mode use the exact same pitch logic as the
real-time mode.

## 3. Introduce an explicit MTS transport mode

Current state uses:

- `midi_mapping = "MTS1" | "MTS2"`
- `sysex_type = 127 | 126`
- separate `output_direct`

That is not expressive enough for the requested new behavior, because:

- `MTS1` and `MTS2` describe carrier allocation
- `sysex_type` currently describes wire format
- but the new mode requires:
  - real-time carrier allocation semantics
  - bulk-dump wire transport

Suggested runtime concepts:

- `mts_allocation_mode`
  - `"mts1" | "mts2" | "static_map"`

- `mts_transport_mode`
  - `"single_note_realtime" | "bulk_static_map" | "bulk_dynamic_map"`

- `mts_target_port`
- `mts_target_channel`
- `mts_device_id`
- `mts_map_number`

If preserving current UI labels is preferred, these can be transitional internal
keys first, with adapters from the old settings.

This fits the persistence-refactor document because it replaces overloaded flags
with explicit domain concepts.

## 4. Add a dynamic bulk-map state object

The new mode needs an in-memory mutable map per output target.

Suggested runtime object:

- `DynamicMtsMapState`
  - `entries`
    - 128 x `[tt, yy, zz]`
  - `deviceId`
  - `mapNumber`
  - `name`
  - `checksumReadyMessage`
    - optional cached serialized form
  - `slotOwners`
    - optional mapping of carrier note -> active hex/note id

Behavior:

- initialize from the current scale-derived 128-entry map
- when a note is allocated to carrier `n`:
  - compute new triplet for that note
  - replace `entries[n]`
  - serialize/send full bulk dump
  - then send note-on
- when another note steals the same carrier:
  - overwrite `entries[n]` again
  - resend bulk dump
  - then trigger note

This state should live with the synth/output runtime, not in the UI layer.

Reason:

- it is transport state, not user settings
- it should not be persisted
- it must reset when output device or tuning basis changes

## 5. Create a new runtime hex/synth path for dynamic bulk MTS

Current classes:

- `MidiHex`
  - real-time single-note sysex
- `DirectHex`
  - plain note-on/off using a pre-sent static map

Suggested addition:

- `BulkDynamicMtsHex`
  - chooses carrier the same way as `MidiHex`
  - computes the same `[tt, yy, zz]`
  - updates the dynamic map state
  - sends full bulk dump
  - then sends note-on

This can be implemented either:

1. as a separate class, simplest to reason about
2. as a shared carrier-allocation base plus pluggable transport strategy

The second is architecturally cleaner if the MTS extraction is being done
seriously.

## 6. Reconsider `keys.mtsSendMap()`

`Keys.mtsSendMap()` currently mixes:

- deciding which output is being targeted
- choosing sysex type
- cloning and patching the outgoing map
- sending the final bytes

After the extraction, `keys` should not own MTS-domain mutation rules.

Recommended direction:

- keep `keys` responsible only for invoking output actions
- move map mutation and sysex formatting into the synth/MTS layer

Then `keys` can call something like:

- `synth.sendStaticBulkMap()`
- `synth.refreshCurrentTuningMap()`

and note-on paths can call:

- `hex.noteOn()`

without `keys` needing to understand how dynamic bulk retuning works.

This matters because the new mode is not "send the current global map". It is
"update one real-time carrier slot within a maintained map and send that map".

## 7. Define reset and invalidation rules

The dynamic bulk-map state must be rebuilt when any tuning-basis setting
changes.

At minimum:

- scale
- equave / `equivInterval`
- fundamental
- reference degree
- center degree if it affects anchor derivation
- map number
- device id
- preset name if bulk name bytes should track preset name
- output target/device change
- allocation mode change (`mts1` vs `mts2`)

Recommended rule:

- any change that would change either:
  - the baseline 128-note map
  - the carrier allocation strategy
  should discard the current dynamic map state and rebuild it from scratch

This is consistent with the persistence-refactor principle that runtime-derived
state should not be hydrated.

## Concrete File-Level Change Map

## `src/keyboard/mts-helpers.js`

Needed changes:

- split coarse `mtsTuningMap(...)` into smaller pure functions
- expose helpers for:
  - one-note triplet encoding
  - 128-entry map building
  - bulk message serialization
  - single-entry patching
  - checksum regeneration
- become the canonical source of MTS byte math

## `src/midi_synth/index.js`

Needed changes:

- remove duplicate `centsToMTS` / `mtsToMidiFloat`
- extract inline real-time pitch encoding from `MidiHex`
- create a reusable path shared by:
  - current real-time MTS output
  - new bulk-dynamic MTS output
- add a new transport strategy or new hex class for dynamic bulk mode
- keep `VoicePool` logic, but decouple it from sysex construction

## `src/keyboard/keys.js`

Needed changes:

- reduce `mtsSendMap()` to a simpler orchestration role
- stop making `keys` the place where mutable bulk-map semantics live
- ensure settings changes trigger the right synth/map refresh actions
- preserve existing "protect active sustained slots" behavior only if still
  needed after the transport refactor

Open question:

- whether the active-note protection logic belongs in `keys`, in the synth, or
  becomes unnecessary once the dynamic map is owned by the transport layer

## `src/use-synth-wiring.js`

Needed changes:

- expand synth selection logic to distinguish:
  - real-time single-note MTS
  - static bulk map / DIRECT
  - dynamic bulk map
- instantiate the correct transport/allocation combination
- rebuild synth runtime when MTS-domain settings change

This file is the likely place to convert legacy UI settings into clearer runtime
MTS mode objects.

## `src/settings/midi/mts.js`

Needed changes:

- rethink the UI model so it represents:
  - allocation strategy
  - transport strategy
  - device id
  - map number

Possible UI direction:

- Allocation
  - `MTS1`
  - `MTS2`
- Transport
  - `single-note real-time`
  - `bulk dump per note`
- Bulk map target
  - map number
  - device id

This is clearer than overloading `sysex_type`.

## `src/settings/midi/midioutputs.js`

Needed changes:

- align the separate DIRECT section with the new shared MTS model
- decide whether DIRECT remains a separate product concept or becomes one
  transport/allocation preset within a unified MTS section

Recommended direction:

- keep DIRECT as a user-facing concept if desired
- but internally model it as:
  - allocation: `static_map`
  - transport: `bulk_static_map`

The new Sequential-compatible mode would then be:

- allocation: `mts1` or `mts2`
- transport: `bulk_dynamic_map`

## `src/app.jsx`, `src/use-settings-change.js`, `src/session-defaults.js`

Needed changes:

- stop writing MTS-related storage from UI controls
- move persistence policy into the central persistence registry proposed in
  `persistence-refactor.md`
- ensure runtime MTS state is rebuilt from canonical settings, not preserved as
  ad hoc object state across incompatible changes

## Persistence Implications

Based on `persistence-refactor.md`, the following distinction should be made.

### Persisted user settings

These are user choices and belong in the settings/persistence layer:

- output enabled flags
- selected MTS target device/port
- selected channel
- selected allocation mode
- selected transport mode
- device id
- map number
- auto-send preference

These are likely session-scoped, not shareable URL state, because they are
device-routing choices.

### Derived runtime state

These must not be persisted:

- current 128-entry dynamic bulk map contents
- current checksum
- current active carrier-slot ownership
- current voice-pool occupancy
- current patched entries for held notes

These should be rebuilt whenever the synth runtime is recreated.

## Behavioral Notes For The New Sequential-Compatible Mode

Required note-on sequence:

1. choose carrier slot exactly as real-time MTS currently does
2. compute `[tt, yy, zz]` exactly as real-time MTS currently does
3. update the maintained 128-entry map at that carrier slot
4. serialize and send the non-real-time bulk dump
5. send note-on on that carrier slot

Required note-off sequence:

- send note-off on the allocated carrier slot

Retune during held notes:

- this needs an explicit design choice

Options:

1. keep current real-time retune semantics
   - patch carrier entry
   - resend full dump
   - optionally noteOff/noteOn around large jumps

2. only support note-on-time retuning for the new mode initially
   - simpler first version
   - document that continuous retune gestures are not yet supported

The first option is more correct if this mode is intended to mirror real-time
MTS closely.

## Open Questions

1. Should the new mode support both `MTS1` and `MTS2` carrier allocation, or
   only the full 128-note version initially?

2. Should bulk-dynamic mode preserve the current active-note slot-protection
   behavior now implemented in `keys.mtsSendMap()`, or should carrier ownership
   alone define correctness?

3. Should the maintained bulk map start from:
   - the scale-derived global map, then patch active carriers
   - or an initially neutral map that is populated only as carriers are used

4. Should DIRECT remain separate in the UI, even if the internal model unifies
   all MTS behaviors?

5. Should `sysex_type` survive as a user-facing setting at all?
   - likely no, if transport mode becomes explicit

## Recommended Implementation Order

1. finish extraction of pure MTS helpers
2. eliminate duplicate MTS math in `midi_synth/index.js`
3. define explicit runtime MTS mode objects
4. refactor synth wiring to instantiate transport/allocation strategies
5. implement bulk-dynamic mode using the same carrier and triplet logic as
   real-time mode
6. simplify `keys.mtsSendMap()` so it no longer owns transport semantics
7. move MTS-related persistence to the centralized persistence registry

## Immediate Practical Recommendation

Before implementing the new mode, treat this as a domain-model cleanup rather
than "just add another sysex option".

If the code merely adds another conditional around the current `sysex_type`
logic, the result will likely duplicate:

- target-note selection
- MTS triplet encoding
- map patching
- settings branching

The durable approach is:

- one carrier-allocation path
- one pitch-to-MTS encoding path
- multiple transport strategies

That structure directly matches the planned persistence refactor, because it
separates stable user intent from transient runtime state.

## Implementation Checklist

This section is intended as a practical walkthrough for the refactor.

## Phase 1: Freeze Current Behavior

Goal:

- document and protect the current behavior before changing architecture

Tasks:

- identify the current runtime entry points for:
  - real-time single-note MTS
  - bulk static map send
  - DIRECT carrier playback
- list the exact settings currently controlling each path
- capture the current expected byte layouts for:
  - single-note real-time sysex
  - non-real-time bulk dump
- add or update tests around pure MTS math before moving code

Files:

- `src/keyboard/mts-helpers.js`
- `src/midi_synth/index.js`
- `src/keyboard/keys.js`
- `public/midituning.html`

Risk:

- low
- this phase should not change runtime behavior

## Phase 2: Finish Pure MTS Extraction

Goal:

- move all reusable MTS math and message formatting into one canonical pure
  module

Tasks:

- make `mts-helpers.js` the only source of:
  - triplet encoding
  - triplet decoding
  - full-map entry generation
  - single-note message formatting
  - bulk-dump formatting
  - bulk checksum regeneration
- remove duplicated math from `src/midi_synth/index.js`
- split `mtsTuningMap(...)` into smaller reusable functions
- ensure the helper layer can work with:
  - one note
  - one carrier slot patch
  - a full 128-entry map

Files:

- `src/keyboard/mts-helpers.js`
- `src/midi_synth/index.js`

Risk:

- medium
- easiest place to introduce off-by-one or byte-layout regressions

Verification:

- unit tests for:
  - edge MIDI note values
  - fine-tuning boundaries
  - checksum generation
  - map-number and device-id placement in headers

## Phase 3: Isolate Carrier Allocation From Transport

Goal:

- separate "which carrier note do we use?" from "how do we send its tuning?"

Tasks:

- identify the exact allocation logic currently embedded in `MidiHex`
- extract allocation outputs into a stable shape, for example:
  - `carrier`
  - `targetMidiFloat`
  - `triplet`
  - `bendUp`
  - `bendDown`
- keep `VoicePool` ownership and note stealing in `midi_synth`
- stop coupling slot choice directly to real-time sysex emission

Files:

- `src/midi_synth/index.js`
- `src/voice_pool_nearest.js`

Risk:

- medium
- note stealing and pool release timing must remain correct

Verification:

- tests or manual checks for:
  - repeated note triggering
  - voice stealing
  - MTS1 full-range allocation
  - MTS2 split-range allocation

## Phase 4: Introduce Explicit Runtime MTS Modes

Goal:

- replace overloaded flags with clearer MTS runtime concepts

Tasks:

- define an internal runtime model for:
  - allocation mode
  - transport mode
  - device id
  - map number
  - target output
- add a translation layer from existing settings to the new runtime mode object
- keep old settings names temporarily if needed for compatibility

Files:

- `src/use-synth-wiring.js`
- `src/app.jsx`
- `src/session-defaults.js`
- `src/use-settings-change.js`

Risk:

- medium
- easy to break reconstruction timing or leave stale settings in the live synth

Verification:

- manual checks that changing:
  - map number
  - device id
  - output port
  - allocation mode
  reconstructs or refreshes the right runtime objects

## Phase 5: Implement Dynamic Bulk MTS Transport

Goal:

- add the new Sequential-compatible mode that uses real-time allocation
  semantics with bulk-dump transport

Tasks:

- create a maintained in-memory 128-entry map state
- initialize it from the current scale-derived map
- on note-on:
  - choose carrier slot using the real-time path
  - compute triplet using the real-time path
  - patch that slot in the maintained map
  - send the full bulk dump
  - send the MIDI note-on
- on note-off:
  - send note-off for the carrier slot
- decide and implement held-note retune behavior

Files:

- `src/midi_synth/index.js`
- `src/keyboard/mts-helpers.js`
- possibly a new file under `src/mts/` or `src/midi_synth/`

Risk:

- high
- this is the main new behavior and touches note timing, allocation, and sysex
  sequencing

Verification:

- manual hardware test with a bulk-dump-only target synth
- repeated polyphonic triggering
- note stealing behavior
- changing pitch while holding notes, if supported

## Phase 6: Simplify `keys.mtsSendMap()`

Goal:

- make `keys` a caller of MTS services, not the owner of MTS transport logic

Tasks:

- move mutable bulk-map logic out of `keys`
- keep only:
  - explicit "send static map now"
  - possibly "refresh output tuning map now"
- review whether sustained-slot patching remains necessary
- remove settings branching from `keys` where transport mode belongs to synth
  runtime

Files:

- `src/keyboard/keys.js`

Risk:

- medium
- easy to break manual "Send Map" behavior or automatic resend-on-change

Verification:

- manual check of:
  - auto-send
  - manual "Send Map"
  - output changes during an active session

## Phase 7: Align The UI With The New Domain Model

Goal:

- make the settings UI describe user intent clearly

Tasks:

- review whether `sysex_type` should remain user-facing
- add or rename UI controls to expose:
  - allocation strategy
  - transport strategy
  - device id
  - map number
- decide whether DIRECT stays separate in the UI or becomes one preset within a
  unified MTS section

Files:

- `src/settings/midi/mts.js`
- `src/settings/midi/midioutputs.js`

Risk:

- medium
- UX confusion is likely if allocation and transport are still conflated

Verification:

- manual settings walkthrough:
  - can a user understand the difference between static map, dynamic bulk, and
    single-note real-time
  - do all visible controls map to one clear runtime concept

## Phase 8: Move MTS Persistence Into The Central Registry

Goal:

- bring the MTS settings into the persistence architecture defined in
  `persistence-refactor.md`

Tasks:

- classify each MTS-related setting as:
  - URL-shareable musical state
  - session-only routing state
  - local preference
  - derived runtime state
- remove direct storage writes from MTS UI controls
- define hydration order for MTS settings using the central registry
- ensure dynamic map contents are never persisted

Files:

- `docs/persistence-refactor.md`
- the future persistence registry file
- `src/use-settings-change.js`
- `src/session-defaults.js`
- MTS settings UI components

Risk:

- medium
- stale hydration is the main failure mode here

Verification:

- reload behavior
- preset load behavior
- URL share behavior
- device-routing persistence behavior

## Suggested File-by-File Walkthrough

Use this order when reading and changing code:

1. `src/keyboard/mts-helpers.js`
   - define the pure API first

2. `src/midi_synth/index.js`
   - route all MTS note math through the pure API

3. `src/use-synth-wiring.js`
   - define runtime mode selection and synth construction

4. `src/keyboard/keys.js`
   - reduce orchestration responsibilities after the synth layer is clarified

5. `src/settings/midi/mts.js`
   - adjust the main MTS settings UI

6. `src/settings/midi/midioutputs.js`
   - adjust DIRECT and related output controls

7. persistence layer files
   - only after the runtime domain model is stable

This order avoids redesigning persistence around settings that are still
conceptually muddled.

## Short Risk Register

- Byte-layout regressions:
  - any change to sysex formatting can silently break hardware compatibility

- State split regressions:
  - if allocation state, dynamic map state, and settings state are spread
    across too many layers, bugs will remain difficult to reason about

- Reconstruction bugs:
  - if the live synth runtime is not recreated when MTS settings change, map
    number and device id bugs will persist

- UI ambiguity:
  - if transport and allocation remain conflated, the new mode will be harder
    to maintain and explain

## Practical Review Gates

Before merging the eventual implementation, verify:

1. one pure module is the single source of truth for MTS byte math
2. no duplicate `centsToMTS` logic remains in `midi_synth`
3. real-time and dynamic-bulk modes use the same carrier allocation path
4. dynamic bulk mode updates exactly one slot, then sends a full dump, then
   triggers the note
5. map number and device id are sourced from explicit current settings
6. no dynamic map contents are persisted across reloads
