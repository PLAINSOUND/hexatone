/** Retry shared audio recovery inside a real gesture, before UI event handlers.
 * Never wait behind a pending background resume: iOS may require a fresh gesture.
 * Ownership stays with sample_synth; no instruments or contexts are created here.
 */
export function installAudioGestureRecovery(
  target, getContext, onRecovered, onError, consumeInterruption = () => false,
) {
  let disposed = false;
  let restart = null;
  const isCurrent = (context) => !disposed && getContext() === context;
  const resume = (context) => {
    if (!isCurrent(context) || context.state === "closed") return;
    return Promise.resolve(context.resume()).then(() => {
      if (isCurrent(context) && context.state === "running") onRecovered(context);
    });
  };
  const recover = () => {
    const context = getContext();
    if (!context || context.state === "closed") return;
    if (consumeInterruption() && typeof context.suspend === "function") {
      // WebKit can report running while its rendering clock remains frozen.
      // Cycle the existing graph once per return, not once per touch event.
      const ticket = { context };
      restart = ticket;
      try {
        Promise.resolve(context.suspend()).then(() => {
          if (restart !== ticket) return;
          restart = null;
          return resume(context);
        }).catch((error) => {
          if (restart === ticket) restart = null;
          onError(error);
        });
      } catch (error) {
        restart = null;
        onError(error);
      }
      return;
    }
    if (context.state === "running") {
      if (!restart) onRecovered(context);
      return;
    }
    try {
      // Call synchronously, not after an import, timer or another resume promise.
      Promise.resolve(resume(context)).catch(onError);
    } catch (error) {
      onError(error);
    }
  };
  const events = ["pointerdown", "touchend", "click", "keydown"];
  const options = { capture: true, passive: true };
  events.forEach((type) => target.addEventListener(type, recover, options));
  return () => {
    disposed = true;
    restart = null;
    events.forEach((type) => target.removeEventListener(type, recover, options));
  };
}
