/** Update only mounted palette highlights/stop buttons, never scroll or render
 * the sequence. Called immediately after timed audio dispatch, not lookahead. */
export function presentSnapshotPalette(body, snapshotId) {
  if (!body) return;
  const target = snapshotId == null ? null : [...body.children].find(
    row => row.dataset.snapshotId === String(snapshotId),
  );
  for (const row of body.querySelectorAll(".snapshot-playing")) {
    if (row === target) continue;
    row.classList.remove("snapshot-playing");
    const stop = row.querySelector(".snapshot-stop-btn");
    if (stop) stop.disabled = true;
  }
  if (target) {
    target.classList.add("snapshot-playing");
    const stop = target.querySelector(".snapshot-stop-btn");
    if (stop) stop.disabled = false;
  }
}
