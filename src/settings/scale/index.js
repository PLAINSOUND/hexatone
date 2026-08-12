// This component renders the full Scale settings panel.
// It composes labels, colours, table editing, and Scala import/export around
// the current tuning settings, but delegates pure parsing and preview logic out
// to the tuning and scale runtime modules.

import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import PropTypes from "prop-types";
import Colors from "./colors";
import KeyLabels from "./key-labels";
import ScaleTable from "./scale-table/index.js";
import ScalaImport from "./scala-import";
import { settingsToAbletonScala, parseScalaInterval } from "./parse-scale";
import ScalaInput from "./scala-input.js";
import FundamentalTuneCell from "./fundamental-tune-cell.js";
import FrequencyInput from "./scale-table/frequency-input.js";
import { buildAutoSelectInputProps } from "../../ui/input-selection.js";
import {
  clearAllTuningPreviews,
  getEffectiveDegreeCents,
  createTuningPreviewState,
  getEffectiveFundamentalHz,
  getEffectiveFrequencyAtDegree,
  getFundamentalDeviationCents,
  isFundamentalComparing,
  setFundamentalComparing,
  setFundamentalPreview,
} from "../../tuning/tuning-preview-runtime.js";
import { createScaleWorkspace } from "../../tuning/workspace.js";

