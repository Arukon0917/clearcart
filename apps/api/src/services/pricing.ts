import { taxFor, type CartQuote, type QuoteLine } from "@clearcart/shared";

// Shared with the web app so the seller form previews the exact same all-in price.
export { TAX_RATE, priceBreakdown, taxFor } from "@clearcart/shared";

/** Shipping is charged once per line (not per unit); tax applies to the subtotal. */
export function quoteCart(lines: Omit<QuoteLine, "lineCents">[]): CartQuote {
  const priced = lines.map((l) => ({ ...l, lineCents: l.unitCents * l.quantity }));
  const subtotalCents = priced.reduce((sum, l) => sum + l.lineCents, 0);
  const shippingCents = priced.reduce((sum, l) => sum + l.shippingCents, 0);
  const taxCents = taxFor(subtotalCents);
  return {
    lines: priced,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
  };
}
