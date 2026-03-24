import { detectController } from "./controllers/registry.js";
import { normalizeColors } from "./normalize-settings.js";

// Keys whose changes are pushed imperatively to the live canvas before
// setSettings fires, so color-picker drags are smooth without reconstruction.
const COLOR_KEYS = new Set(["note_colors", "spectrum_colors", "fundamental_color"]);

// Return the detectController entry for the currently connected input device, or null.
const getConnectedController = (deviceId, midi) => {
  if (!deviceId || deviceId === "OFF" || !midi) return null;
  const input = Array.from(midi.inputs.values()).find((m) => m.id === deviceId);
  return input ? detectController(input.name.toLowerCase()) : null;
};

/**
 * Produces the `onChange` and `onAtomicChange` callbacks used by the
 * Settings panel and the Keyboard component.
 *
 * `onChange` handles every special-cased setting change in one place:
 *   - MIDI-learn toggle (no state, just side-effect)
 *   - MIDI input device selection (loads per-controller anchor note)
 *   - Anchor-note persistence (localStorage keyed by controller ID)
 *   - Instrument switch (panic + latch reset)
 *   - equivSteps resize (panic, scale resize, bump importCount)
 *   - scale_divide (panic, scale replace, bump importCount)
 *   - Color changes (imperative canvas push before React re-render)
 *   - All other keys (plain setSettings)
 *
 * @param {object}   settings           - Current app settings
 * @param {function} setSettings        - Settings updater from useQuery
 * @param {object}   options
 * @param {object}   options.midi            - Web MIDI access object
 * @param {function} options.setMidiLearnActive
 * @param {object}   options.keysRef         - Ref to the live Keys canvas
 * @param {function} options.setLatch        - Latch state setter
 * @param {function} options.bumpImportCount - Increment the scale import counter
 *
 * @returns {{ onChange, onAtomicChange }}
 */
