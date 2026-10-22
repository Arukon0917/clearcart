import {
  FIT_CATEGORIES,
  type Category,
  type ProductDetail,
  type ProductListResponse,
  type ProductSummary,
  type SearchFilters,
} from "@clearcart/shared";
import { findAllProducts, type ProductRecord } from "../repositories/catalogRepository";
import { notFound } from "../errors";
import { clarityScore } from "./clarityScore";
import { fitStats, type FitLabel } from "./fitRecommender";
import { priceBreakdown } from "./pricing";
import { sellerTrust } from "./trustScore";

export interface CatalogEntry {
  record: ProductRecord;
  detail: ProductDetail;
}

const CATEGORY_LABELS: Record<Category, string> = {
  shoes: "shoes",
  apparel: "clothing",
  bags: "bags",
  tech: "tech",
};

/**
 * The one thumbnail rule (catalog cards, cart, seller list): the image marked as thumbnail, else the
 * first by sort order. null means no photos, and the UI falls back to the generated imageHue art.
 */
export function thumbnailOf(images: { url: string; isThumbnail: boolean }[]): string | null {
  return (images.find((i) => i.isThumbnail) ?? images[0])?.url ?? null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Scores every product. Scores depend on siblings (category medians, seller-wide reviews). */
export function buildCatalog(records: ProductRecord[]): CatalogEntry[] {
  const prices = new Map(records.map((r) => [r.id, priceBreakdown(r.priceCents, r.shippingCents)]));

  const medianByCategory = new Map<string, number>();
  for (const category of new Set(records.map((r) => r.category))) {
    const inCategory = records.filter((r) => r.category === category);
    medianByCategory.set(category, median(inCategory.map((r) => prices.get(r.id)!.allInCents)));
  }

  const sellerReviews = new Map<string, { verified: number; total: number }>();
  for (const r of records) {
    const acc = sellerReviews.get(r.sellerId) ?? { verified: 0, total: 0 };
    acc.total += r.reviews.length;
    acc.verified += r.reviews.filter((rv) => rv.verified).length;
    sellerReviews.set(r.sellerId, acc);
  }

  return records.map((record) => {
    const category = record.category as Category;
    const price = prices.get(record.id)!;
    const sellerCounts = sellerReviews.get(record.sellerId)!;
    const trust = sellerTrust({
      onTimeRate: record.seller.onTimeRate,
      returnRate: record.seller.returnRate,
      verifiedReviews: sellerCounts.verified,
      totalReviews: sellerCounts.total,
    });

    const genuine = record.reviews.filter((r) => !r.isSuspicious);
    const suspicious = record.reviews.length - genuine.length;
    const stats = FIT_CATEGORIES.includes(category)
      ? fitStats(record.fitFeedback.map((f) => ({ ...f, fit: f.fit as FitLabel })))
      : null;

    const clarity = clarityScore({
      totalReviews: record.reviews.length,
      suspiciousReviews: suspicious,
      sellerTrust: trust.score,
      fitStats: stats,
      allInCents: price.allInCents,
      categoryMedianCents: medianByCategory.get(record.category)!,
      categoryLabel: CATEGORY_LABELS[category],
    });

    // The rating shoppers see excludes reviews we flagged as fake.
    const rating = genuine.length
      ? Math.round((genuine.reduce((s, r) => s + r.rating, 0) / genuine.length) * 10) / 10
      : 0;

    const detail: ProductDetail = {
      id: record.id,
      slug: record.slug,
      name: record.name,
      brand: record.brand,
      category,
      imageHue: record.imageHue,
      tags: record.tags.split(",").filter(Boolean),
      price,
      rating,
      reviewCount: genuine.length,
      clarityScore: clarity.score,
      sellerName: record.seller.name,
      sellerTrust: trust.score,
      thumbnailUrl: thumbnailOf(record.images),
      images: record.images.map((i) => ({ url: i.url, isThumbnail: i.isThumbnail, alt: i.alt })),
      description: record.description,
      sizes: record.variants.map((v) => ({ size: v.size, inStock: v.stock > 0 })),
      clarity,
      seller: { id: record.seller.id, name: record.seller.name, trust },
      digest: record.digest
        ? {
            summary: record.digest.summary,
            pros: JSON.parse(record.digest.pros) as string[],
            cons: JSON.parse(record.digest.cons) as string[],
            suspiciousCount: record.digest.suspiciousCount,
            generatedBy: record.digest.generatedBy as "heuristic" | "claude",
          }
        : null,
      reviews: record.reviews.map((r) => ({
        id: r.id,
        author: r.author,
        rating: r.rating,
        title: r.title,
        body: r.body,
        verified: r.verified,
        isSuspicious: r.isSuspicious,
        suspicionReason: r.suspicionReason,
        createdAt: r.createdAt.toISOString(),
      })),
      fitStats: stats,
    };
    return { record, detail };
  });
}

let catalog: Promise<CatalogEntry[]> | null = null;

/** Memoised: re-seeding requires an API restart. */
export function getCatalog(): Promise<CatalogEntry[]> {
  catalog ??= findAllProducts().then(buildCatalog);
  return catalog;
}

/** Call after any product write so the next read re-scores the catalog. */
export function invalidateCatalog(): void {
  catalog = null;
}

export function toSummary(d: ProductDetail): ProductSummary {
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    brand: d.brand,
    category: d.category,
    imageHue: d.imageHue,
    tags: d.tags,
    price: d.price,
    rating: d.rating,
    reviewCount: d.reviewCount,
    clarityScore: d.clarityScore,
    sellerName: d.sellerName,
    sellerTrust: d.sellerTrust,
    thumbnailUrl: d.thumbnailUrl,
  };
}

export function filterProducts(entries: ProductDetail[], f: SearchFilters): ProductDetail[] {
  const q = f.q?.toLowerCase();
  const result = entries.filter(
    (p) =>
      (!f.category || p.category === f.category) &&
      (!f.maxPrice || p.price.allInCents <= f.maxPrice * 100) &&
      (!f.minPrice || p.price.allInCents >= f.minPrice * 100) &&
      (!f.tags?.length || f.tags.every((t) => p.tags.includes(t))) &&
      (!f.minClarity || p.clarityScore >= f.minClarity) &&
      (!q || `${p.name} ${p.brand}`.toLowerCase().includes(q)),
  );

  switch (f.sort) {
    case "price-asc":
      return result.sort((a, b) => a.price.allInCents - b.price.allInCents);
    case "price-desc":
      return result.sort((a, b) => b.price.allInCents - a.price.allInCents);
    case "clarity":
      return result.sort((a, b) => b.clarityScore - a.clarityScore);
    default:
      // Relevance: trustworthy, well-reviewed products first.
      return result.sort(
        (a, b) => b.clarityScore + b.rating * 5 - (a.clarityScore + a.rating * 5),
      );
  }
}

/** `sellerId` limits the list to one seller's products (a logged-in seller only sees their own). */
export async function listProducts(filters: SearchFilters, sellerId?: string): Promise<ProductListResponse> {
  const entries = await getCatalog();
  const items = filterProducts(
    entries.filter((e) => sellerId === undefined || e.record.sellerId === sellerId).map((e) => e.detail),
    filters,
  ).map(toSummary);
  return { items, total: items.length };
}

export async function getProductEntry(idOrSlug: string): Promise<CatalogEntry> {
  const entries = await getCatalog();
  const entry = entries.find((e) => e.record.slug === idOrSlug || e.record.id === idOrSlug);
  if (!entry) throw notFound("Product");
  return entry;
}
