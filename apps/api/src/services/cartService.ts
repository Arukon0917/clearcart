import { MAX_QTY, isSelectable, type CartLineStatus, type CartLineView, type CartView, type Category } from "@clearcart/shared";
import { prisma } from "../db";
import { getProductEntry, thumbnailOf, type CatalogEntry } from "./catalogService";

export interface ResolvedProduct {
  /** null when the product isn't in the live catalog (archived, draft or deleted). */
  entry: CatalogEntry | null;
  /** Units left in this size; null when stock isn't tracked (products without sizes). */
  stock: number | null;
  sizeOk: boolean;
}

/** Looks a cart line up in the live catalog. Never throws for missing products. */
export async function resolveProduct(productId: string, size: string | null): Promise<ResolvedProduct> {
  let entry: CatalogEntry | null = null;
  try {
    entry = await getProductEntry(productId);
  } catch {
    return { entry: null, stock: null, sizeOk: false };
  }
  const variants = entry.record.variants;
  if (variants.length === 0) return { entry, stock: null, sizeOk: !size };
  const variant = variants.find((v) => v.size === size);
  return { entry, stock: variant?.stock ?? null, sizeOk: Boolean(variant) };
}

export const maxQtyFor = (stock: number | null) => Math.min(MAX_QTY, stock ?? MAX_QTY);

export interface CartLineInput {
  id: string;
  productId: string;
  size: string | null;
  qty: number;
  selected: boolean;
  /** Unit price when added; null when unknown. */
  addedPriceCents: number | null;
}

const REASONS: Record<Exclude<CartLineStatus, "ok" | "price_changed">, string> = {
  out_of_stock: "is out of stock",
  unavailable: "is no longer available",
};
export const unavailableReason = (line: CartLineView) =>
  line.status === "out_of_stock" || line.status === "unavailable" ? `${line.name} ${REASONS[line.status]}` : null;

/** Prices, stock and status always come from the live catalog, never from what was stored or sent. */
export async function buildCartView(lines: CartLineInput[]): Promise<CartView> {
  const resolved = await Promise.all(lines.map((l) => resolveProduct(l.productId, l.size)));
  // Unlisted products aren't in the catalog; fetch just enough to show what they were.
  const missingIds = lines.filter((_, i) => !resolved[i]!.entry).map((l) => l.productId);
  const fallback = new Map(
    missingIds.length
      ? (
          await prisma.product.findMany({
            where: { id: { in: missingIds } },
            select: {
              id: true,
              name: true,
              imageHue: true,
              category: true,
              seller: { select: { name: true } },
              images: { select: { url: true, isThumbnail: true }, orderBy: { sortOrder: "asc" } },
            },
          })
        ).map((p) => [p.id, p])
      : [],
  );

  const items = lines.map((line, i): CartLineView => {
    const { entry, stock, sizeOk } = resolved[i]!;
    if (!entry || !sizeOk) {
      const old = fallback.get(line.productId);
      return {
        id: line.id,
        productId: line.productId,
        slug: null,
        name: entry?.detail.name ?? old?.name ?? "Removed product",
        category: (entry?.detail.category ?? old?.category ?? null) as Category | null,
        imageHue: entry?.detail.imageHue ?? old?.imageHue ?? 0,
        thumbnailUrl: entry?.detail.thumbnailUrl ?? (old ? thumbnailOf(old.images) : null),
        size: line.size,
        qty: line.qty,
        selected: false,
        unitCents: null,
        previousUnitCents: null,
        shippingCents: 0,
        stock: null,
        maxQty: line.qty,
        sellerId: entry?.record.sellerId ?? null,
        sellerName: entry?.detail.sellerName ?? old?.seller.name ?? "Unknown seller",
        status: "unavailable",
      };
    }
    const unit = entry.detail.price.itemCents;
    const changed = line.addedPriceCents !== null && line.addedPriceCents !== unit;
    const status: CartLineStatus = stock === 0 ? "out_of_stock" : changed ? "price_changed" : "ok";
    return {
      id: line.id,
      productId: entry.record.id,
      slug: entry.detail.slug,
      name: entry.detail.name,
      category: entry.detail.category,
      imageHue: entry.detail.imageHue,
      thumbnailUrl: entry.detail.thumbnailUrl,
      size: line.size,
      qty: line.qty,
      selected: line.selected && isSelectable(status),
      unitCents: unit,
      previousUnitCents: changed ? line.addedPriceCents : null,
      shippingCents: entry.detail.price.shippingCents,
      stock,
      maxQty: maxQtyFor(stock),
      sellerId: entry.record.sellerId,
      sellerName: entry.detail.sellerName,
      status,
    };
  });
  return { items, count: items.reduce((n, l) => n + l.qty, 0) };
}
