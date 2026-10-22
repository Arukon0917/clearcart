import { z } from "zod";

export const CATEGORIES = ["shoes", "apparel", "bags", "tech"] as const;
export const CategorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof CategorySchema>;

/** Categories where size matters, so the fit finder is shown. */
export const FIT_CATEGORIES: readonly Category[] = ["shoes", "apparel"];

/** One weighted input to a score, shown to the shopper so no score is a black box. */
export const ScoreComponentSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  explanation: z.string(),
});
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

export const ScoreBreakdownSchema = z.object({
  score: z.number().min(0).max(100),
  components: z.array(ScoreComponentSchema),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;

export const PriceBreakdownSchema = z.object({
  itemCents: z.number().int(),
  shippingCents: z.number().int(),
  taxCents: z.number().int(),
  allInCents: z.number().int(),
});
export type PriceBreakdown = z.infer<typeof PriceBreakdownSchema>;

export const ProductSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand: z.string(),
  category: CategorySchema,
  imageHue: z.number().int(),
  tags: z.array(z.string()),
  price: PriceBreakdownSchema,
  rating: z.number(),
  reviewCount: z.number().int(),
  clarityScore: z.number().int(),
  sellerName: z.string(),
  sellerTrust: z.number().int(),
  /** null for products without photos: render the generated imageHue art instead. */
  thumbnailUrl: z.string().nullable(),
});
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  author: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string(),
  body: z.string(),
  verified: z.boolean(),
  isSuspicious: z.boolean(),
  suspicionReason: z.string().nullable(),
  createdAt: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewDigestSchema = z.object({
  summary: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  suspiciousCount: z.number().int(),
  generatedBy: z.enum(["heuristic", "claude"]),
});
export type ReviewDigest = z.infer<typeof ReviewDigestSchema>;

export const FitStatsSchema = z.object({
  runsSmall: z.number().int(),
  trueToSize: z.number().int(),
  runsLarge: z.number().int(),
  sampleSize: z.number().int(),
});
export type FitStats = z.infer<typeof FitStatsSchema>;

export const ProductDetailSchema = ProductSummarySchema.extend({
  description: z.string(),
  sizes: z.array(z.object({ size: z.string(), inStock: z.boolean() })),
  clarity: ScoreBreakdownSchema,
  seller: z.object({ id: z.string(), name: z.string(), trust: ScoreBreakdownSchema }),
  digest: ReviewDigestSchema.nullable(),
  reviews: z.array(ReviewSchema),
  fitStats: FitStatsSchema.nullable(),
  images: z.array(z.object({ url: z.string(), isThumbnail: z.boolean(), alt: z.string().nullable() })),
});
export type ProductDetail = z.infer<typeof ProductDetailSchema>;

export const ProductListResponseSchema = z.object({
  items: z.array(ProductSummarySchema),
  total: z.number().int(),
});
export type ProductListResponse = z.infer<typeof ProductListResponseSchema>;
