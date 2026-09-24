/**
 * Single-channel last-note-priority MIDI backend composed by use-synth-wiring.
 * Owns held voice identities, carrier selection and pitch/slide/pressure output;
 * ramp.js supplies worker-ticked timestamped transitions and output transactions
 * coalesce synchronous chord changes. Raw MIDI channels here are zero-based.
 */

import { sendRpn } from "../midi/rpn.js";
import { getOutputTransaction, outputAttackGroup } from "../midi/output-transaction.js";
import { createMonoRamp } from "./ramp.js";
import { normaliseSlideCc } from "../midi/slide-cc-options.js";

const clamp7 = (v) => Math.max(0, Math.min(127, Math.round(Number(v) || 0)));

export function chooseMonoCarrier(pitches, range) {
  const active = pitches.at(-1);
  let best = null;
  for (let note = 0; note < 128; note++) {
    if (Math.abs(active - note) > range) continue;
    const covered = pitches.map((p) => Math.abs(p - note) <= range);
    const count = covered.filter(Boolean).length;
    const recency = [...covered].reverse().map(Number).join("");
    const margin =
      range - Math.max(...pitches.filter((_, i) => covered[i]).map((p) => Math.abs(p - note)));
    if (
      !best ||
      count > best.count ||
      (count === best.count &&
        (recency > best.recency || (recency === best.recency && margin > best.margin)))
    ) {
      best = { note, count, recency, margin };
    }
  }
  return best?.note ?? null;
}

