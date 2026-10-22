import { z } from "zod";

export const FitRequestSchema = z.object({
  productId: z.string(),
  heightCm: z.number().int().min(120).max(230),
  weightKg: z.number().int().min(30).max(200),
  usualSize: z.string().min(1),
});
export type FitRequest = z.infer<typeof FitRequestSchema>;

export const FitRecommendationSchema = z.object({
  recommendedSize: z.string(),
  /** 0–100. Low when few similar buyers left feedback or they disagree. */
  confidence: z.number().int().min(0).max(100),
  direction: z.enum(["size-down", "true", "size-up"]),
  similarBuyers: z.number().int(),
  reason: z.string(),
});
export type FitRecommendation = z.infer<typeof FitRecommendationSchema>;
