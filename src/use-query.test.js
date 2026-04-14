/**
 * Tests for src/use-query.js
 *
 * Covers the Extract/ExtractArray classes and the named extractors.
 * The useQuery hook itself is integration-level and relies on
 * window.location / localStorage / history — tested via jsdom.
 */

import {
  Extract,
  ExtractArray,
  ExtractString,
  ExtractStringArray,
  ExtractJoinedString,
  ExtractFloat,
  ExtractInt,
  ExtractBool,
} from "./use-query";

// ── Extract class ─────────────────────────────────────────────────────────────

describe("Extract", () => {
  const ex = new Extract(
    (x) => parseInt(x),
    (x) => x.toString(),
  );

  describe("extract()", () => {
    it("returns parsed value when key is present", () => {
      const q = new URLSearchParams("foo=42");
      expect(ex.extract(q, "foo")).toBe(42);
    });

    it("returns null when key is absent", () => {
      const q = new URLSearchParams("");
      expect(ex.extract(q, "foo")).toBeNull();
    });
  });

  describe("insert()", () => {
    it("serialises value into the query string", () => {
      const q = new URLSearchParams();
      ex.insert(q, "foo", 99);
      expect(q.get("foo")).toBe("99");
    });
  });

  describe("store() / restore()", () => {
    it("round-trips a value through localStorage", () => {
      ex.store("mykey", 7);
      expect(ex.restore("mykey")).toBe(7);
    });
  });
});

// ── Falsy-value round-trip tests ──────────────────────────────────────────────
// Guards against the localStorage.getItem(key) truthiness check that drops
// valid stored values of 0, false, and empty string.

describe("ExtractInt falsy round-trip", () => {
  it("restores 0 correctly (not collapsed to null)", () => {
    ExtractInt.store("int_zero", 0);
    expect(ExtractInt.restore("int_zero")).toBe(0);
  });
});

describe("ExtractFloat falsy round-trip", () => {
  it("restores 0.0 correctly (not collapsed to null)", () => {
    ExtractFloat.store("float_zero", 0.0);
    expect(ExtractFloat.restore("float_zero")).toBe(0);
  });
});

describe("ExtractBool falsy round-trip", () => {
  it("restores false correctly (not collapsed to null)", () => {
    ExtractBool.store("bool_false", false);
    expect(ExtractBool.restore("bool_false")).toBe(false);
  });
});

describe("ExtractString falsy round-trip", () => {
  it("restores empty string correctly (not collapsed to null)", () => {
    ExtractString.store("str_empty", "");
    expect(ExtractString.restore("str_empty")).toBe("");
  });
});

// ── ExtractArray class ────────────────────────────────────────────────────────

describe("ExtractArray", () => {
  const ex = new ExtractArray(
    (x) => parseInt(x),
    (x) => x.toString(),
  );

  it("extract() returns all values for a repeated key", () => {
    const q = new URLSearchParams("n=1&n=2&n=3");
    expect(ex.extract(q, "n")).toEqual([1, 2, 3]);
  });

  it("extract() returns null when key is absent", () => {
    const q = new URLSearchParams("");
    expect(ex.extract(q, "n")).toBeNull();
  });

  it("insert() appends multiple values", () => {
    const q = new URLSearchParams();
    ex.insert(q, "n", [10, 20]);
    expect(q.getAll("n")).toEqual(["10", "20"]);
  });
});

// ── Named extractors ──────────────────────────────────────────────────────────

describe("ExtractString", () => {
  it("round-trips a string", () => {
    const q = new URLSearchParams("s=hello");
    expect(ExtractString.extract(q, "s")).toBe("hello");
  });
});

describe("ExtractJoinedString", () => {
  it("splits comma-separated values on extract", () => {
    const q = new URLSearchParams("k=a%2Cb%2Cc");
    expect(ExtractJoinedString.extract(q, "k")).toEqual(["a", "b", "c"]);
  });

  it("joins array with comma on insert", () => {
    const q = new URLSearchParams();
    ExtractJoinedString.insert(q, "k", ["x", "y", "z"]);
    expect(q.get("k")).toBe("x,y,z");
  });
});

describe("ExtractFloat", () => {
  it("parses a float", () => {
    const q = new URLSearchParams("f=3.14");
    expect(ExtractFloat.extract(q, "f")).toBeCloseTo(3.14);
  });

  it("serialises to string", () => {
    const q = new URLSearchParams();
    ExtractFloat.insert(q, "f", 2.718);
    expect(q.get("f")).toBe("2.718");
  });
});

describe("ExtractInt", () => {
  it("parses an integer", () => {
    const q = new URLSearchParams("i=42");
    expect(ExtractInt.extract(q, "i")).toBe(42);
  });

  it("truncates floats", () => {
    const q = new URLSearchParams("i=9.9");
    expect(ExtractInt.extract(q, "i")).toBe(9);
  });
});

describe("ExtractBool", () => {
  it('parses "true" as true', () => {
    const q = new URLSearchParams("b=true");
    expect(ExtractBool.extract(q, "b")).toBe(true);
  });

  it("parses anything else as false", () => {
    const q = new URLSearchParams("b=false");
    expect(ExtractBool.extract(q, "b")).toBe(false);
    const q2 = new URLSearchParams("b=1");
    expect(ExtractBool.extract(q2, "b")).toBe(false);
  });

  it("serialises true/false to string", () => {
    const q = new URLSearchParams();
    ExtractBool.insert(q, "b", true);
    expect(q.get("b")).toBe("true");
  });
});
