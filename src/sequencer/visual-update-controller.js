/** Visual-only cue coordination, downstream of audio dispatch.
 * The palette updates immediately; the larger editor presents only the latest
 * cue per animation frame. Cancellation invalidates even already-queued callbacks.
 * This module does not schedule audio or publish deferred App playback state.
 */
export function createVisualUpdateController({ presentImmediate, presentEditor, requestFrame, cancelFrame }) {
  let pending = null;
  let frame = null;

  const cancel = () => {
    const previous = frame;
    frame = null;
    pending = null;
    if (previous?.id != null) cancelFrame(previous.id);
  };

  const present = (cueIndex, trigger, burst) => {
    presentImmediate(cueIndex);
    pending = { cueIndex, trigger, burst };
    if (frame) return;
    const ticket = { id: null };
    frame = ticket;
    ticket.id = requestFrame(() => {
      if (frame !== ticket) return;
      frame = null;
      const notification = pending;
      pending = null;
      if (notification) {
        presentEditor(notification.cueIndex, notification.trigger, notification.burst);
      }
    });
  };

  return { present, cancel };
}
