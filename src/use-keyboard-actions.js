/**
 * useKeyboardActions — stable imperative interface to the live Keys canvas instance.
 *
 * All calls to keysRef.current scattered across settings panels, synth wiring,
 * and app.jsx are centralised here. Each returned function:
 *   • Closes over keysRef so callers always reach the live instance
 *   • Guards silently when keysRef.current is null (canvas not yet mounted)
 *   • Documents the intended purpose of each Keys method
 *
 * Functions are plain closures (not useCallback) because keysRef is a stable
 * ref object for the component's lifetime — wrapping in useCallback would add
 * hook infrastructure with no memoisation benefit.
 *
 * This hook is the boundary between the React/Preact settings layer and the
 * imperative canvas renderer. When keys.js is refactored, only this file needs
 * to change — all callers stay untouched.
 *
 * Usage:
 *   const kb = useKeyboardActions(keysRef);
 *   kb.panic();
 *   kb.updateColors(colorUpdate);
 */
const useKeyboardActions = (keysRef) => {
  // ── Canvas lifecycle ────────────────────────────────────────────────────────

  /** Recalculate layout and redraw after a container resize. */
  const resizeHandler = () => {
    if (keysRef.current) keysRef.current.resizeHandler();
  };

  // ── Note / sound control ────────────────────────────────────────────────────

  /** Release all active voices immediately (Panic button / MIDI panic). */
  const panic = () => {
    if (keysRef.current) keysRef.current.panic();
  };

  /** Toggle the sustain latch on/off. */
  const latchToggle = () => {
    if (keysRef.current) keysRef.current.latchToggle();
  };

  /**
   * Re-engage sustain after a drag gesture ends while Escape is still held.
   * Only called from tune-cell pointer-up handlers.
   */
  const sustainOn = () => {
    if (keysRef.current?.sustainOn) keysRef.current.sustainOn();
  };

  /** Release all notes that are held by computer-keyboard input. */
  const releaseAllKeyboardNotes = () => {
    if (typeof keysRef.current?.releaseAllKeyboardNotes === "function")
      keysRef.current.releaseAllKeyboardNotes();
  };

  // ── Tuning preview (drag-to-tune) ────────────────────────────────────────────

  /**
   * Shift all currently sounding notes by deltaCents relative to the
   * Reference Frequency. Pass (0, true) to end the session and clear the
   * snapshot. Used by FundamentalTuneCell.
   */
  const previewFundamental = (deltaCents, clearSnapshot = false) => {
    if (keysRef.current?.previewFundamental)
      keysRef.current.previewFundamental(deltaCents, clearSnapshot);
  };

  /**
   * Snapshot the base pitch of all sounding notes before a fundamental drag
   * begins, so relative offsets can be applied during the drag. Called once
   * on pointer-down by FundamentalTuneCell.
   */
  const snapshotForFundamentalPreview = () => {
    if (keysRef.current?.snapshotForFundamentalPreview)
      keysRef.current.snapshotForFundamentalPreview();
  };

  /**
   * Retune all sounding notes that belong to degree 0 to the given absolute
   * cents value. All other notes are unaffected. Used by TuneCell (degree 0).
   */
  const previewDegree0 = (cents) => {
    if (keysRef.current?.previewDegree0) keysRef.current.previewDegree0(cents);
  };

  /**
   * Live-retune all sounding notes on a specific scale degree to targetCents.
   * Used by TuneCell while dragging non-zero degrees.
   */
  const updateScaleDegree = (degree, targetCents) => {
    if (keysRef.current?.updateScaleDegree)
      keysRef.current.updateScaleDegree(degree, targetCents);
  };

  /**
   * Set/clear the "tune dragging" flag so the canvas suppresses spurious
   * Escape-keyup events during pointer capture. Pass true on pointer-down,
   * false on pointer-up or component unmount.
   */
  const setTuneDragging = (active) => {
    if (keysRef.current?.setTuneDragging) keysRef.current.setTuneDragging(active);
  };

  /**
   * Check whether the Escape key is currently held (used to re-engage sustain
   * after drag ends). Returns false if the canvas is not mounted.
   */
  const isEscHeld = () => {
    return !!(keysRef.current?.state?.escHeld);
  };

  // ── Fundamental / MTS ───────────────────────────────────────────────────────

  /**
   * Apply a new reference frequency to all keys without a full canvas
   * reconstruction. Called from the synth-wiring effect when only the
   * fundamental changes.
   */
  const updateFundamental = (fundamental) => {
    if (keysRef.current?.updateFundamental) keysRef.current.updateFundamental(fundamental);
  };

  /**
   * Send an MTS tuning map to the given MIDI output port.
   * sendAll and sendRT control whether all notes or just changed notes are sent.
   */
  const mtsSendMap = (output, sendAll = true, sendRT = true) => {
    if (keysRef.current) keysRef.current.mtsSendMap(output, sendAll, sendRT);
  };

  /** Shift pitch by ±1 octave. dir: 1 (up) or -1 (down). */
  const shiftOctave = (dir, deferred) => {
    if (keysRef.current?.shiftOctave) keysRef.current.shiftOctave(dir, deferred);
  };

  // ── Appearance ──────────────────────────────────────────────────────────────

  /**
   * Push an updated colour map to the canvas without reconstruction.
   * colorUpdate: { noteColors, centralColor, spectrumColors }.
   */
  const updateColors = (colorUpdate) => {
    if (keysRef.current) keysRef.current.updateColors(colorUpdate);
  };

  /**
   * Push updated label settings (key_labels, note_names, heji_names, …) to
   * the canvas without reconstruction.
   */
  const updateLabels = (labelSettings) => {
    if (keysRef.current) keysRef.current.updateLabels(labelSettings);
  };

  // ── MIDI / controller ───────────────────────────────────────────────────────

  /**
   * Enable or disable MIDI-learn mode and wire the anchor-learn callback.
   * onAnchorLearn is called with the learned anchor when the user taps a key.
   */
  const setMidiLearnMode = (active, onAnchorLearn) => {
    if (keysRef.current) keysRef.current.setMidiLearnMode(active, onAnchorLearn);
  };

  /**
   * Sync live output state (active MIDI ports, synth instance) so the canvas
   * can route note events without a full reconstruction.
   */
  const updateLiveOutputState = (liveOutputSettings, synth) => {
    if (keysRef.current) keysRef.current.updateLiveOutputState(liveOutputSettings, synth);
  };

  // ── Hardware LED sync (Exquis / Lumatone / LinnStrument) ──────────────────

  /**
   * Set the Exquis LED state object directly on the Keys instance.
   * Pass null to detach the LED driver.
   */
  const setExquisLEDs = (leds) => {
    if (keysRef.current) keysRef.current.exquisLEDs = leds;
  };

  /** Trigger an immediate Exquis LED sync. */
  const syncExquisLEDs = () => {
    if (keysRef.current?.syncExquisLEDs) keysRef.current.syncExquisLEDs();
  };

  /**
   * Set the Lumatone LED state object directly on the Keys instance.
   * Pass null to detach the LED driver.
   */
  const setLumatoneLEDs = (leds) => {
    if (keysRef.current) keysRef.current.lumatoneLEDs = leds;
  };

  /**
   * Set the LinnStrument LED driver on the Keys instance.
   * Pass null to detach.
   */
  const setLinnstrumentLEDs = (leds) => {
    if (keysRef.current) keysRef.current.linnstrumentLEDs = leds;
  };

  /** Trigger an immediate LinnStrument LED sync. */
  const syncLinnstrumentLEDs = () => {
    if (keysRef.current?.syncLinnstrumentLEDs) keysRef.current.syncLinnstrumentLEDs();
  };

  // ── Keyboard input flag ──────────────────────────────────────────────────────

  /**
   * Toggle whether computer-keyboard events are routed to the canvas.
   * Set to true when the keyboard overlay is active, false when a text
   * input has focus.
   */
  const setTyping = (active) => {
    if (keysRef.current) keysRef.current.typing = active;
  };

  return {
    // Canvas lifecycle
    resizeHandler,
    // Note / sound control
    panic,
    latchToggle,
    sustainOn,
    releaseAllKeyboardNotes,
    // Tuning preview
    previewFundamental,
    snapshotForFundamentalPreview,
    previewDegree0,
    updateScaleDegree,
    setTuneDragging,
    isEscHeld,
    // Fundamental / MTS
    updateFundamental,
    mtsSendMap,
    shiftOctave,
    // Appearance
    updateColors,
    updateLabels,
    // MIDI / controller
    setMidiLearnMode,
    updateLiveOutputState,
    // Hardware LED sync
    setExquisLEDs,
    syncExquisLEDs,
    setLumatoneLEDs,
    setLinnstrumentLEDs,
    syncLinnstrumentLEDs,
    // Keyboard input flag
    setTyping,
  };
};

export default useKeyboardActions;
