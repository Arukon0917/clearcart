import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { BadgeCheck, Pencil, Ruler, ShieldAlert, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import type { ProductDetail } from "@clearcart/shared";
import { api, ApiError, money } from "../lib/api";
import { useAuth } from "../lib/auth";

/** Shown only to buyers with a delivered order for this product (or an existing review to edit). */
function ReviewForm({ product }: { product: ProductDetail }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { hash } = useLocation();
  const ref = useRef<HTMLFormElement>(null);
  const allowed = useQuery({
    queryKey: ["can-review", product.id, user?.id],
    queryFn: () => api.canReview(product.id),
    enabled: user?.role === "BUYER",
    staleTime: 0,
  });
  const existing = allowed.data?.review ?? null;
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (existing) {
      setRating(existing.rating);
      setBody(existing.body);
    }
  }, [existing?.id]);

  // Order pages link here with #write-review; the form only exists once the check has loaded.
  useEffect(() => {
    if (hash === "#write-review" && allowed.data?.canReview) ref.current?.scrollIntoView({ behavior: "smooth" });
  }, [hash, allowed.data?.canReview]);

  const save = useMutation({
    mutationFn: () =>
      existing ? api.updateReview(existing.id, { rating, body }) : api.createReview(product.id, { rating, body }),
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["product"] });
      queryClient.invalidateQueries({ queryKey: ["can-review", product.id] });
    },
  });

  if (!allowed.data?.canReview) return null;
  const fieldError = (path: string) =>
    save.error instanceof ApiError ? save.error.details?.find((d) => d.path === path)?.message : undefined;

  return (
    <form
      ref={ref}
      id="write-review"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate();
      }}
      className="rounded-card border border-line bg-surface p-4"
    >
      <h2 className="font-semibold">{existing ? "Edit your review" : "Write a review"}</h2>
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setRating(n)}>
            <Star className={`size-7 ${n <= rating ? "fill-star text-star" : "text-line-strong"}`} />
          </button>
        ))}
      </div>
      {fieldError("rating") && <p className="text-sm text-bad">{fieldError("rating")}</p>}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={1000}
        placeholder="How did it fit, feel and hold up?"
        className="mt-3 w-full rounded-lg border border-line-strong px-3 py-2 text-sm"
      />
      <p className="flex justify-between text-xs text-muted">
        <span className="text-bad">{fieldError("body")}</span>
        <span>{body.trim().length}/1000</span>
      </p>
      {save.isError && !fieldError("rating") && !fieldError("body") && <p className="text-sm text-bad">{save.error.message}</p>}
      {saved && <p role="status" className="text-sm text-brand-700">Thanks! Your review is live.</p>}
      <button
        disabled={save.isPending || rating === 0 || body.trim().length < 10}
        className="mt-2 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-50"
      >
        {save.isPending ? "Saving…" : existing ? "Update review" : "Post review"}
      </button>
    </form>
  );
}
import { useCompare } from "../lib/stores";
import { useCart } from "../lib/cart";
import { ClarityBadge, ProductImage, ScoreBreakdownPanel, Stars } from "../components";

