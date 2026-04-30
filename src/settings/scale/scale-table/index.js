import { useState, useCallback, useEffect, useMemo } from "preact/hooks";
import PropTypes from "prop-types";
import { scalaToCents } from "../parse-scale";
import ScalaInput from "../scala-input.js";
import { createScaleWorkspace } from "../../../tuning/workspace.js";
import { scorePrimeConsistency } from "../../../tuning/rationalise.js";
import ColorCell from "./color-cell.js";
import FrequencyInput from "./frequency-input.js";
import TuneCell from "./tune-cell.js";
import {
  PRIME_BOUND_KEYS,
  PRIME_BOUND_KEYS_LOW,
  PRIME_BOUND_KEYS_HIGH,
  DEFAULT_PRIME_BOUNDS,
  DEFAULT_SEARCH_PREFS,
  parseOptionalPositiveInt,
} from "./search-prefs.js";
import {
  buildBatchRationalisationReferenceMonzos,
  getRowRuntime,
  getRationalisationRequest,
  getHumanTestableRationalCandidates,
} from "./rationalise.js";

// ScaleTable is the UI workspace for rationalisation. It derives committed row
// state from ScaleWorkspace, lets TuneCell create transient previews, then
// commits chosen ratio/cents strings back into settings.scale.

// sidebar display of the scala file, degrees, note names, colors in an html table format
const ScaleTable = (props) => {
  const modulationTranspositionCents = Number(props.modulation_transposition_cents ?? 0);
  const modulationDisplayActive = !!props.modulation_display_active;
  const { scale, equiv_interval } = useMemo(() => {
    const s = [...(props.settings.scale || [])];
    const eq = s.length ? s.pop() : "2/1";
    s.unshift("0.");
    return { scale: s, equiv_interval: eq };
  }, [props.settings.scale]);
  const workspace = useMemo(
    () => createScaleWorkspace(props.settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- props.settings is a new object on every render; listing the specific keys that affect workspace output avoids unnecessary recomputation
    [props.settings.scale, props.settings.reference_degree, props.settings.fundamental],
  );

  const degrees = [...Array(scale.length).keys()];
  const note_names = props.settings.note_names || [];
  const isHeji = props.settings.key_labels === "heji";
  const heji_names = props.heji_names_table || props.heji_names || [];

  let colors;
  if (props.settings.spectrum_colors) {
    colors = Array(scale.length).fill(props.settings.fundamental_color);
  } else {
    colors = props.settings.note_colors || [];
  }

  const rows = scale.map((x, i) => [x, degrees[i], note_names[i] || "", colors[i] || "#ffffff"]);
  const referenceDegree = props.settings.reference_degree || 0;

  const scaleChangeAt = (i, str) => {
    const next = [...(props.settings.scale || [])];
    next[i] = str;
    props.onChange("scale", next);
  };
  // Called only on blur-commit (not on every keystroke) so TuneCell can reset.
  // degree index here is the TuneCell degree (i+1 for scale rows, scale.length for equave).
  const scaleCommitAt = (i, str, tuneCellDegree) => {
    scaleChangeAt(i, str);
    bumpResetVersion(tuneCellDegree);
  };

  const colorChange = (e) => {
    const next = [...(props.settings.note_colors || [])];
    next[parseInt(e.target.name.replace(/color/, ""))] = e.target.value;
    props.onChange("note_colors", next);
  };

  const nameChange = (e) => {
    const next = [...(props.settings.note_names || [])];
    next[parseInt(e.target.name.replace(/name/, ""))] = e.target.value;
    props.onChange("note_names", next);
  };

  const editable_colors = props.settings.spectrum_colors;
  const [showSearchPrefs, setShowSearchPrefs] = useState(
    () => sessionStorage.getItem("hexatone_search_prefs_open") === "true",
  );
  const [searchPrefs, setSearchPrefs] = useState(() => {
    try {
      const raw = localStorage.getItem("hexatone_search_prefs");
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults so new keys added in future versions are present
        return {
          ...DEFAULT_SEARCH_PREFS,
          ...parsed,
          primeBounds: { ...DEFAULT_SEARCH_PREFS.primeBounds, ...(parsed.primeBounds ?? {}) },
          primeBoundsUt: { ...DEFAULT_SEARCH_PREFS.primeBoundsUt, ...(parsed.primeBoundsUt ?? {}) },
        };
      }
    } catch {
      // ignore corrupt storage
    }
    return DEFAULT_SEARCH_PREFS;
  });
  const [rationalisingScale, setRationalisingScale] = useState(false);

  // Persist search panel open/close state and prefs across page reloads.
  useEffect(() => {
    sessionStorage.setItem("hexatone_search_prefs_open", String(showSearchPrefs));
  }, [showSearchPrefs]);
  useEffect(() => {
    localStorage.setItem("hexatone_search_prefs", JSON.stringify(searchPrefs));
  }, [searchPrefs]);
  // previewState: per-degree { cents, comparing } set by TuneCell during drag
  const [previewState, setPreviewState] = useState({});
  // resetVersion: per-degree counter, bumped when a direct text edit commits a new
  // scale value so TuneCell can discard its in-flight drag state.
  const [resetVersion, setResetVersion] = useState({});
  const bumpResetVersion = useCallback((degreeIndex) => {
    setResetVersion((prev) => ({ ...prev, [degreeIndex]: (prev[degreeIndex] ?? 0) + 1 }));
  }, []);

  const rowRuntimeByDegree = useMemo(
    () => new Map(workspace.slots.map((slot) => [slot.degree, getRowRuntime(workspace, slot.degree)])),
    [workspace],
  );
  const getRowRuntimeAtDegree = useCallback((degreeIndex) => {
    if (degreeIndex === scale.length) {
      return {
        committedInterval: workspace.baseScale.equaveInterval,
        committedCents: workspace.baseScale.equaveCents,
      };
    }
    return rowRuntimeByDegree.get(degreeIndex) ?? getRowRuntime(workspace, degreeIndex);
  }, [rowRuntimeByDegree, scale.length, workspace]);

  const getCommittedCentsAtDegree = useCallback((degreeIndex) => {
    return getRowRuntimeAtDegree(degreeIndex).committedCents;
  }, [getRowRuntimeAtDegree]);

  const effectiveCentsAtDegree = useCallback((degreeIndex) => {
    const state = previewState[degreeIndex];
    if (state && state.cents !== null) return state.cents;
    return getCommittedCentsAtDegree(degreeIndex);
  }, [previewState, getCommittedCentsAtDegree]);
  const referenceCents = effectiveCentsAtDegree(referenceDegree);
  const liveFundamental = props.settings.fundamental * Math.pow(2, modulationTranspositionCents / 1200.0);
  const frequencyAtDegree = useCallback((degreeIndex) => {
    const cents = effectiveCentsAtDegree(degreeIndex);
    return liveFundamental * Math.pow(2, (cents - referenceCents) / 1200.0);
  }, [effectiveCentsAtDegree, liveFundamental, referenceCents]);

  // Auto-rationalise every non-root, non-equave degree using a two-pass approach:
  //
  // Pass 1 — independent: gather top-N candidates for every degree with no
  //   cross-degree consistency influence. The naive best (index 0) is collected
  //   to form the reference set for pass 2.
  //
  // Pass 2 — cross-consistent: for each degree, rescore its candidate list
  //   using scorePrimeConsistency against the full set of pass-1 winners
  //   (excluding that degree's own entry). The candidate with the best combined
  //   aggregate + consistency bonus wins.
  //
  // This avoids the ordering bias of the old incremental approach, where early
  // degrees had no cross-degree signal and later degrees were locked into
  // whatever earlier degrees happened to pick.
  const rationaliseScale = useCallback(() => {
    // Batch rationalisation is a scale-editing operation. It writes exact ratio
    // strings back into settings.scale; it does not affect live modulation state.
    const currentScale = [...(props.settings.scale || [])];
    const equaveIdx = currentScale.length - 1; // last entry is the equave — never touched

    // Pre-compute scaleCents once — the pitch set is static across all degrees.
    const byDegree = workspace?.lookup?.byDegree;
    const scaleCents = byDegree
      ? Array.from(byDegree.values()).filter((s) => s?.cents != null).map((s) => s.cents)
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
      if (i === equaveIdx) return null;
      if (keepExisting && isRatioStr(str)) return null; // preserve existing ratio
      const tuneCellDegree = i + 1;
      const tunedCents = getCommittedCentsAtDegree(tuneCellDegree);
      const request = getRationalisationRequest({
        degree: tuneCellDegree,
        tunedCents,
        workspace,
        settings: props.settings,
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
    let changed = false;
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
      changed = true;
      return best.ratioText;
    });

    if (changed) {
      // Switch to HEJI auto-generated labels so the rationalised note names
      // are immediately visible.  Using onAtomicChange keeps it one state update.
      props.onAtomicChange({ scale: newScale, key_labels: "heji" });
      // Bump all reset versions so every TuneCell discards in-flight drag state.
      setResetVersion((prev) => {
        const next = { ...prev };
        for (let i = 1; i <= newScale.length; i++) {
          next[i] = (prev[i] ?? 0) + 1;
        }
        return next;
      });
    }
    setRationalisingScale(false);
  }, [props, workspace, frequencyAtDegree, searchPrefs, getCommittedCentsAtDegree]);

  const centsFromFrequency = (frequency) =>
    referenceCents + 1200 * Math.log2(frequency / liveFundamental);
  // deviationCentsAtDegree: cents delta from committed value (for frequency colour)
  const deviationCentsAtDegree = (degreeIndex) => {
    const state = previewState[degreeIndex];
    if (!state || state.cents === null) return null;
    const committed = getCommittedCentsAtDegree(degreeIndex);
    return state.cents - committed;
  };
  const isComparingAtDegree = (degreeIndex) => !!previewState[degreeIndex]?.comparing;
  const updatePreviewCents = useCallback((degreeIndex, cents, comparing = false) => {
    setPreviewState((prev) => {
      const cur = prev[degreeIndex];
      if (cur && cur.cents === cents && cur.comparing === comparing) return prev;
      if (cents === null) {
        if (!cur || cur.cents === null) return prev;
        return { ...prev, [degreeIndex]: { cents: null, comparing: false } };
      }
      return { ...prev, [degreeIndex]: { cents, comparing } };
    });
  }, []);
  const commitFrequencyAtDegree = (degreeIndex, frequency) => {
    const targetCents = centsFromFrequency(frequency);

    if (degreeIndex === 0) {
      const delta = targetCents;
      const oldScale = [...(props.settings.scale || [])];
      const newScale = oldScale.map((str, idx) => {
        if (idx === oldScale.length - 1) return str;
        const cents = getCommittedCentsAtDegree(idx + 1);
        return (cents - delta).toFixed(6);
      });
      if (referenceDegree === 0) {
        props.onAtomicChange({
          scale: newScale,
          fundamental: props.settings.fundamental * Math.pow(2, delta / 1200.0),
        });
      } else {
        props.onChange("scale", newScale);
      }
      return;
    }

    if (degreeIndex === referenceDegree && props.settings.retuning_mode !== "transpose_scale") {
      props.onChange("fundamental", frequency / Math.pow(2, modulationTranspositionCents / 1200.0));
      return;
    }

    if (degreeIndex === scale.length) {
      scaleChangeAt(scale.length - 1, targetCents.toFixed(6));
      return;
    }

    scaleChangeAt(degreeIndex - 1, targetCents.toFixed(6));
  };

  return (
    <div class="scale-table-workspace">
      <div class="scale-table-toolbar">
        {!showSearchPrefs && (
          <button
            type="button"
            class="scale-table-toolbar__toggle"
            onClick={() => setShowSearchPrefs(true)}
            aria-expanded={false}
            aria-controls="scale-search-prefs"
          >
            Rationalisation Settings
          </button>
        )}
        <button
          type="button"
          class="scale-table-toolbar__rationalise"
          onClick={() => {
            setRationalisingScale(true);
            // Defer to next tick so the button can show a loading state before
            // the synchronous search blocks the main thread.
            setTimeout(rationaliseScale, 0);
          }}
          disabled={rationalisingScale}
          title="Find best rational candidate for every scale degree and commit all at once"
        >
          {rationalisingScale ? "Rationalising…" : "Rationalise Scale"}
        </button>
      </div>
      {showSearchPrefs && (
        <fieldset id="scale-search-prefs" class="settings-panel scale-search-prefs">
          <legend>Rationalisation Search</legend>
          <button
            type="button"
            title="Close"
            class="settings-panel__close"
            onClick={() => setShowSearchPrefs(false)}
          >
            ✕
          </button>
          <div class="scale-search-prefs__top-row">
            <select
              value={searchPrefs.existingRatios}
              onChange={(e) =>
                setSearchPrefs((prev) => ({ ...prev, existingRatios: e.target.value }))
              }
              aria-label="how to handle existing ratio entries"
            >
              <option value="keep">Keep all existing ratios</option>
              <option value="search">Find new ratios (re-search all)</option>
            </select>
            <button
              type="button"
              class="preset-action-btn"
              onClick={() => {
                setSearchPrefs(DEFAULT_SEARCH_PREFS);
                localStorage.removeItem("hexatone_search_prefs");
              }}
            >
              Restore Defaults
            </button>
          </div>
          <div class="scale-search-prefs__row">
            <label class="scale-search-prefs__field">
              Region
              <select
                value={searchPrefs.region}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearchPrefs((prev) => {
                    if (next === "overtonal") {
                      // Zero out all undertonal bounds
                      const utZero = Object.fromEntries(
                        Object.keys(prev.primeBoundsUt).map((k) => [k, "0"])
                      );
                      return { ...prev, region: next, primeBoundsUt: utZero };
                    }
                    if (next === "symmetric") {
                      // Mirror overtonal bounds into undertonal
                      return { ...prev, region: next, primeBoundsUt: { ...prev.primeBounds } };
                    }
                    // custom: keep existing values as-is
                    return { ...prev, region: next };
                  });
                }}
                aria-label="rationalisation region"
              >
                <option value="symmetric">Symmetric</option>
                <option value="overtonal">Overtonal</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label class="scale-search-prefs__field">
              Search (¢)
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.centsTolerance}
                onInput={(e) =>
                  setSearchPrefs((prev) => ({
                    ...prev,
                    centsTolerance: e.target.value,
                  }))
                }
                aria-label="rationalisation cents tolerance"
              />
            </label>
            <label class="scale-search-prefs__field">
              Context (¢)
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.contextTolerance}
                onInput={(e) =>
                  setSearchPrefs((prev) => ({
                    ...prev,
                    contextTolerance: e.target.value,
                  }))
                }
                aria-label="rationalisation context consonance tolerance"
              />
            </label>
            <label class="scale-search-prefs__field">
              Prime Limit
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.primeLimit}
                onInput={(e) => {
                  const raw = e.target.value;
                  const newLimit = parseOptionalPositiveInt(raw);
                  setSearchPrefs((prev) => {
                    const next = { ...prev, primeLimit: raw };
                    if (newLimit == null) return next;
                    // Sync primeBounds and primeBoundsUt with the new limit:
                    // — primes above the limit → "0"
                    // — primes newly within the limit that were "0" → default from DEFAULT_PRIME_BOUNDS
                    const prevLimit = parseOptionalPositiveInt(prev.primeLimit);
                    const ot = { ...prev.primeBounds };
                    const ut = { ...prev.primeBoundsUt };
                    for (const prime of PRIME_BOUND_KEYS) {
                      const wasActive = prevLimit == null || prime <= prevLimit;
                      const nowActive = prime <= newLimit;
                      if (!nowActive && wasActive) {
                        // Newly excluded: zero out
                        ot[prime] = "0";
                        ut[prime] = "0";
                      } else if (nowActive && !wasActive) {
                        // Newly included: use default bound, but at least "1"
                        // (DEFAULT_PRIME_BOUNDS stores "0" for primes 23+ so we
                        // clamp to "1" to ensure the prime is actually searched)
                        const def = DEFAULT_PRIME_BOUNDS[prime];
                        const restored = (!def || def === "0") ? "1" : def;
                        if (!ot[prime] || ot[prime] === "0") ot[prime] = restored;
                        if (!ut[prime] || ut[prime] === "0") ut[prime] = restored;
                      }
                    }
                    next.primeBounds = ot;
                    next.primeBoundsUt = ut;
                    return next;
                  });
                }}
                aria-label="rationalisation prime limit"
              />
            </label>
            <label class="scale-search-prefs__field">
              Odd Limit
              <input
                type="text"
                inputMode="numeric"
                value={searchPrefs.oddLimit}
                onInput={(e) =>
                  setSearchPrefs((prev) => ({
                    ...prev,
                    oddLimit: e.target.value,
                  }))
                }
                aria-label="rationalisation odd limit"
              />
            </label>
          </div>
          {/* Rows 2–3: per-prime step bounds split into 3–19 and 23+ */}
          {[PRIME_BOUND_KEYS_LOW, PRIME_BOUND_KEYS_HIGH].map((primeRow, rowIdx) => {
            const isCustom = searchPrefs.region === "custom";
            return (
              <div
                key={rowIdx}
                class={`scale-search-prefs__grid${isCustom ? " scale-search-prefs__grid--custom" : ""}`}
                aria-label={rowIdx === 0 ? "prime step bounds 3–19" : "prime step bounds 23+"}
              >
                {primeRow.map((prime) => {
                  const limit = parseOptionalPositiveInt(searchPrefs.primeLimit);
                  const aboveLimit = limit != null && prime > limit;
                  return (
                    <div
                      key={prime}
                      class={`scale-search-prefs__prime${aboveLimit ? " scale-search-prefs__prime--inactive" : ""}`}
                    >
                      <span class="scale-search-prefs__prime-label">{prime}</span>
                      {isCustom ? (
                        <div class="scale-search-prefs__prime-pair">
                          <span class="scale-search-prefs__prime-badge scale-search-prefs__prime-badge--ut">u</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={aboveLimit ? "0" : (searchPrefs.primeBoundsUt[prime] ?? "1")}
                            disabled={aboveLimit}
                            onInput={(e) =>
                              setSearchPrefs((prev) => ({
                                ...prev,
                                primeBoundsUt: { ...prev.primeBoundsUt, [prime]: e.target.value },
                              }))
                            }
                            aria-label={`prime ${prime} undertonal steps`}
                            class="scale-search-prefs__prime-input"
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            value={aboveLimit ? "0" : (searchPrefs.primeBounds[prime] ?? "1")}
                            disabled={aboveLimit}
                            onInput={(e) =>
                              setSearchPrefs((prev) => ({
                                ...prev,
                                primeBounds: { ...prev.primeBounds, [prime]: e.target.value },
                              }))
                            }
                            aria-label={`prime ${prime} overtonal steps`}
                            class="scale-search-prefs__prime-input"
                          />
                          <span class="scale-search-prefs__prime-badge scale-search-prefs__prime-badge--ot">°</span>
                        </div>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={aboveLimit ? "0" : (searchPrefs.primeBounds[prime] ?? "1")}
                          disabled={aboveLimit}
                          onInput={(e) => {
                            const val = e.target.value;
                            setSearchPrefs((prev) => {
                              const next = {
                                ...prev,
                                primeBounds: { ...prev.primeBounds, [prime]: val },
                              };
                              // In symmetric mode keep undertonal mirrored
                              if (prev.region === "symmetric") {
                                next.primeBoundsUt = { ...prev.primeBoundsUt, [prime]: val };
                              }
                              return next;
                            });
                          }}
                          aria-label={`rationalisation prime ${prime} steps`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

        </fieldset>
      )}
      <table>
        <thead>
          <tr>
            <th class="scale-data-col" id="leftaligned">
              Degree&nbsp;:&nbsp;Ratio&nbsp;|&nbsp;Cents&nbsp;|&nbsp;EDO
            </th>
            <th class="scale-frequency-col">Freq&nbsp;&nbsp;</th>
            <th class="scale-name-col">{isHeji ? "HEJI" : "Name"}</th>
            <th class="scale-color-col">Colour</th>
          </tr>
        </thead>
        <tbody>
        <tr
          key={`0-${props.importCount}`}
          class={
            [
              props.settings.reference_degree === 0 ? "reference-degree-row" : "",
              props.settings.center_degree === 0 ? "center-degree-row" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <td class="scale-data-col">
            <div class="scale-degree-cell">
              <span class="degree-gutter" aria-label="scale degree gutter 0">
                {degrees[0]}
              </span>
              <div class="freq-cell">
                <input
                  type="text"
                  disabled
                  value="1/1  |  0.0  |  0\n"
                  aria-label="pitch value root"
                />
                <TuneCell
                  key={`tune0-${props.importCount}`}
                  scaleStr="0.0"
                  degree={0}
                  committedInterval={getRowRuntimeAtDegree(0).committedInterval}
                  committedCents={getRowRuntimeAtDegree(0).committedCents}
                  workspace={workspace}
                  settings={props.settings}
                  frequencyAtDegree={frequencyAtDegree}
                  searchPrefs={searchPrefs}
                  keysRef={props.keysRef}
                  reference_degree={props.settings.reference_degree}
                  fundamental={props.settings.fundamental}
                  retuning_mode={props.settings.retuning_mode}
                  onPreviewChange={updatePreviewCents}
                  onDegree0Save={(delta) => {
                    // delta: cents degree 0 moved up.
                    // The equave is never touched — it is a period ratio, not a pitch.
                    const oldScale = [...(props.settings.scale || [])];
                    // Subtract delta from every degree except the equave so all
                    // other notes stay at the same absolute Hz.
                    const newScale = oldScale.map((str, idx) => {
                      if (idx === oldScale.length - 1) return str; // equave unchanged
                      const cents = scalaToCents(String(str));
                      return (cents - delta).toFixed(6);
                    });
                    const ref = props.settings.reference_degree;
                    if (ref === 0) {
                      // Degree 0 is the reference: fundamental shifts up by delta.
                      // Scale degrees (excl. equave) shift down by delta to keep
                      // all other notes at the same Hz.
                      const newFundamental =
                        props.settings.fundamental * Math.pow(2, delta / 1200.0);
                      props.onAtomicChange({ scale: newScale, fundamental: newFundamental });
                    } else {
                      // Another degree is the reference: fundamental stays.
                      // Subtracting delta from all non-equave scale degrees keeps
                      // every other note at the same Hz and shifts degree 0 up.
                      props.onChange("scale", newScale);
                    }
                  }}
                />
              </div>
            </div>
          </td>
          <td class="scale-frequency-col">
            <FrequencyInput
              ariaLabel="pitch frequency 0"
              value={frequencyAtDegree(0)}
              onCommit={(frequency) => commitFrequencyAtDegree(0, frequency)}
              deviationCents={deviationCentsAtDegree(0)}
              comparing={isComparingAtDegree(0)}
              liveModulated={modulationDisplayActive}
            />
          </td>
          <td class="scale-name-col">
            {isHeji ? (
              <span class={`heji-name-cell${modulationDisplayActive ? " heji-name-cell--modulated" : ""}`}>{heji_names[0] ?? ""}</span>
            ) : (
              <input
                id="centered"
                type="text"
                name="name0"
                value={note_names[0] || ""}
                onChange={nameChange}
                aria-label="pitch name 0"
              />
            )}
          </td>
          <td class="scale-color-col">
            <ColorCell
              name="color0"
              value={colors[0] || "#ffffff"}
              disabled={editable_colors}
              onChange={colorChange}
            />
          </td>
        </tr>
        {rows.slice(1).map(([freq, degree, name, color], i) => (
          <tr
            key={`${i + 1}-${props.importCount}`}
            class={
              [
                props.settings.reference_degree === i + 1 ? "reference-degree-row" : "",
                props.settings.center_degree === i + 1 ? "center-degree-row" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          >
            <td class="scale-data-col">
              <div class="scale-degree-cell">
                <span class="degree-gutter" aria-label={`scale degree gutter ${i + 1}`}>
                  {degree}
                </span>
                <div class="freq-cell">
                  <ScalaInput
                    context="degree"
                    name={`scale${i}`}
                    value={freq}
                    onAnyChange={(str) => scaleChangeAt(i, str)}
                    onChange={(str) => scaleCommitAt(i, str, i + 1)}
                    showCents={!String(freq).includes(".")}
                    aria-label={`pitch value ${i}`}
                  />
                  <TuneCell
                    key={`tune${i + 1}-${props.importCount}`}
                    scaleStr={(props.settings.scale || [])[i] || String(freq)}
                    degree={i + 1}
                    committedInterval={getRowRuntimeAtDegree(i + 1).committedInterval}
                    committedCents={getRowRuntimeAtDegree(i + 1).committedCents}
                    workspace={workspace}
                    settings={props.settings}
                    frequencyAtDegree={frequencyAtDegree}
                    searchPrefs={searchPrefs}
                    keysRef={props.keysRef}
                    reference_degree={props.settings.reference_degree}
                    fundamental={props.settings.fundamental}
                    retuning_mode={props.settings.retuning_mode}
                    onPreviewChange={updatePreviewCents}
                    resetVersion={resetVersion[i + 1] ?? 0}
                    onChange={(newStr) => {
                      const next = [...(props.settings.scale || [])];
                      next[i] = newStr;
                      props.onChange("scale", next);
                    }}
                    onFundamentalChange={(newFreq, newStr) => {
                      if (newStr !== undefined) {
                        const next = [...(props.settings.scale || [])];
                        next[i] = newStr;
                        props.onAtomicChange({ fundamental: newFreq, scale: next });
                      } else {
                        props.onChange("fundamental", newFreq);
                      }
                    }}
                  />
                </div>
              </div>
            </td>
            <td class="scale-frequency-col">
              <FrequencyInput
                ariaLabel={`pitch frequency ${i + 1}`}
                value={frequencyAtDegree(i + 1)}
                onCommit={(frequency) => commitFrequencyAtDegree(i + 1, frequency)}
                deviationCents={deviationCentsAtDegree(i + 1)}
                comparing={isComparingAtDegree(i + 1)}
                liveModulated={modulationDisplayActive}
              />
            </td>
            <td class="scale-name-col">
              {isHeji ? (
                <span class={`heji-name-cell${modulationDisplayActive ? " heji-name-cell--modulated" : ""}`}>{heji_names[i + 1] ?? ""}</span>
              ) : (
                <input
                  id="centered"
                  type="text"
                  name={`name${i + 1}`}
                  value={name}
                  onChange={nameChange}
                  aria-label={`pitch name ${i + 1}`}
                />
              )}
            </td>
            <td class="scale-color-col">
              <ColorCell
                name={`color${i + 1}`}
                value={color}
                disabled={editable_colors}
                onChange={colorChange}
              />
            </td>
          </tr>
        ))}
        <tr
          key={`equiv-${props.importCount}`}
          class={
            props.settings.reference_degree === scale.length ? "reference-degree-row" : undefined
          }
        >
          <td class="scale-data-col">
            <div class="scale-degree-cell">
              <span class="degree-gutter" aria-label="scale degree gutter equave">
                {scale.length}
              </span>
              <div class="freq-cell">
                <ScalaInput
                  context="interval"
                  name={`scale${scale.length - 1}`}
                  value={equiv_interval}
                  onAnyChange={(str) => scaleChangeAt(scale.length - 1, str)}
                  onChange={(str) => scaleCommitAt(scale.length - 1, str, scale.length)}
                  showCents={!String(equiv_interval).includes(".")}
                  aria-label={`pitch ${scale.length - 1}`}
                />
                <div class="tune-cell-spacer" aria-hidden="true" />
              </div>
            </div>
          </td>
          <td class="scale-frequency-col">
            <FrequencyInput
              ariaLabel="equave frequency"
              value={frequencyAtDegree(scale.length)}
              onCommit={(frequency) => commitFrequencyAtDegree(scale.length, frequency)}
              deviationCents={deviationCentsAtDegree(scale.length)}
              comparing={isComparingAtDegree(scale.length)}
              liveModulated={modulationDisplayActive}
            />
          </td>
          <td class="scale-name-col">
            {isHeji ? (
              <span class={`heji-name-cell${modulationDisplayActive ? " heji-name-cell--modulated" : ""}`}>{heji_names[0] ?? ""}</span>
            ) : (
              <input
                id="centered"
                type="text"
                disabled
                class="equiv-cell"
                value={note_names[0] || ""}
                aria-label="pitch name equave"
              />
            )}
          </td>
          <td class="scale-color-col">
            <span
              style={{
                fontWeight: "bold",
                display: "block",
                textAlign: "center",
                marginTop: "0.25em",
              }}
            >
              Equave
            </span>
          </td>
        </tr>
        </tbody>
      </table>
    </div>
  );
};

ScaleTable.propTypes = {
  keysRef: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func,
  importCount: PropTypes.number,
  heji_names: PropTypes.arrayOf(PropTypes.string),
  heji_names_table: PropTypes.arrayOf(PropTypes.string),
  modulation_transposition_cents: PropTypes.number,
  modulation_display_active: PropTypes.bool,
  settings: PropTypes.shape({
    scale: PropTypes.arrayOf(PropTypes.string),
    key_labels: PropTypes.string,
    spectrum_colors: PropTypes.bool,
    fundamental_color: PropTypes.string,
    note_colors: PropTypes.arrayOf(PropTypes.string),
    note_names: PropTypes.arrayOf(PropTypes.string),
    reference_degree: PropTypes.number,
    center_degree: PropTypes.number,
    fundamental: PropTypes.number,
    retuning_mode: PropTypes.string,
  }),
};

export default ScaleTable;
