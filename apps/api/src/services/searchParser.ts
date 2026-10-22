import { CATEGORIES, type Category, type SearchFilters, type Tag } from "@clearcart/shared";

const CATEGORY_WORDS: Record<Category, RegExp> = {
  shoes: /\b(shoes?|sneakers?|boots?|runners?|trainers?|footwear)\b/,
  apparel: /\b(shirts?|tees?|t-shirts?|jackets?|hoodies?|pants|leggings|shorts|tops?|clothes|clothing)\b/,
  bags: /\b(bags?|backpacks?|totes?|duffels?|duffles?)\b/,
  tech: /\b(headphones|earbuds|chargers?|speakers?|power ?banks?|tech|gadgets?)\b/,
};

const TAG_WORDS: Record<Tag, RegExp> = {
  running: /\b(running|run|jog(ging)?|marathon)\b/,
  trail: /\b(trail|hiking|hike)\b/,
  "wide-fit": /\bwide\b/,
  waterproof: /\b(waterproof|rain|water-?resistant)\b/,
  vegan: /\bvegan\b/,
  lightweight: /\b(light|lightweight)\b/,
  cushioned: /\b(cushion(ed|ing)?|comfy|comfortable)\b/,
  "organic-cotton": /\borganic\b/,
  breathable: /\bbreathable\b/,
  laptop: /\blaptop\b/,
  travel: /\b(travel|trip|carry-?on)\b/,
  wireless: /\b(wireless|bluetooth)\b/,
  "noise-cancelling": /\b(noise[- ]?cancel(l)?ing|anc)\b/,
  "fast-charging": /\b(fast[- ]?charg(e|ing))\b/,
};

/** Rule-based parser. Always available, so search works offline and when the AI call fails. */
export function parseWithRules(query: string): SearchFilters {
  const text = query.toLowerCase();
  const filters: SearchFilters = {};

  // Optional currency: "RM100", "rm 100", "$100" or a bare "100" (text is lowercased).
  const cur = String.raw`(?:rm\s*|\$)?`;
  const range = text.match(new RegExp(String.raw`${cur}(\d+)\s*(?:-|to)\s*${cur}(\d+)`));
  const max = text.match(new RegExp(String.raw`(?:under|below|less than|<|max|up to|cheaper than)\s*${cur}(\d+)`));
  const min = text.match(new RegExp(String.raw`(?:over|above|more than|>|min|at least)\s*${cur}(\d+)`));
  if (range?.[1] && range[2]) {
    filters.minPrice = Number(range[1]);
    filters.maxPrice = Number(range[2]);
  }
  if (max?.[1]) filters.maxPrice = Number(max[1]);
  if (min?.[1]) filters.minPrice = Number(min[1]);

  const category = CATEGORIES.find((c) => CATEGORY_WORDS[c].test(text));
  if (category) filters.category = category;

  const tags = (Object.keys(TAG_WORDS) as Tag[]).filter((t) => TAG_WORDS[t].test(text));
  if (tags.length) filters.tags = tags;

  if (/\b(cheapest|cheap|budget|affordable)\b/.test(text)) filters.sort = "price-asc";
  if (/\b(best|trusted|honest|reliable|legit)\b/.test(text)) {
    filters.minClarity = 70;
    filters.sort = "clarity";
  }

  // Nothing recognised: fall back to a plain text match on name/brand.
  if (Object.keys(filters).length === 0) filters.q = query.trim();
  return filters;
}
