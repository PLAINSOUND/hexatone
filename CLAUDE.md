# CLAUDE.md — Plainsound Hexatone

## Project overview

Hexatone is a **microtonal isomorphic keyboard** web app. Users play tuning systems on a hexagonal canvas grid via touch, mouse, computer keyboard, or hardware MIDI controllers (either a standard keyboard, or various 2D control surfaces like Lumatone, AXIS-49, AXIS-64, LinnStrument, Push, Launchpad, Exquis, and others). Sound output is either built-in Web Audio samples or external MIDI (MTS sysex, MPE, direct note mapping).

**Live site:** https://hexatone.plainsound.org 
**Repo:** https://github.com/PLAINSOUND/hexatone  
**Current version:** 3.1.0_beta — refactoring controller auto-mapping

## Tech stack

- **UI framework:** Preact 10 (not React — use `h` from `preact`, hooks from `preact/hooks`)
- **Bundler:** Vite 7 with `@preact/preset-vite`
- **Testing:** Vitest + @testing-library/preact + jsdom
- **Styling:** Plain CSS (no Tailwind, no CSS-in-JS). Main files: `hex-style.css`, `keyboard.css`, `settings.css`, `loader.css`
- **Package manager:** Yarn 4 (corepack)
- **No TypeScript.** All source is `.js` / `.jsx`. PropTypes used sparingly.
- **No state library.** State lives in a single `useState` in `app.jsx`, synced to URL params + localStorage via `useQuery` hook, with session-scoped values in `sessionStorage`.

## Architecture

```
src/
├── app.jsx              # Root component — ALL app state, synth wiring, preset logic (~1280 lines)
├── index.jsx            # Preact render entry point
├── use-query.js         # Custom hook: bidirectional sync state ↔ URL params ↔ localStorage
├── keyboard/            # Canvas-based hex grid
│   ├── index.js         # <Keyboard> Preact wrapper — mounts/destroys Keys instance
│   ├── keys.js          # Imperative canvas renderer + input handler (~2335 lines)
│   ├── matrix.js        # Hex grid coordinate math
│   ├── keyboard_math.js # Geometry helpers (hex size, rotation, snapping)
│   ├── point.js         # 2D point class
│   ├── color_utils.js   # HSL/spectrum colour generation
│   └── euclidean.js     # Euclidean rhythm utilities
├── controllers/         # Hardware MIDI controller geometry maps
│   ├── registry.js      # Controller database: detect + buildMap for each device
│   ├── axis49.js        # AXIS-49 specific logic (legacy, being folded into registry)
│   └── lumatone.js      # Lumatone specific logic (legacy, being folded into registry)
├── settings/            # Sidebar UI panels
│   ├── index.jsx        # <Settings> — composes all sub-panels
│   ├── preset_values.js # Built-in tuning presets (~3270 lines of data)
│   ├── custom-presets.js # User preset save/load (localStorage JSON)
│   ├── scale/           # Scale editor, parser, colour picker, import/export
│   │   ├── parse-scale.js   # Scala (.scl) and Hexatone JSON parser
│   │   ├── scale-table.js   # Editable scale degree table
│   │   ├── colors.js        # Per-note colour editor
│   │   └── lumatone-export.js # Export to Lumatone .ltn format
│   ├── midi/            # MIDI I/O settings panels
│   └── sample/          # Sample instrument selector + volume
├── sample_synth/        # Web Audio sample playback engine
├── midi_synth/          # MTS sysex MIDI output synth
├── mpe_synth/           # MPE pitch-bend MIDI output synth
├── composite_synth/     # Fan-out: wraps multiple synths as one interface
├── voice_pool_oldest.js # Voice stealing: evict oldest note
├── voice_pool_nearest.js# Voice stealing: evict nearest pitch
└── recency_stack.js     # Stack for tracking most-recent notes
```

## Key patterns & conventions

### State flow
- `app.jsx` owns **one** settings object via `useQuery()`. All changes go through `onChange(key, value)` or `onAtomicChange({...updates})`.
- `useQuery` syncs non-skip keys to both URL search params and localStorage. Preset-specific keys (`PRESET_SKIP_KEYS`) are never persisted to URL/localStorage — they come only from preset loads or session storage.
- Session-scoped output settings (MIDI device choices, instrument, etc.) use `sessionStorage` directly in `sessionDefaults`.
- Colour changes are pushed **imperatively** to the live `Keys` instance via `keysRef.current.updateColors()` to avoid full canvas reconstruction.
- Structural changes (scale, layout, MIDI config) trigger a `Keys` deconstruct + reconstruct via the `structuralSettings` useMemo dependency.

