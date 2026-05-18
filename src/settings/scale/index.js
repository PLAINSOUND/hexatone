import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import PropTypes from "prop-types";
import Colors from "./colors";
import KeyLabels from "./key-labels";
import ScaleTable from "./scale-table/index.js";
import ScalaImport from "./scala-import";
import { settingsToHexatonScala, parseScalaInterval } from "./parse-scale";
import ScalaInput from "./scala-input.js";
import FundamentalTuneCell from "./fundamental-tune-cell.js";
import FrequencyInput from "./scale-table/frequency-input.js";
import {
  clearAllTuningPreviews,
  createTuningPreviewState,
  getEffectiveFundamentalHz,
  getFundamentalDeviationCents,
  isFundamentalComparing,
  setFundamentalComparing,
  setFundamentalPreview,
} from "../../tuning/tuning-preview-runtime.js";

const Scale = (props) => {
  const [importing, setImporting] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => sessionStorage.getItem("hexatone_scale_collapsed") === "true",
  );

  const [previewState, setPreviewState] = useState(() => createTuningPreviewState());

  useEffect(() => {
    setPreviewState((prev) => clearAllTuningPreviews(prev));
  }, [props.settings.fundamental, props.importCount]);

  const doImport = () => {
    props.onImport();
    setImporting(false);
  };
  const cancelImport = () => setImporting(false);
  const startImporting = () => {
    // Generate Scala content from current scale table settings
    const scalaContent = settingsToHexatonScala(props.settings);
    props.onChange("scale_import", scalaContent);
    setImporting(true);
  };

  const handleToggle = (c) => {
    sessionStorage.setItem("hexatone_scale_collapsed", c);
    setCollapsed(c);
  };

  // Get current equave value from scale array
  const scale = props.settings.scale || [];
  const effectiveEquivSteps = scale.length || props.settings.equivSteps || 1;
  const equaveValue = scale.length > 0 ? scale[scale.length - 1] : "2/1";
  const previewFundamental = useMemo(
    () => getEffectiveFundamentalHz(props.settings, previewState),
    [props.settings, previewState],
  );
  const handleFundamentalPreviewChange = useCallback((deltaCents, comparing = false) => {
    setPreviewState((prev) =>
      setFundamentalComparing(setFundamentalPreview(prev, deltaCents), comparing),
    );
  }, []);

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
          style={{
            cursor: "pointer",
          }}
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
          value={equaveValue}
          onChange={handleEquaveChange}
          style={{
            width: "4em",
            textAlign: "center",
            height: "1.5em",
            boxSizing: "border-box",
            background: "#faf9f8",
            borderRadius: "3px",
          }}
          wrapperClass="sidebar-input"
        />
      </label>
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
      <Colors {...props} />
      <KeyLabels {...props} />
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
      {!collapsed && (
        <>
          <br />
          <ScaleTable
            key={props.settings.scale?.length}
            {...props}
            previewState={previewState}
            onPreviewChange={setPreviewState}
            importCount={props.importCount}
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
          <button
            type="button"
            class="preset-action-btn"
            onClick={startImporting}
            style={{ marginTop: "0.5rem" }}
          >
            Edit Scala File
          </button>
        </>
      )}
    </fieldset>
  );
};

Scale.propTypes = {
  onImport: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  onAtomicChange: PropTypes.func,
  importCount: PropTypes.number,
  modulation_transposition_cents: PropTypes.number,
  modulation_display_active: PropTypes.bool,
};

export default Scale;
