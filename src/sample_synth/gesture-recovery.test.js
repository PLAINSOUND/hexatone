import { installAudioGestureRecovery } from "./gesture-recovery.js";

it("resumes synchronously on a gesture and retries despite a pending background attempt", async () => {
  const target = new EventTarget();
  const context = { state: "interrupted", resume: vi.fn(() => new Promise(() => {})) };
  const recovered = vi.fn();
  const dispose = installAudioGestureRecovery(target, () => context, recovered, vi.fn());
  target.dispatchEvent(new Event("pointerdown"));
  expect(context.resume).toHaveBeenCalledOnce();
  context.resume.mockImplementation(() => { context.state = "running"; return Promise.resolve(); });
  target.dispatchEvent(new Event("touchend"));
  expect(context.resume).toHaveBeenCalledTimes(2);
  await Promise.resolve();
  expect(recovered).toHaveBeenCalledWith(context);
  target.dispatchEvent(new Event("click"));
  expect(context.resume).toHaveBeenCalledTimes(2);
  dispose();
  context.state = "suspended";
  target.dispatchEvent(new Event("keydown"));
  expect(context.resume).toHaveBeenCalledTimes(2);
});

it("ignores missing/closed contexts and stale resume completions", async () => {
  const target = new EventTarget();
  let context = null;
  const recovered = vi.fn();
  const dispose = installAudioGestureRecovery(target, () => context, recovered, vi.fn());
  target.dispatchEvent(new Event("click"));
  context = { state: "closed", resume: vi.fn() };
  target.dispatchEvent(new Event("click"));
  expect(context.resume).not.toHaveBeenCalled();
  let finish;
  const old = { state: "suspended", resume: () => new Promise(resolve => { finish = resolve; }) };
  context = old;
  target.dispatchEvent(new Event("click"));
  context = null;
  old.state = "running";
  finish();
  await Promise.resolve();
  expect(recovered).not.toHaveBeenCalled();
  dispose();
});

it("handles resume failure and allows the next gesture to retry", async () => {
  const target = new EventTarget();
  const error = new Error("not allowed yet");
  const context = { state: "suspended", resume: vi.fn().mockRejectedValue(error) };
  const onError = vi.fn();
  const dispose = installAudioGestureRecovery(target, () => context, vi.fn(), onError);
  target.dispatchEvent(new Event("click"));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(error);
  target.dispatchEvent(new Event("click"));
  expect(context.resume).toHaveBeenCalledTimes(2);
  dispose();
});

it("cycles a supposedly running context once after each interruption", async () => {
  const target = new EventTarget();
  let interrupted = true;
  const calls = [];
  const context = {
    state: "running",
    suspend: vi.fn(async () => { calls.push("suspend"); context.state = "suspended"; }),
    resume: vi.fn(async () => { calls.push("resume"); context.state = "running"; }),
  };
  const dispose = installAudioGestureRecovery(target, () => context, vi.fn(), vi.fn(), () => {
    const value = interrupted;
    interrupted = false;
    return value;
  });
  target.dispatchEvent(new Event("pointerdown"));
  expect(calls).toEqual(["suspend"]);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(["suspend", "resume"]);
  target.dispatchEvent(new Event("touchend"));
  target.dispatchEvent(new Event("click"));
  expect(calls).toEqual(["suspend", "resume"]);
  interrupted = true;
  target.dispatchEvent(new Event("pointerdown"));
  await Promise.resolve();
  expect(calls).toEqual(["suspend", "resume", "suspend", "resume"]);
  dispose();
});

it("does not resume a detached graph after a pending suspend finishes", async () => {
  const target = new EventTarget();
  let finish;
  const context = {
    state: "running",
    suspend: () => new Promise(resolve => { finish = resolve; }),
    resume: vi.fn(),
  };
  const dispose = installAudioGestureRecovery(target, () => context, vi.fn(), vi.fn(), () => true);
  target.dispatchEvent(new Event("click"));
  dispose();
  finish();
  await Promise.resolve();
  expect(context.resume).not.toHaveBeenCalled();
});
