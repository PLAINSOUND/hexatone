/**
 * Raw MIDI helpers for Registered Parameter Number configuration.
 *
 * Channel arguments are zero-based because these functions construct status
 * bytes directly. UI-facing callers convert their one-based channels here.
 */
export function sendRpn(output, channel0, msb, lsb, dataMsb, dataLsb = 0) {
  if (!output || typeof output.send !== "function") return;
  output.send([0xb0 + channel0, 101, msb & 0x7f]);
  output.send([0xb0 + channel0, 100, lsb & 0x7f]);
  output.send([0xb0 + channel0, 6, dataMsb & 0x7f]);
  output.send([0xb0 + channel0, 38, dataLsb & 0x7f]);
  // Null RPN selection so later Data Entry messages cannot accidentally edit
  // the parameter most recently configured here.
  output.send([0xb0 + channel0, 101, 127]);
  output.send([0xb0 + channel0, 100, 127]);
}

/** Configure an MPE zone and the pitch-bend range of each member channel. */
export function sendMpeZonePitchBendRange(
  output,
  { managerChannel0 = -1, memberChannels0 = [], memberBendRange = 48, managerBendRange = 2 } = {},
) {
  if (!output || typeof output.send !== "function") return;
  const validMemberChannels0 = memberChannels0.filter(
    (channel0) => channel0 >= 0 && channel0 <= 15,
  );
  if (managerChannel0 >= 0 && managerChannel0 <= 15) {
    sendRpn(output, managerChannel0, 0, 6, validMemberChannels0.length, 0);
    sendRpn(output, managerChannel0, 0, 0, managerBendRange, 0);
  }
  for (const channel0 of validMemberChannels0) {
    sendRpn(output, channel0, 0, 0, memberBendRange, 0);
  }
}