export function createMonoSynth({
  output,
  channel = 0,
  bendRange = 2,
  fundamental = 440,
  referenceCents = 0,
  velocity = 72,
  portamento = false,
  time = 80,
  slideCc = 74,
  schedulerOptions,
} = {}) {
  const range = Math.max(1, Math.min(96, Math.round(Number(bendRange) || 2)));
  channel = Math.max(0, Math.min(15, Math.round(Number(channel) || 0)));
  const stack = []; // Voice identities, not coordinates: repeated pitches remain distinct.
  let active = null;
  let carrier = null;
  let stopped = false;
  let transitionEnd = 0;
  let globalTimbre = 64;
  let overlap = false;
  const now = schedulerOptions?.now ?? (() => performance.now());
  const send = (bytes, at) => output?.send(bytes, at);
  // Track the last queued value, not the wall-clock value: ramp replacement
  // already preserves timestamp ordering through ramp.boundary().
  const lastExpression = new Map();
  const sendExpression = (key, value, bytes, at) => {
    if (lastExpression.get(key) === value) return;
    send(bytes, at);
    lastExpression.set(key, value);
  };
  const ramp = createMonoRamp(
    ([bend, y, z], at) => {
      const cc = normaliseSlideCc(slideCc);
      sendExpression("bend", bend, [0xe0 + channel, bend & 127, bend >> 7], at);
      sendExpression(`cc:${cc}`, y, [0xb0 + channel, cc, y], at);
      sendExpression("pressure", z, [0xd0 + channel, z], at);
    },
    { ...schedulerOptions, now },
  );
  const pitch = (hex) =>
    69 + 12 * Math.log2(fundamental / 440) + (hex.cents - referenceCents) / 100;
  const values = (hex) => [
    Math.max(0, Math.min(16383, Math.round(8192 + ((pitch(hex) - carrier) / range) * 8192))),
    hex.y,
    hex.z,
  ];
  const update = (at = now()) => {
    if (stopped) return;
    // Latest attack group wins; within a simultaneous chord choose its highest
    // effective pitch. Keep this order for carrier selection and release fallback.
    stack.sort((a, b) => a.attackGroup - b.attackGroup || pitch(a) - pitch(b));
    at = ramp.boundary(at);
    const next = stack.at(-1) ?? null;
    if (!next) {
      ramp.cancel();
      if (carrier != null) send([0x80 + channel, carrier, 0], at);
      send([0xd0 + channel, 0], at);
      active = null;
      carrier = null;
      transitionEnd = 0;
      return;
    }
    const changed = next !== active;
    const bendable = carrier != null && Math.abs(pitch(next) - carrier) <= range;
    const legato = !!active && overlap && portamento && bendable;
    if (!bendable || (changed && !legato)) {
      const replacement = chooseMonoCarrier(stack.map(pitch), range);
      ramp.cancel();
      if (carrier != null) send([0x80 + channel, carrier, 0], at);
      carrier = replacement;
      active = next;
      transitionEnd = 0;
      if (carrier == null) return; // Outside MIDI's representable pitch range.
      lastExpression.clear(); // Establish every dimension before a fresh attack.
      ramp.move(values(next), 0, at);
      send([0x90 + channel, carrier, next.velocity], at);
    } else {
      if (changed) transitionEnd = at + Math.max(0, Number(time) || 0);
      active = next;
      ramp.move(values(next), Math.max(0, transitionEnd - at), at);
    }
  };
  const request = (at) => {
    const tx = getOutputTransaction();
    if (tx) {
      if (Number.isFinite(at)) tx.data.set(synth, Math.max(at, tx.data.get(synth) ?? 0));
      tx.finalizers.set(synth, () => update(tx.data.get(synth)));
    } else update(at);
  };
  const releaseOwned = () => {
    const tx = getOutputTransaction();
    tx?.finalizers.delete(synth);
    tx?.data.delete(synth);
    const at = ramp.boundary();
    ramp.cancel();
    stack.forEach((h) => {
      h.release = true;
    });
    stack.length = 0;
    if (carrier != null) send([0x80 + channel, carrier, 0], at);
    active = null;
    carrier = null;
    transitionEnd = 0;
    lastExpression.clear();
    return at;
  };
  const panic = () => {
    const at = releaseOwned();
    send([0xb0 + channel, 64, 0], at);
    send([0xb0 + channel, 120, 0], at);
    send([0xd0 + channel, 0], at);
  };
  sendRpn(output, channel, 0, 0, range);
  const synth = {
    family: "mono",
    setSlideCc(value) {
      slideCc = normaliseSlideCc(value);
      lastExpression.delete(`cc:${slideCc}`);
      if (active) request();
    },
    hasVoices: () => stack.length > 0,
    setPortamento(enabled, milliseconds) {
      portamento = enabled;
      time = milliseconds;
    },
    applyZoneModwheel(value) {
      globalTimbre = clamp7(value);
      stack.forEach((h) => {
        h.y = globalTimbre;
      });
      if (active) request();
    },
    makeHex(coords, cents, _steps, _equaves, _equivSteps, _prev, _next, notePlayed, attack) {
      const hex = {
        coords,
        cents,
        note_played: notePlayed,
        velocity: Math.max(1, clamp7(attack ?? velocity)),
        velocity_played: Math.max(1, clamp7(attack ?? velocity)),
        release: false,
        y: globalTimbre,
        z: 0,
        noteOn(at) {
          if (stopped) return;
          hex.release = false;
          hex.attackGroup = hex._attackGroup ?? outputAttackGroup();
          overlap = stack.length > 0;
          const index = stack.indexOf(hex);
          if (index >= 0) stack.splice(index, 1);
          stack.push(hex);
          request(at);
        },
        noteOff(_velocity, at) {
          hex.release = true;
          const index = stack.indexOf(hex);
          if (index >= 0) stack.splice(index, 1);
          if (hex === active) overlap = stack.length > 0;
          if (hex === active || getOutputTransaction()) request(at);
        },
        retune(value) {
          hex.cents = value;
          if (!hex.release && stack.includes(hex)) request();
        },
        sequenceRetune(value) {
          hex.retune(value);
        },
        aftertouch(value) {
          if (hex.release) return;
          hex.z = clamp7(value);
          if (hex === stack.at(-1)) request();
        },
        pressure(value) {
          hex.aftertouch(value);
        },
        applySnapshotPressure(value) {
          hex.aftertouch(value);
        },
        cc74(value) {
          if (hex.release) return;
          hex.y = clamp7(value);
          if (hex === stack.at(-1)) request();
        },
        polyTimbre(value) {
          hex.cc74(value);
        },
        modwheel(value) {
          hex.cc74(value);
        },
        expression(value) {
          if (hex === active) {
            const amount = clamp7(value);
            sendExpression("cc:11", amount, [0xb0 + channel, 11, amount], ramp.boundary());
          }
        },
      };
      return hex;
    },
    allSoundOff: panic,
    releaseAll: releaseOwned,
    shutdown() {
      // Normal replacement must not reset another sender's shared channel.
      releaseOwned();
      stopped = true;
      ramp.dispose();
    },
  };
  return synth;
}
