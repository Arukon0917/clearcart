import { describe, expect, it } from "vitest";
import { recommendFit, type FitDataPoint, type FitLabel } from "./fitRecommender";

const SCALE = ["6", "7", "8", "9", "10"];
const buyers = (fit: FitLabel, n: number, heightCm = 175, weightKg = 70): FitDataPoint[] =>
  Array.from({ length: n }, () => ({ heightCm, weightKg, fit }));
const shopper = { heightCm: 176, weightKg: 72, usualSize: "8" };

describe("recommendFit", () => {
  it("sizes up when similar buyers say it runs small", () => {
    const rec = recommendFit(shopper, [...buyers("small", 16), ...buyers("true", 4)], SCALE);
    expect(rec.recommendedSize).toBe("9");
    expect(rec.direction).toBe("size-up");
    expect(rec.confidence).toBeGreaterThan(70);
  });

  it("keeps the usual size when it runs true", () => {
    const rec = recommendFit(shopper, buyers("true", 20), SCALE);
    expect(rec.recommendedSize).toBe("8");
    expect(rec.direction).toBe("true");
  });

  it("prefers feedback from buyers with a similar build", () => {
    const feedback = [...buyers("large", 6), ...buyers("small", 30, 150, 45)];
    const rec = recommendFit(shopper, feedback, SCALE);
    expect(rec.direction).toBe("size-down");
    expect(rec.similarBuyers).toBe(6);
  });

  it("never recommends a size outside the scale", () => {
    const rec = recommendFit({ ...shopper, usualSize: "10" }, buyers("small", 20), SCALE);
    expect(rec.recommendedSize).toBe("10");
  });

  it("is less confident with little data", () => {
    const few = recommendFit(shopper, buyers("small", 5), SCALE);
    const many = recommendFit(shopper, buyers("small", 40), SCALE);
    expect(few.confidence).toBeLessThan(many.confidence);
  });

  it("rejects sizes the product doesn't offer", () => {
    expect(() => recommendFit({ ...shopper, usualSize: "15" }, [], SCALE)).toThrow(RangeError);
  });
});
