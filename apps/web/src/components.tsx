import { useEffect, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, Footprints, Laptop, Shirt, ShoppingBag, Star, X, type LucideIcon } from "lucide-react";
import type { Category, ProductSummary, ScoreBreakdown } from "@clearcart/shared";
import { money } from "./lib/api";
import { MAX_COMPARE, useCompare } from "./lib/stores";

const ICONS: Record<Category, LucideIcon> = {
  shoes: Footprints,
  apparel: Shirt,
  bags: ShoppingBag,
  tech: Laptop,
};

interface GalleryImage {
  url: string;
  isThumbnail: boolean;
  alt?: string | null;
}

/** Fixed-position notice that dismisses itself. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return (
    <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-canvas shadow-xl">
      <CheckCircle2 className="size-4 text-brand-100" /> {message}
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onCancel}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-card bg-surface p-5 shadow-xl">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={pending} className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium hover:bg-subtle">Cancel</button>
          <button type="button" onClick={onConfirm} disabled={pending} autoFocus className="rounded-lg bg-bad px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-60">
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Gallery({ images, alt, className }: { images: GalleryImage[]; alt: string; className: string }) {
  const [active, setActive] = useState(() => Math.max(0, images.findIndex((i) => i.isThumbnail)));
  const [enlarged, setEnlarged] = useState(false);
  const current = images[active] ?? images[0]!;
  const altFor = (img: GalleryImage, i: number) => img.alt || `${alt}, photo ${i + 1}`;
  const step = (delta: number) => setActive((a) => (a + delta + images.length) % images.length);
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "Escape") setEnlarged(false);
    else return;
    e.preventDefault();
  };

  return (
    <div className={`h-fit ${className}`} tabIndex={0} onKeyDown={onKey} aria-label={`${alt} photos. Use arrow keys to browse.`}>
      <button type="button" onClick={() => setEnlarged(true)} className="block w-full cursor-zoom-in" aria-label="Enlarge photo">
        <img src={current.url} alt={altFor(current, active)} className="aspect-square w-full rounded-card bg-surface object-cover" />
      </button>
      {enlarged && (
        <div role="dialog" aria-modal="true" aria-label="Enlarged photo" tabIndex={-1} ref={(el) => el?.focus()} onKeyDown={onKey}
          onClick={() => setEnlarged(false)} className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4">
          <img src={current.url} alt={altFor(current, active)} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          <button type="button" onClick={() => setEnlarged(false)} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-surface/90 p-2"><X className="size-5" /></button>
          {images.length > 1 && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label="Previous photo" className="absolute left-4 rounded-full bg-surface/90 p-2"><ChevronLeft className="size-5" /></button>
              <button type="button" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label="Next photo" className="absolute right-4 rounded-full bg-surface/90 p-2"><ChevronRight className="size-5" /></button>
            </>
          )}
        </div>
      )}
      {images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Show photo ${i + 1}`}
              aria-current={i === active}
              className={`size-16 shrink-0 overflow-hidden rounded-lg border-2 ${i === active ? "border-brand-600" : "border-transparent"}`}
            >
              <img src={img.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Product media: a photo when the seller uploaded one (`src`), a clickable gallery (`gallery`),
 * or offline-friendly art (a tinted tile with the category icon) for products without photos.
 */
export function ProductImage({
  hue,
  category,
  src,
  gallery,
  alt = "",
  className = "",
}: {
  hue: number;
  category: Category;
  src?: string | null;
  gallery?: GalleryImage[];
  alt?: string;
  className?: string;
}) {
  if (gallery?.length) return <Gallery images={gallery} alt={alt} className={className} />;
  if (src) return <img src={src} alt={alt} loading="lazy" className={`w-full rounded-card bg-surface object-cover ${className}`} />;
  const Icon = ICONS[category];
  return (
    <div
      className={`grid place-items-center rounded-card ${className}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 92%), hsl(${(hue + 40) % 360} 55% 82%))` }}
      aria-hidden
    >
      <Icon className="size-1/3" style={{ color: `hsl(${hue} 45% 35%)` }} strokeWidth={1.5} />
    </div>
  );
}

export const scoreTone = (score: number) =>
  score >= 75 ? "bg-brand-600 text-on-accent" : score >= 55 ? "bg-caution text-on-accent" : "bg-bad text-on-accent";

/** The Clarity Score badge. Click to see exactly how it was calculated. */
export function ClarityBadge({ score, breakdown }: { score: number; breakdown?: ScoreBreakdown }) {
  const [open, setOpen] = useState(false);
  const badge = (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${scoreTone(score)}`}>
      Clarity {score}
    </span>
  );
  if (!breakdown) return badge;
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-full">
        {badge}
      </button>
      {open && <ScoreBreakdownPanel title="How we scored this" breakdown={breakdown} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ScoreBreakdownPanel({ title, breakdown, onClose }: { title: string; breakdown: ScoreBreakdown; onClose: () => void }) {
  return (
    <div role="dialog" aria-label={title} className="absolute left-0 z-30 mt-2 w-80 rounded-card border border-line bg-surface p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">{title}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-raised">
          <X className="size-4" />
        </button>
      </div>
      <ul className="space-y-3">
        {breakdown.components.map((c) => (
          <li key={c.key}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{c.label}</span>
              <span className="text-muted">
                {c.score} · {Math.round(c.weight * 100)}% weight
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-raised">
              <div className={`h-full rounded-full ${scoreTone(c.score)}`} style={{ width: `${c.score}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">{c.explanation}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stars({ rating, count }: { rating: number; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-muted">
      <Star className="size-4 fill-star text-star" />
      <span className="font-medium text-ink">{rating.toFixed(1)}</span>({count} genuine)
    </span>
  );
}

export function ProductCard({ product }: { product: ProductSummary }) {
  const { items, toggle } = useCompare();
  const comparing = items.some((i) => i.id === product.id);
  return (
    <article className="group flex flex-col rounded-card border border-line bg-surface p-3 transition hover:shadow-lg">
      <Link to={`/p/${product.slug}`} className="block">
        <ProductImage hue={product.imageHue} category={product.category} src={product.thumbnailUrl} alt={product.name} className="aspect-square" />
        <div className="mt-3 flex items-center justify-between">
          <ClarityBadge score={product.clarityScore} />
          <Stars rating={product.rating} count={product.reviewCount} />
        </div>
        <h3 className="mt-2 font-semibold leading-snug group-hover:text-brand-700">{product.name}</h3>
        <p className="text-xs text-muted">Sold by {product.sellerName}</p>
      </Link>
      <div className="mt-auto flex items-end justify-between pt-3">
        <div>
          <p className="text-lg font-bold">{money(product.price.allInCents)}</p>
          <p className="text-xs text-muted">Price you pay · incl. shipping & tax</p>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={comparing}
            disabled={!comparing && items.length >= MAX_COMPARE}
            onChange={() => toggle(product)}
            className="accent-brand-600"
          />
          Compare
        </label>
      </div>
    </article>
  );
}
