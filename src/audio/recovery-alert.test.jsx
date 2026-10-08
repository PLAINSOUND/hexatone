import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import AudioRecoveryAlert from "./recovery-alert.jsx";

afterEach(cleanup);

it.each([
  [true, false, "Tap Start Audio to prepare the built-in sounds before playing."],
  [true, true, "Starting audio…"],
  [false, true, "Restoring audio…"],
  [false, false, "SuperSonic could not start: the audio clock is interrupted."],
])("separates status from actions (starting: %s, busy: %s)", (_starting, busy, message) => {
  const onActivate = vi.fn();
  const onSave = vi.fn();
  const onDismiss = vi.fn();
  render(<AudioRecoveryAlert {...{ busy, message, onActivate, onSave, onDismiss }} />);
  expect(screen.getByRole("status").textContent).toBe(message);
  const buttons = screen.getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual(["Retry", "Report", "Dismiss"]);
  expect(buttons.map((button) => button.disabled)).toEqual([false, false, false]);
  expect(screen.queryByRole("button", { name: /Starting|Restoring/ })).toBeNull();
  for (const button of buttons) {
    expect(button.type).toBe("button");
    button.click();
  }
  expect(onActivate).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
