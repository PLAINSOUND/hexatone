import { h, createRef } from 'preact';
import PropTypes from 'prop-types';
import {
  settingsToPlainScala,
  settingsToAbletonScala,
  settingsToHexatonScala,
  settingsToKbm,
  settingsToPresetJson,
} from './parse-scale';

// Trigger a file download in the browser
const downloadFile = (content, filename, mimeType = 'text/plain') => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const safeName = (settings) =>
  (settings.name || 'custom').replace(/[^a-zA-Z0-9_\-]/g, '_');

const ScalaImport = (props) => {
  const fileInputRef = createRef();

  const handleFileOpen = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      props.onChange('scale_import', ev.target.result);
    };
    reader.readAsText(file);
    // Reset so the same file can be re-opened if needed
    e.target.value = '';
  };

  const name = safeName(props.settings);

  return (
    <>
      {/* ── Import section ─────────────────────────────────────────────── */}
      <fieldset>
        <legend><b>Import Scala File</b></legend>
        <p>
          copy/paste or type below using the Scala file format:&nbsp;
          <a href="http://www.huygens-fokker.org/scala/scl_format.html">[Scala format]</a>&nbsp;
          <a href="https://scaleworkshop.plainsound.org">[Scale Workshop]</a>
        </p>
        <p>
          <b>Name</b> <em>(optional):</em> "!" followed by scala file name, e.g. "! myScale.scl"<br />
          "<b>!</b>" <em>(optional):</em> precedes a comment or empty line<br />
          <b>Description</b>: some text about the scale<br />
          <b>Size</b>: the number of scale degrees<br />
          <b>Scale</b>: a list of ratios (b/a) or cents (numbers with a decimal point)<br /><br />
          <em>Note: Degree 0 (1/1 or 0.0 cents) is set automatically from the Reference Frequency;
          the scale starts with Degree 1 and ends with the interval of repetition (usually 2/1 or
          1200.0 cents). For convenience, scale degrees may be placed in any order; each degree may
          also be followed by a label (text) and a color (#xxxxxx). To copy/paste HEJI accidentals
          refer to: <a href="https://w3c.github.io/smufl/latest/tables/extended-helmholtz-ellis-accidentals-just-intonation.html">w3c.github.io/smufl</a>.</em>
        </p>
        <label>
          <textarea name="scale_import"
                    onChange={(e) => props.onChange(e.target.name, e.target.value)}
                    value={props.settings.scale_import}
          />
        </label>
        <br />
        {/* Hidden file input — triggered by the Open button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".scl,.ascl"
          style={{ display: 'none' }}
          onChange={handleFileOpen}
        />
        <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
          Open .scl / .ascl file
        </button>
        &nbsp;&nbsp;
        <button type="button" onClick={props.onImport}>Build Layout</button>
        &nbsp;&nbsp;
        <button type="button" onClick={props.onCancel}>Hide</button>
      </fieldset>

      {/* ── Export section ─────────────────────────────────────────────── */}
      <fieldset>
        <legend><b>Export Scala File</b></legend>

        <p><b>Plain Scala</b> — standard .scl format, compatible with all Scala-aware software</p>
        <button type="button"
          onClick={() => downloadFile(settingsToPlainScala(props.settings), `${name}.scl`)}>
          Save .scl file
        </button>
        &nbsp;&nbsp;
        <button type="button"
          onClick={() => downloadFile(settingsToKbm(props.settings), `${name}.kbm`)}>
          Save .kbm file
        </button>

        <p><b>Ableton Scala</b> — .ascl format with Ableton reference pitch metadata</p>
        <button type="button"
          onClick={() => downloadFile(settingsToAbletonScala(props.settings), `${name}.ascl`)}>
          Save .ascl file
        </button>

        <p><b>Ableton / Hexatone Scala</b> — .ascl format with full round-trip metadata
          (note names, colors, reference pitch) for re-import into Hexatone</p>
        <button type="button"
          onClick={() => downloadFile(settingsToHexatonScala(props.settings), `${name}.ascl`)}>
          Save .ascl file
        </button>

        <p><b>Preset JSON</b> — export current settings as a JSON object ready to paste
          into <em>preset_values.js</em> as a new built-in preset</p>
        <button type="button"
          onClick={() => downloadFile(settingsToPresetJson(props.settings), `${name}.json`, 'application/json')}>
          Save preset .json
        </button>
      </fieldset>
    </>
  );
};

ScalaImport.propTypes = {
  onChange: PropTypes.func.isRequired,
  onImport: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  settings: PropTypes.object.isRequired,
};

export default ScalaImport;