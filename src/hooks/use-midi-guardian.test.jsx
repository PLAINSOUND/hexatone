// Exercises the mounted safety backstop without constructing a Keys canvas.
import { render, cleanup } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMidiGuardian } from "./use-midi-guardian.js";
import { midiOutputTargets } from "../midi/output-targets.js";

afterEach(cleanup);

describe("MIDI guardian", () => {
  it("deduplicates pairs, not ports, across enabled output families", () => {
    expect(
      midiOutputTargets({
        output_mts: true,
        midi_device: "shared",
        midi_channel: 0,
        fluidsynth_device: "shared",
        fluidsynth_channel: 1,
        output_mono: true,
        mono_device: "shared",
        mono_channel: 1,
        output_mts_bulk: true,
        mts_bulk_device: "bulk",
        mts_bulk_channel: 15,
        output_mpe: true,
        mpe_device: "shared",
        midiin_mpe_manager_ch: 1,
        mpe_lo_ch: 2,
        mpe_hi_ch: 3,
      }),
    ).toEqual([
      { portId: "shared", channel: 0 },
      { portId: "shared", channel: 1 },
      { portId: "shared", channel: 2 },
      { portId: "bulk", channel: 15 },
    ]);
  });

  it("ignores disabled routes and invalid channels", () => {
    expect(
      midiOutputTargets({ midi_device: "old", mono_device: "old", mpe_device: "old" }),
    ).toEqual([]);
    for (const channel of [-1, 16, 0.5, "invalid", Infinity]) {
      expect(
        midiOutputTargets({ output_mono: true, mono_device: "test", mono_channel: channel }),
      ).toEqual([]);
    }
    expect(midiOutputTargets({ output_mono: true, mono_device: "OFF" })).toEqual([]);
  });

  it("uses current settings for panic and unload, even without Keys", () => {
    const send = vi.fn();
    const midi = { outputs: new Map([["mono", { send }]]) };
    let guardian;
    function Harness({ settings }) {
      guardian = useMidiGuardian(midi, settings);
      return null;
    }
    const view = render(
      <Harness settings={{ output_mono: true, mono_device: "mono", mono_channel: 3 }} />,
    );
    guardian.panic();
    expect(send.mock.calls).toEqual([[[0xb3, 123, 0]], [[0xb3, 120, 0]]]);
    send.mockClear();
    view.rerender(
      <Harness settings={{ output_mono: true, mono_device: "mono", mono_channel: 6 }} />,
    );
    window.dispatchEvent(new Event("beforeunload"));
    expect(send.mock.calls).toEqual([[[0xb6, 123, 0]], [[0xb6, 120, 0]]]);
    view.unmount();
    send.mockClear();
    window.dispatchEvent(new Event("beforeunload"));
    expect(send).not.toHaveBeenCalled();
  });

  it("continues past missing and disconnected outputs", () => {
    const send = vi.fn();
    const midi = {
      outputs: new Map([
        [
          "broken",
          {
            send: () => {
              throw new Error("disconnected");
            },
          },
        ],
        ["working", { send }],
      ]),
    };
    let guardian;
    function Harness() {
      guardian = useMidiGuardian(midi, {
        output_mts: true,
        midi_device: "missing",
        fluidsynth_device: "broken",
        output_mono: true,
        mono_device: "working",
      });
      return null;
    }
    render(<Harness />);
    expect(() => guardian.panic()).not.toThrow();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
