import { h } from 'preact';

import Presets from './presets';
import CustomPresets from './custom-presets';
import Info from './info';
import Scale from './scale';
import Layout from './layout';
import SampleSynth from './sample';
import MIDIio from './midi';

import './settings.css';

const Settings = ({ presetChanged, presets, settings, onChange, onImport, onLoadCustomPreset, midi, instruments }) => (
  <form>
    <fieldset>
      <legend><b>Built-in Tunings</b></legend>
      <label>
        <Presets onChange={presetChanged} presets={presets} />
      </label>
    </fieldset>
    <CustomPresets settings={settings} onLoad={onLoadCustomPreset} />
    <Info onChange={onChange} settings={settings} />
    <Scale onChange={onChange} settings={settings} onImport={onImport} />
    <Layout onChange={onChange} settings={settings} />
    <SampleSynth onChange={onChange} settings={settings} instruments={instruments} />
    <MIDIio onChange={onChange} settings={settings} midi={midi} />
  </form>
);

export default Settings;
