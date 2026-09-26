import { createVisualUpdateController } from "./visual-update-controller.js";

function setup() {
  const frames = [];
  const immediate = vi.fn();
  const editor = vi.fn();
  const cancelFrame = vi.fn();
  const requestFrame = vi.fn((callback) => { frames.push(callback); return frames.length; });
  const controller = createVisualUpdateController({
    presentImmediate: immediate, presentEditor: editor, requestFrame, cancelFrame,
  });
  return { controller, frames, immediate, editor, requestFrame, cancelFrame };
}

it("presents every palette cue immediately and only the latest editor cue per frame", () => {
  const { controller, frames, immediate, editor, requestFrame } = setup();
  controller.present(0, "first", "burst1");
  controller.present(1, "second", "burst2");
  expect(immediate.mock.calls).toEqual([[0], [1]]);
  expect(editor).not.toHaveBeenCalled();
  expect(requestFrame).toHaveBeenCalledOnce();
  frames[0]();
  expect(editor).toHaveBeenCalledExactlyOnceWith(1, "second", "burst2");
  controller.present(2);
  expect(requestFrame).toHaveBeenCalledTimes(2);
});

it("cancels idempotently and rejects stale callbacks after a restart", () => {
  const { controller, frames, editor, cancelFrame } = setup();
  controller.present(0);
  controller.cancel();
  controller.cancel();
  expect(cancelFrame).toHaveBeenCalledExactlyOnceWith(1);
  controller.present(1);
  frames[0]();
  expect(editor).not.toHaveBeenCalled();
  frames[1]();
  expect(editor).toHaveBeenCalledExactlyOnceWith(1, undefined, undefined);
});

it("allows a reentrant presentation to schedule its own frame", () => {
  const frames = [];
  let controller;
  const editor = vi.fn((index) => { if (index === 0) controller.present(1); });
  controller = createVisualUpdateController({
    presentImmediate: vi.fn(), presentEditor: editor,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: vi.fn(),
  });
  controller.present(0);
  frames[0]();
  expect(frames).toHaveLength(2);
  frames[1]();
  expect(editor.mock.calls.map(([index]) => index)).toEqual([0, 1]);
});

it("does not latch a frame when a test harness invokes RAF synchronously", () => {
  const editor = vi.fn();
  const controller = createVisualUpdateController({
    presentImmediate: vi.fn(), presentEditor: editor,
    requestFrame: (callback) => { callback(); return 1; }, cancelFrame: vi.fn(),
  });
  controller.present(0);
  controller.present(1);
  expect(editor).toHaveBeenCalledTimes(2);
});
