import { describe, expect, it } from "vitest";
import { reuseEquivalentDisplaySnapshots } from "./display-snapshot-stability.js";

describe("display snapshot stability", () => {
  it("reuses a JSON-equivalent projection", () => {
    const previous = [{ id: 1, notes: [{ id: "a", midicents: 69 }], description: "A" }];
    const next = [{ id: 1, notes: [{ id: "a", midicents: 69 }], description: "A" }];

    expect(reuseEquivalentDisplaySnapshots(previous, next)).toBe(previous);
  });

  it("keeps a projection containing a rendered change", () => {
    const previous = [{ id: 1, notes: [{ id: "a", midicents: 69 }] }];
    const next = [{ id: 1, notes: [{ id: "a", midicents: 70 }] }];

    expect(reuseEquivalentDisplaySnapshots(previous, next)).toBe(next);
  });
});
