import { expect, it } from "vitest";
import { shapeExquisExpressionY } from "./exquis-expression-y.js";

it("moves centre 64 to the brightness fader without losing either endpoint", () => {
  expect(shapeExquisExpressionY(0, 0.2)).toBe(0);
  expect(shapeExquisExpressionY(64, 0.2)).toBeCloseTo(25.4);
  expect(shapeExquisExpressionY(127, 0.2)).toBe(127);
  expect(shapeExquisExpressionY(32, 0.2)).toBeCloseTo(12.7);
  expect(shapeExquisExpressionY(95.5, 0.2)).toBeCloseTo(76.2);
  expect(shapeExquisExpressionY(64, 0)).toBe(0);
  expect(shapeExquisExpressionY(64, 1)).toBe(127);
});
