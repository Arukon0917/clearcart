import { z } from "zod";
import type { Category } from "./product";

/** Per-line cap on top of stock, so a typo can't order 1000 pairs. */
export const MAX_QTY = 10;
const Qty = z.number({ error: "Enter a quantity" }).int().min(1, "Quantity must be at least 1").max(MAX_QTY, `At most ${MAX_QTY} per item`);
const Ids = z.array(z.string().min(1)).min(1, "Pick at least one item").max(100);

export const CartItemSchema = z.object({
  productId: z.string(),
  size: z.string().nullable(),
  quantity: Qty,
});
export type CartItem = z.infer<typeof CartItemSchema>;

export const AddCartItemSchema = z.object({ productId: z.string().min(1), size: z.string().nullable(), qty: Qty });
export type AddCartItem = z.infer<typeof AddCartItemSchema>;

export const UpdateCartItemSchema = z
  .object({ qty: Qty.optional(), selected: z.boolean().optional() })
  .refine((u) => u.qty !== undefined || u.selected !== undefined, "Nothing to update");
export type UpdateCartItem = z.infer<typeof UpdateCartItemSchema>;

export const BulkSelectSchema = z.object({ ids: Ids, selected: z.boolean() });
export const BulkIdsSchema = z.object({ ids: Ids });

/** A guest cart line as kept in localStorage ("cc_cart_guest"). */
export const GuestCartItemSchema = z.object({
  productId: z.string().min(1),
  size: z.string().nullable(),
  qty: Qty,
  selected: z.boolean().default(true),
  /** Unit price seen when added, so the cart can flag price changes. */
  priceCents: z.number().int().nonnegative().optional(),
});
export type GuestCartItem = z.input<typeof GuestCartItemSchema>;
export const GuestCartSchema = z.object({ items: z.array(GuestCartItemSchema).max(50) });

export type CartLineStatus = "ok" | "out_of_stock" | "unavailable" | "price_changed";
export const isSelectable = (s: CartLineStatus) => s === "ok" || s === "price_changed";

export interface CartLineView {
  /** Server cart item id; for guests, `${productId}|${size}`. */
  id: string;
  productId: string;
  /** null when the product is no longer listed. */
  slug: string | null;
  name: string;
  category: Category | null;
  imageHue: number;
  thumbnailUrl: string | null;
  size: string | null;
  qty: number;
  selected: boolean;
  /** Current unit price; null when unavailable. */
  unitCents: number | null;
  /** Price when added, set only when it differs from the current price. */
  previousUnitCents: number | null;
  shippingCents: number;
  /** null when stock isn't tracked (products without sizes). */
  stock: number | null;
  maxQty: number;
  sellerId: string | null;
  sellerName: string;
  status: CartLineStatus;
}

export interface CartView {
  items: CartLineView[];
  /** Total quantity, for the header badge. */
  count: number;
}

export const CartQuoteRequestSchema = z.object({
  items: z.array(CartItemSchema).min(1).max(50),
});
export type CartQuoteRequest = z.infer<typeof CartQuoteRequestSchema>;

export const QuoteLineSchema = z.object({
  productId: z.string(),
  name: z.string(),
  size: z.string().nullable(),
  quantity: z.number().int(),
  unitCents: z.number().int(),
  lineCents: z.number().int(),
  shippingCents: z.number().int(),
});
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

export const CartQuoteSchema = z.object({
  lines: z.array(QuoteLineSchema),
  subtotalCents: z.number().int(),
  shippingCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
});
export type CartQuote = z.infer<typeof CartQuoteSchema>;
