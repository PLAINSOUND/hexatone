import { useState, useEffect } from "preact/hooks";
import PropTypes from "prop-types";
import Colors from "./colors";
import KeyLabels from "./key-labels";
import ScaleTable from "./scale-table/index.js";
import ScalaImport from "./scala-import";
import { settingsToHexatonScala, parseScalaInterval } from "./parse-scale";
import ScalaInput from "./scala-input.js";
import FundamentalTuneCell from "./fundamental-tune-cell.js";

const Scale = (props) => {
  const [importing, setImporting] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => sessionStorage.getItem("hexatone_scale_collapsed") === "true",
  );

  // Local state for Reference Frequency input - syncs with props when changed from outside (TuneCell)
  const [fundamentalDisplay, setFundamentalDisplay] = useState(
    String(props.settings.fundamental ?? ""),
  );

  // Sync display when props change from outside (e.g., TuneCell retuning recalculates fundamental)
  useEffect(() => {
    setFundamentalDisplay(String(props.settings.fundamental ?? ""));
  }, [props.settings.fundamental]);

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
  const equaveValue = scale.length > 0 ? scale[scale.length - 1] : "2/1";

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
          onClick={() => handleToggle(!collapsed)}
          title={collapsed ? "Toggle to show scale table" : "Toggle to hide scale table"}
          style={{
            marginLeft: "0.6em",
            padding: "0 0.4em",
            fontSize: "0.95em",
            lineHeight: "1.2",
            verticalAlign: "middle",
            cursor: "pointer",
          }}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </legend>
      <label>
        Reference Frequency (Hz)
        <span class="fundamental-right">
          <input
            name="fundamental"
            type="text"
            inputMode="decimal"
            value={fundamentalDisplay}
            onInput={(e) => setFundamentalDisplay(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
            }}
            onBlur={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 0.015625 && val <= 16384) {
                props.onChange("fundamental", val);
              } else {
                setFundamentalDisplay(String(props.settings.fundamental ?? ""));
              }
            }}
          />
          <FundamentalTuneCell
            fundamental={props.settings.fundamental}
            keysRef={props.keysRef}
            onChange={props.onChange}
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
          max={props.settings.equivSteps - 1}
          onBlur={(e) => {
            const val = parseInt(e.target.value);
            const max = props.settings.equivSteps - 1;
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
          value={props.settings.equivSteps}
          step="1"
          min="1"
          max="2048"
          onChange={(e) => {
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
            const n = props.settings.equivSteps || 12;
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
          Divide Equave into {props.settings.equivSteps} Equal Divisions
        </button>
        <button
          type="button"
          class="preset-action-btn"
          onClick={() => {
            const n = props.settings.equivSteps || 12;
            const step = 1200 / n;
            const newScale = [];
            for (let i = 1; i <= n; i++) {
              newScale.push(String((i * step).toFixed(1)));
            }
            props.onChange("scale_divide", newScale);
          }}
        >
          Divide Octave into {props.settings.equivSteps} Equal Divisions
        </button>
      </div>
      <Colors {...props} />
      <KeyLabels {...props} />
      {!collapsed && (
        <>
          <br />
          <ScaleTable
            key={props.settings.scale?.length}
            {...props}
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
};

export default Scale;
