import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronUp, X } from "lucide-react";
import type { ProductSummary } from "@clearcart/shared";
import { money } from "./lib/api";
import { useCompare } from "./lib/stores";
import { ProductImage, scoreTone } from "./components";

interface Row {
  label: string;
  value: (p: ProductSummary) => number;
  format: (p: ProductSummary) => string;
  best: "min" | "max";
}

const ROWS: Row[] = [
  { label: "Price you pay", value: (p) => p.price.allInCents, format: (p) => money(p.price.allInCents), best: "min" },
  { label: "Clarity Score", value: (p) => p.clarityScore, format: (p) => String(p.clarityScore), best: "max" },
  { label: "Honest rating", value: (p) => p.rating, format: (p) => `${p.rating.toFixed(1)}★ (${p.reviewCount})`, best: "max" },
  { label: "Seller trust", value: (p) => p.sellerTrust, format: (p) => `${p.sellerTrust} · ${p.sellerName}`, best: "max" },
  { label: "Shipping", value: (p) => p.price.shippingCents, format: (p) => (p.price.shippingCents ? money(p.price.shippingCents) : "Free"), best: "min" },
];

export function CompareDrawer() {
  const { items, toggle, clear } = useCompare();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 shadow-[0_-8px_30px_var(--color-shadow)] backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-2 font-semibold"
          >
            <ChevronUp className={`size-5 transition ${open ? "rotate-180" : ""}`} />
            Compare {items.length} item{items.length === 1 ? "" : "s"}
          </button>
          <button type="button" onClick={clear} className="text-sm text-muted hover:text-ink">
            Clear
          </button>
        </div>

        {open && (
          <div className="mt-3 max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr>
                  <th className="w-36" />
                  {items.map((p) => (
                    <th key={p.id} className="p-2 text-left align-top font-normal">
                      <div className="flex items-start gap-2">
                        <ProductImage hue={p.imageHue} category={p.category} className="size-12 shrink-0" />
                        <Link to={`/p/${p.slug}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.name}`} className="ml-auto text-muted">
                          <X className="size-4" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const values = items.map(row.value);
                  const best = row.best === "min" ? Math.min(...values) : Math.max(...values);
                  return (
                    <tr key={row.label} className="border-t border-line-soft">
                      <th className="p-2 text-left font-medium text-muted">{row.label}</th>
                      {items.map((p) => {
                        const isBest = items.length > 1 && row.value(p) === best;
                        return (
                          <td key={p.id} className={`p-2 ${isBest ? "font-semibold text-brand-700" : ""}`}>
                            {row.label === "Clarity Score" ? (
                              <span className={`rounded-full px-2 py-0.5 text-xs ${scoreTone(p.clarityScore)}`}>{row.format(p)}</span>
                            ) : (
                              row.format(p)
                            )}
                            {isBest && <span className="ml-1 text-xs">✓ best</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
