import { expect, it, vi } from "vitest";
import { completeOutputBuild } from "./output-build.js";

it("installs successful distinct outputs once after all candidates settle", async () => {
  let resolve;
  const slow = new Promise(done => { resolve = done; });
  const a = {}, b = {}, error = new Error("unavailable");
  const install = vi.fn(), onError = vi.fn(), finish = vi.fn();
  const build = completeOutputBuild({ pending: [Promise.resolve(a), slow, Promise.resolve(a),
    Promise.reject(error)], isCurrent: () => true, install, onError, finish });
  await Promise.resolve();
  expect(install).not.toHaveBeenCalled();
  resolve(b);
  expect(await build).toBe(true);
  expect(install).toHaveBeenCalledExactlyOnceWith([a, b]);
  expect(onError).toHaveBeenCalledWith(error, "construction");
  expect(finish).toHaveBeenCalledOnce();
});

it("does not publish a superseded build or dispose its reusable engines", async () => {
  const output = { shutdown: vi.fn() }, install = vi.fn(), finish = vi.fn();
  expect(await completeOutputBuild({ pending: [Promise.resolve(output)], isCurrent: () => false,
    install, onError: vi.fn(), finish })).toBe(false);
  expect(install).not.toHaveBeenCalled();
  expect(output.shutdown).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledOnce();
});

it("reports installation failure and always finishes loading", async () => {
  const error = new Error("reconciliation failed"), onError = vi.fn(), finish = vi.fn();
  expect(await completeOutputBuild({ pending: [], isCurrent: () => true,
    install: () => { throw error; }, onError, finish })).toBe(false);
  expect(onError).toHaveBeenCalledExactlyOnceWith(error, "installation");
  expect(finish).toHaveBeenCalledOnce();
});
