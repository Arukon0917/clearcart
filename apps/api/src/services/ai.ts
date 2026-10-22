import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CATEGORIES, TAGS, isTag, type SearchFilters } from "@clearcart/shared";
import { parseWithRules } from "./searchParser";
import { heuristicDigest } from "./reviewDigest";

const MODEL = "claude-haiku-5-5";

/** AI features switch on only when a key is configured; everything has an offline fallback. */
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

// The SDK is loaded lazily so the API starts (and runs) without it or without a key.
let sdk: Promise<{ client: Anthropic; zodOutputFormat: typeof import("@anthropic-ai/sdk/helpers/zod").zodOutputFormat }> | null = null;
function loadSdk() {
  sdk ??= Promise.all([import("@anthropic-ai/sdk"), import("@anthropic-ai/sdk/helpers/zod")]).then(
    ([{ default: AnthropicClient }, { zodOutputFormat }]) => ({
      client: new AnthropicClient({ maxRetries: 0 }),
      zodOutputFormat,
    }),
  );
  return sdk;
}

const LlmFiltersSchema = z.object({
  category: z.enum(CATEGORIES).nullable(),
  maxPrice: z.number().nullable(),
  minPrice: z.number().nullable(),
  tags: z.array(z.string()),
  sort: z.enum(["relevance", "price-asc", "price-desc", "clarity"]).nullable(),
  wantsTrusted: z.boolean(),
  keywords: z.string().nullable(),
});

const SEARCH_SYSTEM = `You turn a shopper's search query into catalog filters for an online store.
Categories: ${CATEGORIES.join(", ")}.
Allowed tags (use only these exact keys): ${TAGS.join(", ")}.
Prices are whole US dollars. Set wantsTrusted when the shopper asks for trustworthy, reliable or honest products.
Put brand or product names that no filter covers in keywords; otherwise leave keywords null.`;

/** Falls back to the rule-based parser when there's no key or the call fails. */
export async function parseWithClaude(query: string): Promise<SearchFilters | null> {
  if (!aiEnabled()) return parseWithRules(query);
  try {
    const { client, zodOutputFormat } = await loadSdk();
    const response = await client.messages.parse(
      {
        model: MODEL,
        max_tokens: 4096,
        system: SEARCH_SYSTEM,
        output_config: { effort: "low", format: zodOutputFormat(LlmFiltersSchema) },
        messages: [{ role: "user", content: query }],
      },
      { timeout: 6_000 },
    );
    const out = response.stop_reason === "end_turn" ? response.parsed_output : null;
    if (!out) return parseWithRules(query);

    const filters: SearchFilters = {};
    if (out.category) filters.category = out.category;
    if (out.maxPrice && out.maxPrice > 0) filters.maxPrice = out.maxPrice;
    if (out.minPrice && out.minPrice >= 0) filters.minPrice = out.minPrice;
    const tags = out.tags.filter(isTag);
    if (tags.length) filters.tags = tags;
    if (out.sort) filters.sort = out.sort;
    if (out.wantsTrusted) filters.minClarity = 70;
    if (out.keywords) filters.q = out.keywords;
    return filters;
  } catch (err) {
    console.warn("[ai] search parse failed, using rules:", (err as Error).message);
    return parseWithRules(query);
  }
}

const LlmDigestSchema = z.object({
  summary: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
});

/** Used by the offline `ai:digests` script. Falls back to the heuristic digest. */
export async function digestWithClaude(
  productName: string,
  reviews: { rating: number; body: string }[],
): Promise<z.infer<typeof LlmDigestSchema> | null> {
  const fallback = () => {
    const { summary, pros, cons } = heuristicDigest(reviews.map((r) => ({ ...r, isSuspicious: false })));
    return { summary, pros, cons };
  };
  if (!aiEnabled()) return fallback();
  const reviewText = reviews.map((r) => `${r.rating}★ ${r.body}`).join("\n");
  try {
    const { client, zodOutputFormat } = await loadSdk();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      system:
        "Summarise genuine customer reviews for a shopper. Be balanced and specific. " +
        "Give a two-sentence summary, up to 3 short pros and up to 2 short cons (each under 8 words). " +
        "Only state what the reviews support.",
      output_config: { effort: "low", format: zodOutputFormat(LlmDigestSchema) },
      messages: [{ role: "user", content: `Product: ${productName}\n\nReviews:\n${reviewText}` }],
    });
    return response.stop_reason === "end_turn" ? response.parsed_output : fallback();
  } catch (err) {
    console.warn(`[ai] digest failed for ${productName}:`, (err as Error).message);
    return fallback();
  }
}
