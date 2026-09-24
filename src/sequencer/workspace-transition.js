/** Pure tab-transition policy. Actions affect sequencer voices only; live input
 * and the stable transport/portal lifetime remain owned by App and Keys. */
export function sequenceWorkspaceTransition({ previousPerformanceTab, performanceTab,
  previousTab, tab, playhead, timedClockSeconds } = {}) {
  const changedTab = previousTab !== tab;
  const heldSnapshot = !playhead?.stopped && playhead?.stepIndex >= 0 &&
    playhead?.markerIndex == null && !Number.isFinite(timedClockSeconds);
  if (changedTab && tab !== "sequencer" && heldSnapshot) return "flush-manual-snapshot";
  if ((previousPerformanceTab === "sequencer" && performanceTab === "hexatone") ||
    (performanceTab === "sequencer" && changedTab && ["manual", "calculator"].includes(tab)))
    return "stop-sequencer";
  return "preserve";
}
