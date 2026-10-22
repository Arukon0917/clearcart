import type { PriceBreakdown } from "./schemas/product";

export const TAX_RATE = 0.08;

const ringgit = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The only money formatter: cents in, "RM 1,234.50" out. */
export function formatMoney(cents: number): string {
  return `RM ${ringgit.format(cents / 100)}`;
}

export function taxFor(cents: number): number {
  return Math.round(cents * TAX_RATE);
}

/** The "price you pay" shown on every card. Must equal a one-item cart quote to the cent. */
export function priceBreakdown(itemCents: number, shippingCents: number): PriceBreakdown {
  const taxCents = taxFor(itemCents);
  return { itemCents, shippingCents, taxCents, allInCents: itemCents + shippingCents + taxCents };
}