const Scale = (props) => {
  const [importing, setImporting] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => sessionStorage.getItem("hexatone_scale_collapsed") === "true",
  );
  const {
    scale: settingsScale,
    equivSteps: settingsEquivSteps,
    reference_degree: referenceDegree,
    fundamental,
  } = props.settings;
  const { onChange } = props;

  const [previewState, setPreviewState] = useState(() => createTuningPreviewState());
  const [liveScaleTableSnapshot, setLiveScaleTableSnapshot] = useState(null);
  const workspace = useMemo(
    () =>
      createScaleWorkspace({
        scale: settingsScale,
        reference_degree: referenceDegree,
        fundamental,
      }),
    [settingsScale, referenceDegree, fundamental],
  );

  useEffect(() => {
    setPreviewState((prev) => clearAllTuningPreviews(prev));
  }, [fundamental, props.importCount]);

  useEffect(() => {
    if (collapsed) {
      setLiveScaleTableSnapshot(null);
      return undefined;
    }
    const keys = props.keysRef?.current;
    if (!keys?.subscribeLiveScaleTable) {
      setLiveScaleTableSnapshot(null);
      return undefined;
    }
    return keys.subscribeLiveScaleTable(setLiveScaleTableSnapshot);
  }, [collapsed, props.keysRef, props.keysReadyRevision]);

  const doImport = (scaleImportText = null) => {
    if (typeof scaleImportText === "string" && scaleImportText !== props.settings.scale_import) {
      props.onChange("scale_import", scaleImportText);
    }
    props.onImport(scaleImportText);
    setImporting(false);
  };
  const cancelImport = () => setImporting(false);
  const startImporting = () => {
    // Generate Scala content from current scale table settings
    const scalaContent = settingsToAbletonScala(props.settings);
    props.onChange("scale_import", scalaContent);
    setImporting(true);
  };

  const handleToggle = (c) => {
    sessionStorage.setItem("hexatone_scale_collapsed", c);
    setCollapsed(c);
  };

  // Get current equave value from scale array
  const scale = settingsScale || [];
  const effectiveEquivSteps = scale.length || settingsEquivSteps || 1;
  const equaveValue = scale.length > 0 ? scale[scale.length - 1] : "2/1";
  const previewFundamental = useMemo(
    () => getEffectiveFundamentalHz({ fundamental }, previewState),
    [fundamental, previewState],
  );
  const previewDegree0Frequency = useMemo(
    () => getEffectiveFrequencyAtDegree(workspace, previewState, 0),
    [workspace, previewState],
  );
  const handleFundamentalPreviewChange = useCallback((deltaCents, comparing = false) => {
    setPreviewState((prev) =>
      setFundamentalComparing(setFundamentalPreview(prev, deltaCents), comparing),
    );
  }, []);
  const handleDegree0FrequencyCommit = useCallback(
    (degree0Frequency) => {
      const referenceCents = getEffectiveDegreeCents(workspace, previewState, referenceDegree);
      const nextFundamental = degree0Frequency * Math.pow(2, referenceCents / 1200);
      setPreviewState((prev) => clearAllTuningPreviews(prev));
      onChange("fundamental", nextFundamental);
    },
    [workspace, previewState, referenceDegree, onChange],
  );

  // Handle equave change - update the last element of scale array
  const handleEquaveChange = (str) => {
    const next = [...scale];
    if (next.length > 0) {
      next[next.length - 1] = str;
      props.onChange("scale", next);
    }
  };

  return (
    <fieldset>
      <legend>
        <b>Scale Settings</b>
        <button
          type="button"
          class="section-collapse-toggle"
          onClick={() => handleToggle(!collapsed)}
          title={collapsed ? "Toggle to show scale table" : "Toggle to hide scale table"}
        >
          <span
            class={`disclosure-toggle-glyph disclosure-toggle-glyph--${collapsed ? "collapsed" : "expanded"}`}
            aria-hidden="true"
          />
        </button>
      </legend>
      <label>
        Reference Frequency (Hz)
        <span class="fundamental-right">
          <FrequencyInput
            ariaLabel="reference frequency"
            value={previewFundamental}
            deviationCents={getFundamentalDeviationCents(previewState)}
            comparing={isFundamentalComparing(previewState)}
            onCommit={(frequency) => {
              setPreviewState((prev) => clearAllTuningPreviews(prev));
              props.onChange("fundamental", frequency);
            }}
          />
          <FundamentalTuneCell
            key={`fundamental-tune-${props.importCount ?? 0}-${props.settings.fundamental}`}
            fundamental={props.settings.fundamental}
            previewState={previewState}
            keysRef={props.keysRef}
            onChange={props.onChange}
            onPreviewChange={handleFundamentalPreviewChange}
            resetToken={props.importCount ?? 0}
          />
        </span>
      </label>
      <label class="reference-degree-row reference-degree-label">
        Assigned Scale Degree
        <input
          name="reference_degree"
          type="text"
          inputMode="numeric"
          class="sidebar-input"
          key={props.settings.reference_degree}
          defaultValue={props.settings.reference_degree}
          step="1"
          min="0"
          max={effectiveEquivSteps - 1}
          {...buildAutoSelectInputProps()}
          onBlur={(e) => {
            const val = parseInt(e.target.value);
            const max = effectiveEquivSteps - 1;
            if (!isNaN(val) && val >= 0 && val <= max) {
              props.onChange("reference_degree", val);
            } else {
              e.target.value = props.settings.reference_degree;
            }
          }}
        />
      </label>
      <label>
        Frequency of 1/1 (scale degree 0)
        <span class="fundamental-right">
          <FrequencyInput
            ariaLabel="degree 0 frequency"
            value={previewDegree0Frequency}
            onCommit={handleDegree0FrequencyCommit}
          />
        </span>
      </label>
      <label>
        Scale Size
        <input
          name="equivSteps"
          type="text"
          inputMode="numeric"
          class="sidebar-input"
          value={effectiveEquivSteps}
          step="1"
          min="1"
          max="2048"
          {...buildAutoSelectInputProps()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val) && val >= 1 && val <= 2048) {
              props.onChange("equivSteps", val);
            }
          }}
        />
      </label>
      <label>
        Equave
        <ScalaInput
          context="interval"
          commitNegative
          value={equaveValue}
          onChange={handleEquaveChange}
          showCanonicalOnCommit
          inputClass="settings-form__scala-input settings-form__scala-input--right"
          wrapperClass="sidebar-input"
          aria-label="equave"
        />
      </label>
      {effectiveEquivSteps > 1 && (
        <div class="divide-btns">
          <button
            type="button"
            class="preset-action-btn"
            onClick={() => {
              const n = effectiveEquivSteps;
              const equaveStr =
                props.settings.scale && props.settings.scale[n - 1]
                  ? props.settings.scale[n - 1]
                  : "2/1";

              const { cents: parsed, valid } = parseScalaInterval(equaveStr, "interval");
              const equaveCents = valid ? parsed : n * 100;

              const step = equaveCents / n;
              const newScale = [];
              for (let i = 1; i <= n; i++) {
                newScale.push(String((i * step).toFixed(1)));
              }
              props.onChange("scale_divide", newScale);
            }}
          >
            Divide Equave into {effectiveEquivSteps} Equal Divisions
          </button>
          <button
            type="button"
            class="preset-action-btn"
            onClick={() => {
              const n = effectiveEquivSteps;
              const step = 1200 / n;
              const newScale = [];
              for (let i = 1; i <= n; i++) {
                newScale.push(String((i * step).toFixed(1)));
              }
              props.onChange("scale_divide", newScale);
            }}
          >
            Divide Octave into {effectiveEquivSteps} Equal Divisions
          </button>
        </div>
      )}
      <label>
        Modulation Style
        <select
          class="sidebar-input"
          value={props.settings.modulation_style ?? "fixed_do"}
          onChange={(e) => props.onChange("modulation_style", e.target.value)}
        >
          <option value="moveable_do">Moveable Do / Fixed Layout</option>
          <option value="fixed_do">Fixed Do / Moveable Layout</option>
        </select>
      </label>
      <Colors {...props} rawSettings={props.rawSettings ?? props.settings} />
      <KeyLabels {...props} />
      {!collapsed && (
        <>
          <br />
          <ScaleTable
            key={props.settings.scale?.length}
            {...props}
            previewState={previewState}
            onPreviewChange={setPreviewState}
            importCount={props.importCount}
            liveScaleTableSnapshot={liveScaleTableSnapshot}
            liveScaleTableActivityOnly
          />
          <br />
        </>
      )}
      {importing ? (
        <div>
          <ScalaImport {...props} onImport={doImport} onCancel={cancelImport} />
        </div>
      ) : (
        <>
          <div class="settings-form__action-group settings-form__section-top">
            <button
              type="button"
              class="preset-action-btn"
              onClick={() => props.onChange("equivSteps", effectiveEquivSteps + 1)}
            >
              Add Scale Degree
            </button>
            <button type="button" class="preset-action-btn" onClick={startImporting}>
              Edit Scala File
            </button>
          </div>
        </>
      )}
      {!props.primaryTuningSaveVisible &&
        props.tuningSaveActionState?.visible &&
        typeof props.tuningSaveActionState.action === "function" && (
          <div class="settings-form__action-row scale-fieldset__save-row">
            <span class="settings-form__action-group settings-form__action-group--wrap">
              <button
                type="button"
                class="preset-action-btn"
                onClick={props.tuningSaveActionState.action}
              >
                {props.tuningSaveActionState.label}
              </button>
            </span>
          </div>
        )}
    </fieldset>
  );
};

Scale.propTypes = {
  onImport: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func,
  rawSettings: PropTypes.object,
  importCount: PropTypes.number,
  keysRef: PropTypes.object,
  keysReadyRevision: PropTypes.number,
  modulation_transposition_cents: PropTypes.number,
  modulation_display_active: PropTypes.bool,
  tuningSaveActionState: PropTypes.shape({
    visible: PropTypes.bool,
    label: PropTypes.string,
    action: PropTypes.func,
  }),
  primaryTuningSaveVisible: PropTypes.bool,
};

export default Scale;
