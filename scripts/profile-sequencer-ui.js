/**
 * Opt-in UI smoke/profile workload for an isolated browser on the Vite server.
 * Loads Flight/FALL and changes the current sequence and diagnostic preference.
 * Never run in a performance session; disable physical outputs first.
 * Console: await (await import('/scripts/profile-sequencer-ui.js')).profileSequencerUi()
 * Measures synthetic handler cost/model rebuilds, NOT audible or MIDI latency.
 */
export async function profileSequencerUi() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const diag = await import("/src/debug/sequence-runtime-diagnostics.js");
  localStorage.setItem("hexatone_debug_sequence_runtime", "true");
  const read = () => {
    diag.flushPersistedSequenceRuntimeDiagnostics();
    return diag.loadPersistedSequenceRuntimeDiagnostics().state;
  };
  const results = [];
  const tab = (name) =>
    [...document.querySelectorAll("button")].find((e) => e.textContent === name).click();
  tab("SEQUENCER");
  await wait(500);
  for (const name of ["Fleeting", "FALL"]) {
    const select = [...document.querySelectorAll("select")].find((e) =>
      [...e.options].some((o) => o.text.startsWith(name)),
    );
    select.value = [...select.options].find((o) => o.text.startsWith(name)).value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(1500);
    for (const expanded of [true, false]) {
      document
        .querySelector(
          `button[title="${expanded ? "Expand to sequence view" : "Collapse to snapshot view"}"]`,
        )
        ?.click();
      await wait(500);
      for (const target of ["marker", "step"]) {
        const baseline = read();
        if (!baseline?.entries.some((e) => e.step === "build-sequence-runtime-model"))
          throw Error("Missing model-load diagnostic baseline");
        const before = baseline.nextId;
        const durations = [];
        let longTasks = null,
          observer;
        if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
          longTasks = [];
          observer = new PerformanceObserver((list) =>
            longTasks.push(...list.getEntries().map((e) => e.duration)),
          );
          observer.observe({ type: "longtask" });
        }
        for (let i = 0; i < 25; i++) {
          const start = performance.now();
          const button = document.querySelector(`button[aria-label="next sequence ${target}"]`);
          if (!button || button.disabled) throw Error("Trigger unavailable");
          button.click();
          durations.push(performance.now() - start);
          await wait(50);
        }
        await wait(300);
        observer?.disconnect();
        const entries = read().entries.filter((e) => e.id >= before);
        results.push({
          name,
          expanded,
          target,
          maxHandlerMs: Math.max(...durations),
          longTasks,
          modelBuilds: entries.filter((e) => e.step === "build-sequence-runtime-model").length,
          diagnosticSteps: [...new Set(entries.map((e) => e.step))],
        });
      }
    }
    document.querySelector('button[title="Stop timed transport"]')?.click();
    await wait(100);
    document.querySelector('button[title="Play timed transport"]').click();
    await wait(600);
    tab("I/O");
    await wait(600);
    const inIO = !!document.querySelector('button[title="Pause timed transport"]');
    document.querySelector('button[title="Pause timed transport"]')?.click();
    await wait(100);
    const paused = !!document.querySelector('button[title="Play timed transport"]');
    document.querySelector('button[title="Stop timed transport"]')?.click();
    results.push({ name, timedActiveInIO: inIO, pausedInIO: paused });
    tab("SEQUENCER");
    await wait(300);
  }
  return results;
}