const useSettingsChange = (
  settings,
  setSettings,
  { midi, setMidiLearnActive, keysRef, setLatch, bumpImportCount },
) => {
  const onChange = (key, value) => {
    // Toggle MIDI-learn mode — handled outside settings state (no URL sync needed).
    if (key === "midiLearnAnchor") {
      setMidiLearnActive(value);
      return;
    }

    // When the MIDI input device is selected, load the per-controller saved anchor note
    // (or fall back to the controller's built-in default on first use).
    if (key === "midiin_device") {
      let anchorMidiNote = null;
      if (value && value !== "OFF" && midi) {
        const input = Array.from(midi.inputs.values()).find((m) => m.id === value);
        if (input) {
          const ctrl = detectController(input.name.toLowerCase());
          if (ctrl) {
            const saved = localStorage.getItem(`${ctrl.id}_anchor`);
            anchorMidiNote = saved !== null ? parseInt(saved) : ctrl.anchorDefault;
          }
        }
      }
      setSettings((s) => ({
        ...s,
        midiin_device: value,
        ...(anchorMidiNote !== null ? { midiin_central_degree: anchorMidiNote } : {}),
      }));
      sessionStorage.setItem("midiin_device", value);
      if (anchorMidiNote !== null) {
        sessionStorage.setItem("midiin_central_degree", String(anchorMidiNote));
      }
      return;
    }

    // When the user manually changes the anchor note for a known controller, save it
    // to localStorage keyed by controller ID so it's restored on next connect.
    if (key === "midiin_central_degree") {
      const ctrl = getConnectedController(settings.midiin_device, midi);
      if (ctrl) {
        // value IS the raw physical MIDI note number — store directly.
        localStorage.setItem(`${ctrl.id}_anchor`, String(value));
      }
      // Fall through to normal setSettings
    }

    // If instrument is about to change, stop all currently playing notes.
    // This prevents the old instrument's sounds from continuing after switch.
    if (key === "instrument") {
      if (keysRef.current) keysRef.current.panic();
      setLatch(false);
    }

    // When equivSteps changes, resize the scale array and reset scale-related settings.
    // Handled before the COLOR_KEYS block so panic() is called instead of sustainOff().
    if (key === "equivSteps") {
      if (keysRef.current) keysRef.current.panic();
      setLatch(false);
      bumpImportCount();
      setSettings((s) => {
        const newSize = value;
        const currentScale = s.scale || [];
        let newScale;
        if (newSize > currentScale.length) {
          // Pad with default cents values (100 cents per degree)
          const padding = [];
          for (let i = currentScale.length; i < newSize - 1; i++) {
            padding.push(String((i + 1) * 100) + ".0");
          }
          // Last one should be the equave (newSize * 100 cents)
          padding.push(String(newSize * 100) + ".0");
          newScale = [...currentScale, ...padding];
        } else {
          // Truncate or keep same size
          newScale = currentScale.slice(0, newSize);
        }
        // Populate note_names from scale with shift: degree i has name scale[(i - 1 + n) % n]
        const newNoteNames = newScale.map(
          (_, i) => newScale[(i - 1 + newScale.length) % newScale.length],
        );
        return {
          ...s,
          [key]: value,
          scale: newScale,
          note_names: newNoteNames,
          spectrum_colors: true,
          fundamental_color: "#f2e3e3",
        };
      });
      return;
    }

    // When scale is divided into equal parts (Divide Equave / Divide Octave buttons).
    // Same treatment as equivSteps: panic and reset scale-related settings.
    if (key === "scale_divide") {
      if (keysRef.current) keysRef.current.panic();
      setLatch(false);
      bumpImportCount();
      setSettings((s) => {
        // Use the incoming value (new scale), not s.scale (old scale)
        const newScale = value;
        const equivSteps = s.equivSteps || newScale.length;
        const equaveValue = newScale[newScale.length - 1];

        // Check if equave is an octave (1200 cents, 1200.0, 2/1, or "2")
        const isOctave =
          equaveValue === "2" ||
          equaveValue === "2/1" ||
          equaveValue === "1200" ||
          equaveValue === "1200.0" ||
          /^1200\.?0*$/.test(equaveValue);

        // Generate name and description (simplify for octave)
        const equaveForName = isOctave ? "2" : equaveValue;
        const equaveForDesc = isOctave ? "Octave" : `${equaveValue} cents`;
        const newName = `${equivSteps}ed${equaveForName}`;
        const newDescription = `${equaveForDesc} divided into ${equivSteps} equal steps`;

        // Populate note_names from scale with shift: degree i has name scale[(i - 1 + n) % n]
        const newNoteNames = newScale.map(
          (_, i) => newScale[(i - 1 + newScale.length) % newScale.length],
        );
        return {
          ...s,
          scale: newScale,
          name: newName,
          description: newDescription,
          note_names: newNoteNames,
          spectrum_colors: true,
          fundamental_color: "#f2e3e3",
        };
      });
      return;
    }

    // For color changes, push to the live Keys instance BEFORE setSettings.
    // This uses the current keysRef at call time, avoiding stale references
    // if a reconstruction happens during the React batch.
    if (COLOR_KEYS.has(key) && keysRef.current) {
      const colorUpdate = {
        note_colors:
          key === "note_colors"
            ? normalizeColors({ ...settings, [key]: value }).note_colors
            : normalizeColors(settings).note_colors,
        spectrum_colors:
          key === "spectrum_colors" ? value : settings.spectrum_colors,
        fundamental_color:
          key === "fundamental_color"
            ? (value || "").replace(/#/, "")
            : (settings.fundamental_color || "").replace(/#/, ""),
      };
      keysRef.current.updateColors(colorUpdate);
    }

    setSettings((s) => ({ ...s, [key]: value }));
  };

  const onAtomicChange = (updates) => {
    setSettings((s) => ({ ...s, ...updates }));
  };

  return { onChange, onAtomicChange };
};

export default useSettingsChange;
