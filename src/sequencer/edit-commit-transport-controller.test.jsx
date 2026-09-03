import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import useEditCommitTransportController from "./edit-commit-transport-controller.js";

function Harness({ onTransport, persistentDraft = false }) {
  const { notifyEditCommitted, runTransportAction } = useEditCommitTransportController({
    snapshots: [],
  });
  return (
    <>
      <input
        class={`sequencer-event__input${persistentDraft ? " sequencer-event__input--draft" : ""}`}
        aria-label="sequence pitch"
        defaultValue="A4"
        onFocus={(event) => {
          event.currentTarget.dataset.lastCommittedValue = event.currentTarget.value;
        }}
        onBlur={(event) => {
          if (event.currentTarget.dataset.lastCommittedValue === event.currentTarget.value) return;
          event.currentTarget.dataset.lastCommittedValue = event.currentTarget.value;
          notifyEditCommitted();
        }}
      />
      <button type="button" onClick={() => runTransportAction(onTransport)}>
        Play cue
      </button>
    </>
  );
}

describe("edit commit transport controller", () => {
  it("runs immediately when Firefox leaves an unchanged sequencer input focused", () => {
    const onTransport = vi.fn();
    render(<Harness onTransport={onTransport} />);
    const input = screen.getByLabelText("sequence pitch");
    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByText("Play cue"));

    expect(onTransport).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it("does not mistake a persistently highlighted committed pitch for a pending edit", () => {
    const onTransport = vi.fn();
    render(<Harness onTransport={onTransport} persistentDraft />);
    const input = screen.getByLabelText("sequence pitch");
    input.focus();

    fireEvent.click(screen.getByText("Play cue"));

    expect(onTransport).toHaveBeenCalledTimes(1);
  });

  it("waits for a genuinely changed focused value to commit", async () => {
    const onTransport = vi.fn();
    render(<Harness onTransport={onTransport} persistentDraft />);
    const input = screen.getByLabelText("sequence pitch");
    input.focus();
    fireEvent.input(input, { target: { value: "B4" } });

    fireEvent.click(screen.getByText("Play cue"));

    await waitFor(() => expect(onTransport).toHaveBeenCalledTimes(1));
  });
});
