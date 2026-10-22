import type { SearchParseResponse } from "@clearcart/shared";
import { aiEnabled, parseWithClaude } from "./ai";
import { parseWithRules } from "./searchParser";

const cache = new Map<string, SearchParseResponse>();

export async function parseSearch(query: string): Promise<SearchParseResponse> {
  const key = query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const fromClaude = aiEnabled() ? await parseWithClaude(query) : null;
  const result: SearchParseResponse = fromClaude
    ? { filters: fromClaude, parsedBy: "claude" }
    : { filters: parseWithRules(query), parsedBy: "rules" };

  cache.set(key, result);
  return result;
}