### Synth interface
Every synth (sample, MTS, MPE, direct) exposes the same interface:
```js
{
  makeHex(coords, cents) → { coords, cents, release, noteOn(), noteOff(), retune(), aftertouch() },
  prepare(),      // resume AudioContext after user gesture
  setVolume(v),   // 0–1
}
```
`composite_synth` wraps multiple synths transparently. `keys.js` only ever talks to one synth.

### Canvas rendering
`keys.js` is imperative — it owns the `<canvas>` element, draws hexagons, and handles pointer/touch/keyboard events directly. It is **not** a Preact component. The `<Keyboard>` wrapper in `keyboard/index.js` manages its lifecycle.

### Controller mapping
`controllers/registry.js` defines a database of known 2D isomorphic controllers. Each entry has `detect(name)` for auto-detection, `anchor` params for UI, and `buildMap()` returning `Map<"ch.note", {x, y}>`. This is the active refactoring area (v3.1.0_beta).

### Scale representation
- Scales are arrays of string pitch values (cents like `"700.0"`, ratios like `"3/2"`, or expressions).
- `parse-scale.js` converts between Scala (.scl) format and internal representation.
- The last element is the equivalence interval (usually `"1200.0"` for octave). It gets `pop()`-ed off and `0` is unshifted in during normalization.

## Coding style

- **Vanilla JS** — no TypeScript, no Flow. Keep it that way unless a migration is planned.
- **Functional components only** — no class components. Use Preact hooks.
- **`h` import** — always `import { h } from "preact"` even if JSX pragma handles it (for explicitness).
- **Comments are valued** — the codebase has thorough inline comments explaining *why*, not just *what*. Maintain this style.
- **No semicolons?** — mixed; some files use them. Whenever they are missing, check the file you are in and apply them throughout. Desired style is WITH SEMICOLONS
- **Prop destructuring** — settings panels destructure props in the function signature.
- **Test files** live next to their source: `foo.js` → `foo.test.js`.
- Keep bundle size small — Preact was chosen over React for a reason.

## Commands

```bash
yarn start          # Dev server (Vite)
yarn build          # Production build + service worker generation
yarn test           # Run vitest once
yarn test:watch     # Run vitest in watch mode
```

## Known refactoring priorities

1. **`app.jsx` is too large (~1280 lines).** State management, synth wiring, preset logic, and import/export should be extracted into custom hooks or modules. Good candidates:
   - `useSynthWiring(settings, midi, ready)` — the synth creation `useEffect` (lines ~496–664)
   - `usePresets(settings, setSettings)` — preset load/revert/dirty logic
   - `useSessionDefaults()` — the 50+ line `sessionDefaults` object
   - `useImport(settings, setSettings)` — the `onImport` handler

2. **`keys.js` is very large (~2335 lines).** Input handling (pointer, touch, keyboard, MIDI) could be separated from rendering logic.

3. **Controller mapping refactor (current work):** Consolidating `axis49.js` and `lumatone.js` into the unified `controllers/registry.js` pattern. Goal: auto-detect any registered controller from MIDI input device name, build its coordinate map, and wire it into `keys.js` without per-controller special cases.

4. **State persistence is fragmented** across URL params, localStorage, and sessionStorage with different keys skipped in different contexts. A unified persistence layer would reduce bugs.

5. **Test coverage is thin** — mainly scale parsing and matrix math. Settings UI and synth wiring are untested.

## Music domain context

When working on this codebase, it helps to understand:
- **Cents:** logarithmic pitch unit. 100 cents = 1 12-EDO semitone, 1200 cents = 1 octave. 
- **MIDICents:** logarithmic pitch unit in the context of MIDI Note numbers. 69.0 === A (default = 440 Hz) Thus cents_from_A = MIDICents * 100.0 - 69.0
- **Scala format (.scl):** text file listing pitch intervals, one per line. Last line is the equivalence interval.
- **MTS (MIDI Tuning Standard):** sysex messages to retune MIDI devices to arbitrary pitches.
- **MPE (MIDI Polyphonic Expression):** each note gets its own MIDI channel for per-note pitch bend, pressure, controllers.
- **Isomorphic keyboard:** any given interval always has the same geometric shape on the grid, regardless of starting note.
- **rSteps / drSteps:** the two generator intervals that define how scale steps are mapped onto the hex grid's axis orientations.
- **equivSteps:** number of scale degrees per equivalence interval (e.g., 12 for 12-EDO, 31 for 31-EDO).
- **Fundamental / reference_degree:** the reference frequency (Hz) assigned to a specific scale degree.
- **central_degree** the scale degree drawn at the center of the onscreen canvas
