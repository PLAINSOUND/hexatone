// Exercise the actual row-edit adapters independently of transport presentation.
import { render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import useEventEditingController from "./event-editing-controller.js";
import {
  commitEventPitchLabelInSnapshot,
  restoreEventPitchLabelInSnapshot,
  updateEventFieldInSnapshot,
} from "./sequence-mutations.js";

function mount(onUpdateSnapshot) {
  let controller;
  function Harness({ update }) {
    controller = useEventEditingController(update);
    return null;
  }
  const view = render(<Harness update={onUpdateSnapshot} />);
  return {
    get current() {
      return controller;
    },
    rerender(update = onUpdateSnapshot) {
      view.rerender(<Harness update={update} />);
    },
  };
}
const snapshot = {
  id: "s1",
  length: 2,
  notes: [
    { id: "a", midicents: 69, start: 0, end: 1, displayLabel: "A" },
    { id: "b", midicents: 72, start: 0, end: 1, displayLabel: "C" },
  ],
};
const ref = { noteId: "a" };

describe("event editing controller", () => {
  it("does no mutation on presentation renders and retains callback identities", () => {
    const update = vi.fn();
    const view = mount(update);
    const first = view.current;
    view.rerender();
    for (const key of Object.keys(first)) expect(view.current[key]).toBe(first[key]);
    expect(update).not.toHaveBeenCalled();
  });
  it("publishes edits through the latest owner, without mutating other notes", () => {
    const old = vi.fn(),
      update = vi.fn();
    const view = mount(old);
    view.rerender(update);
    view.current.toggleEventReattack(snapshot, ref);
    const notes = update.mock.calls[0][1].notes;
    expect(notes[0]).toEqual({ ...snapshot.notes[0], forceReattack: true });
    expect(notes[1]).toBe(snapshot.notes[1]);
    expect(snapshot.notes[0].forceReattack).toBeUndefined();
    expect(old).not.toHaveBeenCalled();
  });
  it("delegates field parsing, commit and revert to the shared pitch mutations", () => {
    const update = vi.fn();
    const view = mount(update);
    view.current.updateEventField(snapshot, ref, "velocity", "80");
    expect(update).toHaveBeenLastCalledWith("s1", {
      notes: updateEventFieldInSnapshot(snapshot, ref, "velocity", "80"),
    });
    view.current.commitEventPitchLabel(snapshot, ref);
    expect(update).toHaveBeenLastCalledWith("s1", {
      notes: commitEventPitchLabelInSnapshot(snapshot, ref),
    });
    view.current.restoreEventPitchLabel(snapshot, ref);
    expect(update).toHaveBeenLastCalledWith("s1", {
      notes: restoreEventPitchLabelInSnapshot(snapshot, ref),
    });
  });
});
