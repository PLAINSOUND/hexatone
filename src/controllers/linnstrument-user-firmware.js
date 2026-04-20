import {
  LinnStrumentLEDs,
  configureLinnStrument,
  enableLinnstrumentXData,
  enableLinnstrumentYZData,
} from "./linnstrument-config.js";

export function sendLinnstrumentNrpn245(output, value) {
  if (!output) return;
  const ch = 0xb0;
  output.send([ch, 99, 1]);
  output.send([ch, 98, 117]);
  output.send([ch, 6, 0]);
  output.send([ch, 38, value & 0x7f]);
  output.send([ch, 101, 127]);
  output.send([ch, 100, 127]);
}

export function activateLinnstrumentUserFirmware(output, keys) {
  if (!output) return false;
  sendLinnstrumentNrpn245(output, 1);
  configureLinnStrument(output);
  enableLinnstrumentYZData(output);
  enableLinnstrumentXData(output);
  const leds = keys?.linnstrumentLEDs;
  if (leds) leds.userFirmwareActive = true;
  if (keys?.settings?.linnstrument_led_sync) keys.syncLinnstrumentLEDs?.();
  return true;
}

export function deactivateLinnstrumentUserFirmware(output, keys) {
  if (output) sendLinnstrumentNrpn245(output, 0);
  const leds = keys?.linnstrumentLEDs;
  if (leds) leds.userFirmwareActive = false;
}

export function attachLinnstrumentLedDriver(output, keys) {
  if (!output) return null;
  const leds = new LinnStrumentLEDs(output);
  if (keys) keys.linnstrumentLEDs = leds;
  return leds;
}

export function detachLinnstrumentLedDriver(leds, keys) {
  if (!leds) return;
  leds.userFirmwareActive = false;
  if (keys) keys.linnstrumentLEDs = null;
  leds.exit();
}

export function isLinnstrumentUserFirmwareEligible({
  controllerId,
  scaleMode,
  midiPassthrough,
  midiinDevice,
}) {
  return (
    controllerId === "linnstrument" &&
    !scaleMode &&
    !midiPassthrough &&
    !!midiinDevice &&
    midiinDevice !== "OFF"
  );
}
