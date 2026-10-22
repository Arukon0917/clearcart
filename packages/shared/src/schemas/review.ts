import { z } from "zod";

/** What a buyer sends when writing or editing a review. */
export const ReviewInputSchema = z.object({
  rating: z.number().int().min(1, "Pick a rating").max(5),
  body: z.string().trim().min(10, "Write at least 10 characters").max(1000, "Keep it under 1000 characters"),
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;

export interface CanReviewResponse {
  canReview: boolean;
  /** The buyer's existing review, so the form can edit it instead of creating a second one. */
  review: { id: string; rating: number; body: string } | null;
}