function FitFinder({ product, onPick }: { product: ProductDetail; onPick: (size: string) => void }) {
  const [heightCm, setHeight] = useState(175);
  const [weightKg, setWeight] = useState(70);
  const [usualSize, setUsual] = useState(product.sizes[Math.floor(product.sizes.length / 2)]?.size ?? "");
  const fit = useMutation({ mutationFn: api.recommendFit, onSuccess: (r) => onPick(r.recommendedSize) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    fit.mutate({ productId: product.id, heightCm, weightKg, usualSize });
  };
  const input = "w-full rounded-lg border border-line-strong bg-surface px-3 py-2";

  return (
    <form onSubmit={submit} className="rounded-card border border-brand-100 bg-brand-50 p-4">
      <p className="flex items-center gap-2 font-semibold"><Ruler className="size-4" /> Find my size</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <label>Height (cm)<input type="number" min={120} max={230} value={heightCm} onChange={(e) => setHeight(Number(e.target.value))} className={input} /></label>
        <label>Weight (kg)<input type="number" min={30} max={200} value={weightKg} onChange={(e) => setWeight(Number(e.target.value))} className={input} /></label>
        <label>Usual size
          <select value={usualSize} onChange={(e) => setUsual(e.target.value)} className={input}>
            {product.sizes.map((s) => <option key={s.size}>{s.size}</option>)}
          </select>
        </label>
      </div>
      <button disabled={fit.isPending} className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas disabled:opacity-60">
        {fit.isPending ? "Checking…" : "Recommend a size"}
      </button>
      {fit.data && (
        <p className="mt-3 text-sm" role="status">
          <span className="text-lg font-bold">Size {fit.data.recommendedSize}</span>{" "}
          <span className="font-medium text-brand-700">· {fit.data.confidence}% confident</span>
          <br />
          <span className="text-muted">{fit.data.reason}</span>
        </p>
      )}
      {fit.isError && <p className="mt-3 text-sm text-bad">{fit.error.message}</p>}
    </form>
  );
}

export function ProductPage() {
  const { slug = "" } = useParams();
  const { user, loading } = useAuth();
  // Scoped to the session on the API (a seller only gets their own products), so the key carries the user.
  const { data: p, isPending, isError } = useQuery({
    queryKey: ["product", slug, user?.id],
    queryFn: () => api.product(slug),
    enabled: !loading,
  });
  const isSeller = user?.role === "SELLER";
  const [size, setSize] = useState<string | null>(null);
  const [showFiltered, setShowFiltered] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const { add: addToCart } = useCart();
  const { items: compared, toggle } = useCompare();

  if (isPending) return <div className="h-96 animate-pulse rounded-card bg-line" />;
  if (isError || !p) return <p className="text-bad">Product not found. <Link to="/" className="underline">Back to shop</Link></p>;

  const needsSize = p.sizes.length > 0;
  const reviews = p.reviews.filter((r) => showFiltered || !r.isSuspicious);
  const add = async () => {
    // Failures (sold out, already at the max) are shown as a toast by the cart hook.
    if (!(await addToCart({ productId: p.id, size: needsSize ? size : null, qty: 1, priceCents: p.price.itemCents }))) return;
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <ProductImage hue={p.imageHue} category={p.category} gallery={p.images} alt={p.name} className="aspect-square md:sticky md:top-20" />

      <div className="space-y-5">
        <div>
          <p className="text-sm text-muted">{p.brand}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{p.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ClarityBadge score={p.clarityScore} breakdown={p.clarity} />
            <Stars rating={p.rating} count={p.reviewCount} />
          </div>
          <p className="mt-3 text-muted">{p.description}</p>
        </div>

        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-3xl font-bold">{money(p.price.allInCents)}</p>
          <p className="text-sm text-muted">Price you pay. No surprises at checkout.</p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-muted">Item</dt><dd>{money(p.price.itemCents)}</dd></div>
            <div><dt className="text-muted">Shipping</dt><dd>{p.price.shippingCents ? money(p.price.shippingCents) : "Free"}</dd></div>
            <div><dt className="text-muted">Tax (est.)</dt><dd>{money(p.price.taxCents)}</dd></div>
          </dl>
        </div>

        {needsSize && !isSeller && (
          <>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Size</legend>
              <div className="flex flex-wrap gap-2">
                {p.sizes.map((s) => (
                  <button key={s.size} type="button" disabled={!s.inStock} onClick={() => setSize(s.size)} aria-pressed={size === s.size}
                    className={`min-w-11 rounded-lg border px-3 py-2 text-sm ${size === s.size ? "border-brand-600 bg-brand-600 text-on-accent" : "border-line-strong bg-surface"} disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}>
                    {s.size}
                  </button>
                ))}
              </div>
              {p.sizes.some((s) => !s.inStock) && (
                <p className="mt-2 text-xs text-muted">
                  Out of stock: {p.sizes.filter((s) => !s.inStock).map((s) => s.size).join(", ")}
                </p>
              )}
            </fieldset>
            <FitFinder product={p} onPick={setSize} />
          </>
        )}

        {isSeller && (
          // The API only returns a seller's own products, so whatever they see here is theirs.
          <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-subtle px-4 py-3">
            <p className="text-sm text-muted">You're viewing as a seller.</p>
            <Link to={`/seller/products/${p.id}/edit`} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-subtle">
              <Pencil className="size-4" /> Edit product
            </Link>
          </div>
        )}

        <div className="flex gap-2">
          {!isSeller && <button type="button" onClick={add} disabled={needsSize && !size} className="flex-1 rounded-xl bg-brand-600 py-3 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-50">
            {added ? "Added ✓" : needsSize && !size ? "Pick a size" : "Add to cart"}
          </button>}
          <button type="button" onClick={() => toggle(p)} className="rounded-xl border border-line-strong bg-surface px-4 font-medium">
            {compared.some((c) => c.id === p.id) ? "Comparing" : "Compare"}
          </button>
        </div>

        <div className="relative">
          <button type="button" onClick={() => setTrustOpen((o) => !o)} className="flex items-center gap-2 text-sm">
            <BadgeCheck className="size-4 text-brand-600" /> Sold by <span className="font-semibold underline">{p.seller.name}</span> · trust {p.seller.trust.score}/100
          </button>
          {trustOpen && <ScoreBreakdownPanel title={`${p.seller.name} trust`} breakdown={p.seller.trust} onClose={() => setTrustOpen(false)} />}
        </div>

        {p.digest && (
          <section className="rounded-card border border-line bg-surface p-4">
            <h2 className="font-semibold">Review digest {p.digest.generatedBy === "claude" && <span className="text-xs font-normal text-muted">· AI summary</span>}</h2>
            <p className="mt-1 text-sm">{p.digest.summary}</p>
            <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <ul className="space-y-1">{p.digest.pros.map((x) => <li key={x} className="flex gap-2"><ThumbsUp className="size-4 shrink-0 text-brand-600" />{x}</li>)}</ul>
              <ul className="space-y-1">{p.digest.cons.map((x) => <li key={x} className="flex gap-2"><ThumbsDown className="size-4 shrink-0 text-bad" />{x}</li>)}</ul>
            </div>
            {p.digest.suspiciousCount > 0 && (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                <ShieldAlert className="size-4" /> {p.digest.suspiciousCount} suspicious review{p.digest.suspiciousCount === 1 ? "" : "s"} filtered out
              </p>
            )}
          </section>
        )}

        <ReviewForm product={p} />

        <section>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Reviews</h2>
            {p.digest && p.digest.suspiciousCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={showFiltered} onChange={(e) => setShowFiltered(e.target.checked)} className="accent-brand-600" />
                Show filtered
              </label>
            )}
          </div>
          <ul className="mt-3 space-y-3">
            {reviews.slice(0, 12).map((r) => (
              <li key={r.id} className={`rounded-xl border p-3 text-sm ${r.isSuspicious ? "border-warn-line bg-warn-soft" : "border-line bg-surface"}`}>
                <div className="flex justify-between">
                  <span className="font-medium">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} {r.title}</span>
                  {r.verified ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                      <BadgeCheck className="size-3.5" /> Verified purchase
                    </span>
                  ) : (
                    <span className="text-xs text-muted">Unverified</span>
                  )}
                </div>
                <p className="mt-1">{r.body}</p>
                <p className="mt-1 text-xs text-muted">{r.author}{r.isSuspicious && r.suspicionReason && <span className="text-warn"> · Flagged: {r.suspicionReason}</span>}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
