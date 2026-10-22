export interface ReviewInput {
  rating: number;
  body: string;
  verified: boolean;
}

export interface SuspicionResult {
  isSuspicious: boolean;
  reason: string | null;
}

const SUSPICION_THRESHOLD = 2;

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Flags reviews that look fake, from signals visible in the reviews themselves.
 * Deliberately simple and explainable: every flag comes with a human-readable reason.
 */
export function detectSuspicious(reviews: ReviewInput[]): SuspicionResult[] {
  const textCounts = new Map<string, number>();
  for (const r of reviews) {
    const key = normalise(r.body);
    textCounts.set(key, (textCounts.get(key) ?? 0) + 1);
  }

  return reviews.map((r) => {
    const signals: { weight: number; reason: string }[] = [];
    if ((textCounts.get(normalise(r.body)) ?? 0) > 1) {
      signals.push({ weight: 2, reason: "Same text posted by several accounts" });
    }
    if (/!{3,}/.test(r.body) || /\b[A-Z]{4,}\b.*\b[A-Z]{4,}\b/.test(r.body)) {
      signals.push({ weight: 1, reason: "Excessive hype punctuation" });
    }
    if (!r.verified && r.rating === 5 && r.body.length < 60) {
      signals.push({ weight: 1.5, reason: "Short 5-star review with no confirmed purchase" });
    } else if (!r.verified) {
      signals.push({ weight: 0.5, reason: "No confirmed purchase" });
    }

    const score = signals.reduce((s, x) => s + x.weight, 0);
    if (score < SUSPICION_THRESHOLD) return { isSuspicious: false, reason: null };
    const strongest = [...signals].sort((a, b) => b.weight - a.weight)[0];
    return { isSuspicious: true, reason: strongest?.reason ?? null };
  });
}
