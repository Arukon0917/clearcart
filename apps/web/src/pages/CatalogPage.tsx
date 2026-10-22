import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PackagePlus, Plus, Sparkles, X } from "lucide-react";
import { CATEGORIES, TAG_LABELS, isTag, type SearchFilters, type Sort } from "@clearcart/shared";
import { api, money } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ProductCard } from "../components";

const EXAMPLES = ["running shoes under RM100 for wide feet", "trusted noise cancelling headphones", "cheapest waterproof backpack"];

// Filters live in the URL so searches are shareable and survive refresh.
function readFilters(params: URLSearchParams): SearchFilters {
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  const category = params.get("category");
  return {
    q: params.get("q") ?? undefined,
    category: CATEGORIES.find((c) => c === category),
    maxPrice: num("maxPrice"),
    minPrice: num("minPrice"),
    minClarity: num("minClarity"),
    tags: params.get("tags")?.split(",").filter(Boolean),
    sort: (params.get("sort") as Sort | null) ?? undefined,
  };
}

function writeFilters(f: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    params.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return params;
}

function chipsFor(f: SearchFilters): { key: string; label: string; remove: (f: SearchFilters) => SearchFilters }[] {
  const chips = [];
  if (f.category) chips.push({ key: "category", label: f.category, remove: (x: SearchFilters) => ({ ...x, category: undefined }) });
  if (f.maxPrice) chips.push({ key: "max", label: `Under ${money(f.maxPrice * 100)} all-in`, remove: (x: SearchFilters) => ({ ...x, maxPrice: undefined }) });
  if (f.minPrice) chips.push({ key: "min", label: `Over ${money(f.minPrice * 100)}`, remove: (x: SearchFilters) => ({ ...x, minPrice: undefined }) });
  if (f.minClarity) chips.push({ key: "clarity", label: `Clarity ${f.minClarity}+`, remove: (x: SearchFilters) => ({ ...x, minClarity: undefined }) });
  if (f.q) chips.push({ key: "q", label: `"${f.q}"`, remove: (x: SearchFilters) => ({ ...x, q: undefined }) });
  for (const t of f.tags ?? []) {
    chips.push({
      key: `tag-${t}`,
      label: isTag(t) ? TAG_LABELS[t] : t,
      remove: (x: SearchFilters) => ({ ...x, tags: x.tags?.filter((y) => y !== t) }),
    });
  }
  return chips;
}

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [text, setText] = useState("");
  const setFilters = (f: SearchFilters) => setParams(writeFilters(f));
  const chips = chipsFor(filters);

  const { user, loading } = useAuth();
  const isSeller = user?.role === "SELLER";
  // The API scopes the list to the session (a seller only gets their own), so the key carries the user.
  const products = useQuery({
    queryKey: ["products", user?.id, params.toString()],
    queryFn: () => api.products(filters),
    enabled: !loading,
  });
  const parse = useMutation({ mutationFn: api.parseSearch, onSuccess: (r) => setFilters(r.filters) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) parse.mutate(text.trim());
  };
  return (
    <div>
      <section className="rounded-card bg-gradient-to-br from-brand-50 to-surface px-5 py-8 sm:px-10">
        {isSeller ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold sm:text-4xl">Your products</h1>
              <p className="mt-2 text-muted">
                {products.data ? `${products.data.total} product${products.data.total === 1 ? "" : "s"}` : "Loading…"}
                {chips.length > 0 && " match these filters"}
              </p>
            </div>
            <Link to="/seller/products/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-on-accent hover:bg-brand-700">
              <Plus className="size-4" /> Add product
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold sm:text-4xl">Shop with nothing hidden.</h1>
            <p className="mt-2 max-w-xl text-muted">
              Fake reviews filtered out, sizes predicted from real buyers, and the price you see is the price you pay.
            </p>
          </>
        )}
        <form onSubmit={submit} className="mt-5 flex max-w-2xl gap-2">
          <label htmlFor="search" className="sr-only">Describe what you want</label>
          <input
            id="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe what you want…"
            className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-4 py-3 shadow-sm focus:border-brand-600 focus:outline-none"
          />
          <button
            disabled={parse.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-3 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-60"
          >
            <Sparkles className="size-4" />
            <span className="hidden sm:inline">{parse.isPending ? "Thinking…" : "Search"}</span>
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => { setText(ex); parse.mutate(ex); }} className="rounded-full border border-line bg-surface px-3 py-1 text-muted hover:text-ink">
              {ex}
            </button>
          ))}
        </div>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {chips.length > 0 && (
          <span className="text-sm text-muted">
            {parse.data?.parsedBy === "claude" ? "AI understood:" : "Filters:"}
          </span>
        )}
        {chips.map((c) => (
          <button key={c.key} type="button" onClick={() => setFilters(c.remove(filters))} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium capitalize text-brand-700 hover:bg-brand-50" aria-label={`Remove filter ${c.label}`}>
            {c.label} <X className="size-3.5" />
          </button>
        ))}
        {chips.length > 0 && (
          <button type="button" onClick={() => setFilters({})} className="text-sm text-muted underline">Clear all</button>
        )}
        <select
          aria-label="Sort"
          value={filters.sort ?? "relevance"}
          onChange={(e) => setFilters({ ...filters, sort: e.target.value as Sort })}
          className="ml-auto rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm"
        >
          <option value="relevance">Most trustworthy</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="clarity">Clarity Score</option>
        </select>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {products.isPending &&
          Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-card bg-line" />)}
        {products.data?.items.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
      {products.data?.total === 0 && isSeller && chips.length === 0 ? (
        <div className="mt-10 text-center">
          <PackagePlus className="mx-auto size-10 text-muted" />
          <p className="mt-3 text-lg font-semibold">No products yet</p>
          <Link to="/seller/products/new" className="mt-4 inline-block rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-on-accent hover:bg-brand-700">
            Add your first product
          </Link>
        </div>
      ) : (
        products.data?.total === 0 && <p className="mt-10 text-center text-muted">Nothing matches every filter. Try removing a chip above.</p>
      )}
      {products.isError && <p className="mt-10 text-center text-bad">Couldn't load products. Is the API running?</p>}
    </div>
  );
}
