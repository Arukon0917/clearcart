import type { FitRecommendation, FitStats } from "@clearcart/shared";
import { clamp, pct } from "./scoring";

export type FitLabel = "small" | "true" | "large";

export interface FitDataPoint {
  heightCm: number;
  weightKg: number;
  fit: FitLabel;
}

export interface Shopper {
  heightCm: number;
  weightKg: number;
  usualSize: string;
}

const SIMILAR_HEIGHT_CM = 8;
const SIMILAR_WEIGHT_KG = 10;
const MIN_SIMILAR = 5;
const LEAN_THRESHOLD = 0.25;

export function fitStats(feedback: FitDataPoint[]): FitStats {
  return {
    runsSmall: feedback.filter((f) => f.fit === "small").length,
    trueToSize: feedback.filter((f) => f.fit === "true").length,
    runsLarge: feedback.filter((f) => f.fit === "large").length,
    sampleSize: feedback.length,
  };
}

/**
 * Recommends a size from what buyers with a similar build reported.
 * `sizeScale` is the product's sizes in ascending order; `usualSize` must be one of them.
 */
export function recommendFit(
  shopper: Shopper,
  feedback: FitDataPoint[],
  sizeScale: string[],
): FitRecommendation {
  const usualIndex = sizeScale.indexOf(shopper.usualSize);
  if (usualIndex === -1) throw new RangeError(`Unknown size "${shopper.usualSize}"`);

  const similar = feedback.filter(
    (f) =>
      Math.abs(f.heightCm - shopper.heightCm) <= SIMILAR_HEIGHT_CM &&
      Math.abs(f.weightKg - shopper.weightKg) <= SIMILAR_WEIGHT_KG,
  );
  const useSimilar = similar.length >= MIN_SIMILAR;
  const pool = useSimilar ? similar : feedback;
  const who = useSimilar ? `${pool.length} buyers with a similar build` : `${pool.length} buyers`;

  if (pool.length === 0) {
    return {
      recommendedSize: shopper.usualSize,
      confidence: 30,
      direction: "true",
      similarBuyers: 0,
      reason: "No one has left fit feedback yet, so we suggest your usual size.",
    };
  }

  const stats = fitStats(pool);
  const lean = (stats.runsLarge - stats.runsSmall) / pool.length;
  const direction: FitRecommendation["direction"] =
    lean <= -LEAN_THRESHOLD ? "size-up" : lean >= LEAN_THRESHOLD ? "size-down" : "true";
  const step = direction === "size-up" ? 1 : direction === "size-down" ? -1 : 0;
  const targetIndex = Math.min(sizeScale.length - 1, Math.max(0, usualIndex + step));

  const agreeing =
    direction === "size-up"
      ? stats.runsSmall
      : direction === "size-down"
        ? stats.runsLarge
        : stats.trueToSize;
  const agreement = agreeing / pool.length;
  const sampleFactor = Math.min(1, 0.5 + pool.length / 40);
  const confidence = clamp(Math.round(agreement * sampleFactor * 100), 0, 99);

  const reason =
    direction === "true"
      ? `${pct(agreement)} of ${who} said it runs true to size, so stick with your usual size.`
      : `${pct(agreement)} of ${who} said it runs ${direction === "size-up" ? "small" : "large"}, so we suggest going ${direction === "size-up" ? "up" : "down"} one size.`;

  return {
    recommendedSize: sizeScale[targetIndex] ?? shopper.usualSize,
    confidence,
    direction,
    similarBuyers: pool.length,
    reason,
  };
}
