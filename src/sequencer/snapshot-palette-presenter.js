const pendingReveals = new WeakMap();

/** Scroll only the palette body, never the document or Sequencer panel. */
export function revealSnapshotPalette(body, snapshotId, { center = false } = {}) {
  if (!body || snapshotId == null || body.clientHeight <= 0) return;
  const row = [...body.querySelectorAll(".snapshot-row")].find(
    candidate => candidate.dataset.snapshotId === String(snapshotId),
  );
  if (!row) return;
  const bodyRect = body.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const top = bodyRect.top + body.clientTop;
  const bottom = top + body.clientHeight;
  if (center) {
    body.scrollTop = Math.max(0, body.scrollTop + rowRect.top - top - (body.clientHeight - rowRect.height) / 2);
  } else if (rowRect.top < top || rowRect.height >= body.clientHeight) {
    body.scrollTop = Math.max(0, body.scrollTop + rowRect.top - top);
  } else if (rowRect.bottom > bottom) {
    body.scrollTop += rowRect.bottom - bottom;
  }
}

function scheduleReveal(body, snapshotId) {
  if (snapshotId == null) {
    pendingReveals.delete(body);
    return;
  }
  const existing = pendingReveals.get(body);
  if (existing) { existing.snapshotId = snapshotId; return; }
  const request = { snapshotId };
  pendingReveals.set(body, request);
  // Keep geometry reads out of audio dispatch; rapid cue changes coalesce.
  const schedule = globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 0));
  schedule(() => {
    if (pendingReveals.get(body) !== request) return;
    pendingReveals.delete(body);
    revealSnapshotPalette(body, request.snapshotId);
  });
}

/** Update mounted palette highlights immediately, reveal on the next frame. */
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
  scheduleReveal(body, target ? snapshotId : null);
}
