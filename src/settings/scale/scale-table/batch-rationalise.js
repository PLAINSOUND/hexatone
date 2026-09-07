import { createScaleWorkspace } from "../../../tuning/workspace.js";
import { scorePrimeConsistency } from "../../../tuning/rationalise.js";
import {
  buildBatchRationalisationReferenceMonzos,
  getRationalisationRequest,
  getHumanTestableRationalCandidates,
} from "./rationalise.js";

export function rationaliseScaleBatch(
  { settings, searchPrefs, frequencies, committedCents },
  onProgress = () => {},
) {
  const workspace = createScaleWorkspace(settings);
  const frequencyAtDegree = (degree) => frequencies[degree];
  const getCommittedCentsAtDegree = (degree) => committedCents[degree];
  // Batch rationalisation is a scale-editing operation. It writes exact ratio
  // strings back into settings.scale; it does not affect live modulation state.
  const currentScale = [...(settings.scale || [])];
  const equaveIdx = currentScale.length - 1; // last entry is the equave — never touched

  // Pre-compute scaleCents once — the pitch set is static across all degrees.
  const byDegree = workspace?.lookup?.byDegree;
  const scaleCents = byDegree
    ? Array.from(byDegree.values())
        .filter((s) => s?.cents != null)
        .map((s) => s.cents)
    : null;

  // When existingRatios === "keep", degrees that already contain a ratio
  // string (e.g. "3/2", "5/4") are left untouched — only cents-valued
  // degrees are rationalised. When "search", all non-equave degrees are
  // rationalised regardless of their current form.
  const keepExisting = searchPrefs.existingRatios !== "search";
  const isRatioStr = (s) => /\//.test(String(s));

  // Seed reference monzos from whatever is already hand-committed in the
  // workspace — but only in keep-existing mode, where those committed ratios
  // are intentional anchors rather than stale bias.
  const preCommittedMonzos = [];
  if (keepExisting && byDegree) {
    for (const slot of byDegree.values()) {
      if (Array.isArray(slot?.committedIdentity?.monzo)) {
        preCommittedMonzos.push(slot.committedIdentity.monzo);
      }
    }
  }

  // ── Pass 1: independent candidate search for every degree ──────────────
  // No cross-degree consistency scoring — each degree is evaluated on its
  // own merits. We keep the full candidate list per degree for pass 2.
  const perDegree = currentScale.map((str, i) => {
    onProgress(Math.round((i / Math.max(1, currentScale.length)) * 90));
    if (i === equaveIdx) return null;
    if (keepExisting && isRatioStr(str)) return null; // preserve existing ratio
    const tuneCellDegree = i + 1;
    const tunedCents = getCommittedCentsAtDegree(tuneCellDegree);
    const request = getRationalisationRequest({
      degree: tuneCellDegree,
      tunedCents,
      workspace,
      settings: settings,
      frequencyAtDegree,
      searchPrefs,
    });
    request._scaleCents = scaleCents;
    request._committedMonzos = []; // no cross-degree signal in pass 1
    // When re-searching all degrees, don't let the existing committed ratio
    // anchor the candidate set — search finds the best within-limit candidate.
    if (!keepExisting) request.skipCommitted = true;
    const candidates = getHumanTestableRationalCandidates(request);
    return { str, candidates };
  });

  // Collect the naive-best monzo from each degree to form the pass-2 reference.
  const pass1Monzos = perDegree.map((entry) => {
    if (!entry) return null;
    const best = entry.candidates[0];
    return Array.isArray(best?.monzo) ? best.monzo : null;
  });

  // ── Pass 2: cross-consistent re-ranking ────────────────────────────────
  // Each degree is rescored using the full pass-1 winner set (minus itself)
  // as the committed-monzo reference. scorePrimeConsistency produces a graded
  // bonus [0,2] that is added to aggregateScore to break ties in favour of
  // harmonically adjacent choices.
  const CONSISTENCY_BONUS_WEIGHT = 0.8; // matches weightConsistency in rationalise.js
  const newScale = currentScale.map((str, i) => {
    if (i === equaveIdx) return str;
    const entry = perDegree[i];
    if (!entry || !entry.candidates.length) return str;

    // Reference = pre-committed anchors + pass-1 winners from all OTHER degrees.
    const refMonzos = buildBatchRationalisationReferenceMonzos({
      keepExisting,
      preCommittedMonzos,
      pass1Monzos,
      degreeIndex: i,
    });

    // Re-rank by (aggregateScore - consistency_bonus) — lower aggregateScore
    // is better, so a positive consistency bonus lowers the effective cost.
    const ranked = entry.candidates
      .filter((c) => c.ratioText)
      .map((c) => {
        const consistency = scorePrimeConsistency(c, refMonzos);
        const effectiveCost = c.aggregateScore - CONSISTENCY_BONUS_WEIGHT * consistency;
        return { c, effectiveCost };
      })
      .sort((a, b) => a.effectiveCost - b.effectiveCost);

    if (!ranked.length) return str;
    const best = ranked[0].c;
    if (best.ratioText === str) return str;
    return best.ratioText;
  });

  onProgress(100);
  return newScale;
}
