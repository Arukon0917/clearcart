import { describe, expect, it } from "vitest";
import { clarityScore, type ClarityInput } from "./clarityScore";
import { sellerTrust } from "./trustScore";

const base: ClarityInput = {
  totalReviews: 20,
  suspiciousReviews: 0,
  sellerTrust: 90,
  fitStats: { runsSmall: 2, trueToSize: 26, runsLarge: 2, sampleSize: 30 },
  allInCents: 9000,
  categoryMedianCents: 10000,
  categoryLabel: "shoes",
};

describe("clarityScore", () => {
  it("drops when reviews look fake", () => {
    const honest = clarityScore(base);
    const faked = clarityScore({ ...base, suspiciousReviews: 12, totalReviews: 30 });
    expect(faked.score).toBeLessThan(honest.score - 10);
  });

  it("explains every component and weights sum to 1", () => {
    const { components } = clarityScore(base);
    expect(components.map((c) => c.key)).toEqual(["reviews", "seller", "fit", "price"]);
    expect(components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
    for (const c of components) expect(c.explanation.length).toBeGreaterThan(0);
  });

  it("re-weights without fit for unsized categories", () => {
    const { components } = clarityScore({ ...base, fitStats: null });
    expect(components.map((c) => c.key)).not.toContain("fit");
    expect(components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
  });
});

describe("sellerTrust", () => {
  it("rewards reliable sellers", () => {
    const good = sellerTrust({ onTimeRate: 0.97, returnRate: 0.04, verifiedReviews: 95, totalReviews: 100 });
    const bad = sellerTrust({ onTimeRate: 0.66, returnRate: 0.27, verifiedReviews: 50, totalReviews: 100 });
    expect(good.score).toBeGreaterThan(85);
    expect(bad.score).toBeLessThan(55);
  });
});
