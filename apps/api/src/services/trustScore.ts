import type { ScoreBreakdown } from "@clearcart/shared";
import { clamp, combine, pct } from "./scoring";

export interface SellerSignals {
  onTimeRate: number;
  returnRate: number;
  verifiedReviews: number;
  totalReviews: number;
}

export function sellerTrust(s: SellerSignals): ScoreBreakdown {
  const verifiedRatio = s.totalReviews === 0 ? 0 : s.verifiedReviews / s.totalReviews;
  return combine([
    {
      key: "onTime",
      label: "On-time delivery",
      score: clamp(Math.round(s.onTimeRate * 100)),
      weight: 0.45,
      explanation: `${pct(s.onTimeRate)} of orders arrived by the promised date.`,
    },
    {
      key: "returns",
      label: "Return rate",
      // 0% returns → 100, 40% returns → 0.
      score: clamp(Math.round(100 - s.returnRate * 250)),
      weight: 0.3,
      explanation: `${pct(s.returnRate)} of orders were returned.`,
    },
    {
      key: "verified",
      label: "Verified reviews",
      score: clamp(Math.round(verifiedRatio * 100)),
      weight: 0.25,
      explanation: `${pct(verifiedRatio)} of reviews come from confirmed purchases.`,
    },
  ]);
}
