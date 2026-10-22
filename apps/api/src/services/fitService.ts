import type { FitRecommendation, FitRequest } from "@clearcart/shared";
import { HttpError } from "../errors";
import { getProductEntry } from "./catalogService";
import { recommendFit, type FitLabel } from "./fitRecommender";

export async function recommendSize(req: FitRequest): Promise<FitRecommendation> {
  const { record, detail } = await getProductEntry(req.productId);
  if (!detail.fitStats) throw new HttpError(400, `${detail.name} doesn't come in sizes`);
  const scale = detail.sizes.map((s) => s.size);
  if (!scale.includes(req.usualSize)) {
    throw new HttpError(400, `Size ${req.usualSize} isn't offered for ${detail.name}`);
  }
  const feedback = record.fitFeedback.map((f) => ({ ...f, fit: f.fit as FitLabel }));
  return recommendFit(req, feedback, scale);
}
