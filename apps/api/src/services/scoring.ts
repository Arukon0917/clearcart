import type { ScoreBreakdown, ScoreComponent } from "@clearcart/shared";

export const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));

/** Weighted average of components. Weights are renormalised so callers can omit a component. */
export function combine(components: ScoreComponent[]): ScoreBreakdown {
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const normalised = components.map((c) => ({ ...c, weight: c.weight / totalWeight }));
  const score = Math.round(normalised.reduce((s, c) => s + c.score * c.weight, 0));
  return { score: clamp(score), components: normalised };
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
