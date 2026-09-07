import { act, fireEvent, render, screen } from "@testing-library/preact";
import { expect, it, vi } from "vitest";
import { PlaybackModifiersRow } from "./sequence-controls.jsx";
it("commits text once on Enter then blur, but accepts a subsequent edit", () => {
  const pitch = vi.fn();
  const speed = vi.fn();
  render(
    <PlaybackModifiersRow
      sequencePlaybackSpeed={1}
      sequencePlaybackPitchOffset={0}
      onSequencePlaybackSpeedChange={speed}
      onSequencePlaybackPitchOffsetChange={pitch}
    />,
  );
  for (const [label, value, handler] of [
    ["sequence playback pitch", "100.", pitch],
    ["sequence playback speed", "1.5", speed],
  ]) {
    const input = screen.getByLabelText(label);
    fireEvent.input(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(Number(value));
    fireEvent.input(input, { target: { value: label.endsWith("pitch") ? "2." : "2" } });
    fireEvent.blur(input);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith(2);
  }
});
it("coalesces pointer previews and display updates, then commits the final pitch synchronously", () => {
  // jsdom does not expose the native pointer handler properties Preact detects.
  const pointerProperties = ["onpointerdown", "onpointermove", "onpointerup"];
  const descriptors = pointerProperties.map((key) =>
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
  );
  pointerProperties.forEach((key) =>
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, value: null }),
  );
  const frames = new Map();
  let id = 0;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++id, callback);
    return id;
  });
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((key) => frames.delete(key));
  const preview = vi.fn();
  const commit = vi.fn();
  const view = render(
    <PlaybackModifiersRow
      sequencePlaybackSpeed={1}
      sequencePlaybackPitchOffset={0}
      onSequencePlaybackPitchOffsetPreview={preview}
      onSequencePlaybackPitchOffsetChange={commit}
    />,
  );
  try {
    const slider = screen.getByRole("slider", { name: "sequence playback pitch slider" });
    slider.getBoundingClientRect = () => ({ left: 0, width: 100 });
    const input = screen.getByLabelText("sequence playback pitch");
    const originalText = input.value;
    const pointer = (type, clientX) =>
      fireEvent(slider, new MouseEvent(type, { clientX, bubbles: true }));
    pointer("pointerdown", 75);
    pointer("pointermove", 80);
    pointer("pointermove", 90);
    expect(preview).not.toHaveBeenCalled();
    expect(input.value).toBe(originalText);
    expect(frames.size).toBe(1);
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(Number.parseFloat(input.value)).toBe(preview.mock.calls[0][0]);
    pointer("pointerup", 95);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toBeGreaterThan(preview.mock.calls[0][0]);
    expect(Number.parseFloat(input.value)).toBe(commit.mock.calls[0][0]);
    expect(frames.size).toBe(0);
  } finally {
    view.unmount();
    raf.mockRestore();
    cancel.mockRestore();
    pointerProperties.forEach((key, index) => {
      if (descriptors[index]) Object.defineProperty(HTMLElement.prototype, key, descriptors[index]);
      else delete HTMLElement.prototype[key];
    });
  }
});
