import { formatMoney, type FitStats, type ScoreBreakdown, type ScoreComponent } from "@clearcart/shared";
import { clamp, combine, pct } from "./scoring";

export interface ClarityInput {
  totalReviews: number;
  suspiciousReviews: number;
  sellerTrust: number;
  /** null when the category has no sizing (bags, tech). */
  fitStats: FitStats | null;
  allInCents: number;
  categoryMedianCents: number;
  categoryLabel: string;
}

function reviewAuthenticity(total: number, suspicious: number): ScoreComponent {
  const genuineRatio = total === 0 ? 0.5 : (total - suspicious) / total;
  return {
    key: "reviews",
    label: "Review authenticity",
    score: clamp(Math.round(genuineRatio * 100)),
    weight: 0.35,
    explanation:
      total === 0
        ? "No reviews yet, so we can't vouch for it."
        : suspicious === 0
          ? `All ${total} reviews look genuine.`
          : `${suspicious} of ${total} reviews look fake and are excluded from the rating.`,
  };
}

function fitConfidence(stats: FitStats): ScoreComponent {
  const { runsSmall, trueToSize, runsLarge, sampleSize } = stats;
  const dominant = Math.max(runsSmall, trueToSize, runsLarge);
  const agreement = sampleSize === 0 ? 0 : dominant / sampleSize;
  // Fewer than ~30 data points means we're less sure, however much they agree.
  const sampleFactor = Math.min(1, 0.4 + sampleSize / 50);
  const verdict =
    dominant === trueToSize ? "true to size" : dominant === runsSmall ? "small" : "large";
  return {
    key: "fit",
    label: "Fit confidence",
    score: clamp(Math.round(agreement * sampleFactor * 100)),
    weight: 0.2,
    explanation:
      sampleSize === 0
        ? "No fit feedback yet."
        : `${pct(agreement)} of ${sampleSize} buyers say it runs ${verdict}.`,
  };
}

function priceFairness(allIn: number, median: number, categoryLabel: string): ScoreComponent {
  const ratio = allIn / median;
  // 20% under the category median or cheaper → 100; 50% over → 30.
  const score = clamp(Math.round(100 - (ratio - 0.8) * 100), 20, 100);
  const diff = formatMoney(Math.abs(allIn - median));
  return {
    key: "price",
    label: "Price fairness",
    score,
    weight: 0.2,
    explanation:
      ratio <= 1
        ? `${diff} below the typical all-in price for ${categoryLabel}.`
        : `${diff} above the typical all-in price for ${categoryLabel}.`,
  };
}

/** The single transparent badge on every product. Every input is shown to the shopper. */
export function clarityScore(input: ClarityInput): ScoreBreakdown {
  const components: ScoreComponent[] = [
    reviewAuthenticity(input.totalReviews, input.suspiciousReviews),
    {
      key: "seller",
      label: "Seller trust",
      score: input.sellerTrust,
      weight: 0.25,
      explanation: `The seller scores ${input.sellerTrust}/100 on delivery, returns and verified reviews.`,
    },
    priceFairness(input.allInCents, input.categoryMedianCents, input.categoryLabel),
  ];
  if (input.fitStats) components.splice(2, 0, fitConfidence(input.fitStats));
  return combine(components);
}
