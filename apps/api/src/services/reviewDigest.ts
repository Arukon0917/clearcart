import type { ReviewDigest } from "@clearcart/shared";

export interface DigestReview {
  rating: number;
  body: string;
  isSuspicious: boolean;
}

/** Aspect → keywords that signal a review is talking about it. */
const ASPECTS: Record<string, RegExp> = {
  Comfort: /comfortable|comfort|cushion|soft/i,
  Fit: /\bfits?\b|runs (a bit )?(small|large)|sizing/i,
  Durability: /holding up|durable|sturdy|peel|fell apart|broke|wore out/i,
  Value: /value|price|worth|overpriced/i,
  Quality: /quality|materials?|stitching|premium|flimsy/i,
  Shipping: /shipping|arrived|delivery|packaging/i,
  "Battery life": /battery|charge/i,
  Sound: /sound|bass|audio|noise/i,
  Capacity: /space|capacity|fits everything|roomy|pockets/i,
};

const POSITIVE_MIN = 4;
const NEGATIVE_MAX = 2;

function topAspects(reviews: DigestReview[], limit: number): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of reviews) {
    for (const [aspect, pattern] of Object.entries(ASPECTS)) {
      if (pattern.test(r.body)) counts.set(aspect, (counts.get(aspect) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/** Offline digest: counts what genuine reviewers praise and complain about. */
export function heuristicDigest(reviews: DigestReview[]): ReviewDigest {
  const genuine = reviews.filter((r) => !r.isSuspicious);
  const suspiciousCount = reviews.length - genuine.length;
  const pros = topAspects(
    genuine.filter((r) => r.rating >= POSITIVE_MIN),
    3,
  ).map(([aspect, n]) => `${aspect} (praised by ${n} buyer${n === 1 ? "" : "s"})`);
  const cons = topAspects(
    genuine.filter((r) => r.rating <= NEGATIVE_MAX),
    2,
  ).map(([aspect, n]) => `${aspect} (${n} complaint${n === 1 ? "" : "s"})`);

  const avg = genuine.length
    ? genuine.reduce((s, r) => s + r.rating, 0) / genuine.length
    : 0;
  const summary =
    genuine.length === 0
      ? "Not enough genuine reviews to summarise yet."
      : `Honest rating ${avg.toFixed(1)}★ from ${genuine.length} genuine review${genuine.length === 1 ? "" : "s"}.` +
        (suspiciousCount > 0 ? ` ${suspiciousCount} suspicious review${suspiciousCount === 1 ? " was" : "s were"} filtered out.` : "");

  return { summary, pros, cons, suspiciousCount, generatedBy: "heuristic" };
}
