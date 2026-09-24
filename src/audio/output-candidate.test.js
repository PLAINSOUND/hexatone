import { expect, it, vi } from "vitest";
import { createOutputCandidateRequests } from "./output-candidate.js";

it("evicts failed requests so the same key can retry", async () => {
  const request = createOutputCandidateRequests();
  const options = { isCurrent: () => true, adopt: vi.fn() };
  await expect(request("A", () => { throw new Error("failed"); }, options)).rejects.toThrow("failed");
  const candidate = { shutdown: vi.fn() };
  await expect(request("A", () => candidate, options)).resolves.toBe(candidate);
  expect(options.adopt).toHaveBeenCalledOnce();
  expect(candidate.shutdown).not.toHaveBeenCalled();
});

it("disposes a shared candidate once when all requesting builds are cancelled", async () => {
  const request = createOutputCandidateRequests();
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const create = vi.fn(() => pending);
  const adopt = vi.fn();
  let current = true;
  const first = request("A", create, { isCurrent: () => current, adopt });
  const second = request("A", create, { isCurrent: () => current, adopt });
  expect(first).toBe(second);
  await Promise.resolve();
  current = false;
  const candidate = { shutdown: vi.fn() };
  resolve(candidate);
  await expect(second).resolves.toBeNull();
  expect(create).toHaveBeenCalledOnce();
  expect(candidate.shutdown).toHaveBeenCalledOnce();
  expect(adopt).not.toHaveBeenCalled();
});

it("does not begin construction after a request is cancelled", async () => {
  const request = createOutputCandidateRequests();
  const create = vi.fn();
  await expect(request("A", create, { isCurrent: () => false, adopt: vi.fn() })).resolves.toBeNull();
  expect(create).not.toHaveBeenCalled();
});
