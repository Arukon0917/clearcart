import { z } from "zod";
import { CategorySchema } from "./product";

export const SORTS = ["relevance", "price-asc", "price-desc", "clarity"] as const;
export const SortSchema = z.enum(SORTS);
export type Sort = z.infer<typeof SortSchema>;

/** Structured filters. Smart search turns free text into this; the catalog renders it as chips. */
export const SearchFiltersSchema = z.object({
  q: z.string().optional(),
  category: CategorySchema.optional(),
  /** Whole dollars, compared against the all-in price. */
  maxPrice: z.number().positive().optional(),
  minPrice: z.number().nonnegative().optional(),
  tags: z.array(z.string()).optional(),
  minClarity: z.number().int().min(0).max(100).optional(),
  sort: SortSchema.optional(),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

/** Query-string form of the filters (everything arrives as strings). */
export const SearchFiltersQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  category: CategorySchema.optional(),
  maxPrice: z.coerce.number().positive().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  tags: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined)),
  minClarity: z.coerce.number().int().min(0).max(100).optional(),
  sort: SortSchema.optional(),
});

export const SearchParseRequestSchema = z.object({
  query: z.string().trim().min(1).max(200),
});
export type SearchParseRequest = z.infer<typeof SearchParseRequestSchema>;

export const SearchParseResponseSchema = z.object({
  filters: SearchFiltersSchema,
  parsedBy: z.enum(["rules", "claude"]),
});
export type SearchParseResponse = z.infer<typeof SearchParseResponseSchema>;
