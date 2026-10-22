/**
 * Shared helpers for the test-seller scripts (seed-seller.ts, delete-seller.ts): deterministic PRNG,
 * product/review generator, SVG product art, and safe upload paths. Moved from seed-seller2.ts.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient, User } from "@prisma/client";
import bcrypt from "bcryptjs";
import type { Category, Tag } from "@clearcart/shared";
import { detectSuspicious } from "../src/services/reviewSignals";
import { heuristicDigest } from "../src/services/reviewDigest";

export const BCRYPT_ROUNDS = 12;
export const IMAGES_PER_PRODUCT = 3;
export const UPLOAD_ROOT = fileURLToPath(new URL("../uploads/", import.meta.url));
export const SEED_DIR = join(UPLOAD_ROOT, "seed");

// Deterministic PRNG (same as seed.ts) so reruns produce the same catalog.
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const daysAgo = (d: number, hours = 0) => new Date(Date.now() - d * 86_400_000 - hours * 3_600_000);

/** Short, stable product-id prefix per seller email, so two test sellers never collide. */
export const idPrefixFor = (email: string) => `t${createHash("sha256").update(email).digest("hex").slice(0, 6)}`;

// ---------------------------------------------------------------------------
// Product templates. Categories are the ones the catalog already uses.
// ---------------------------------------------------------------------------
type Kind = "running" | "sneaker" | "sandal" | "apparel" | "bag";

interface KindSpec {
  category: Category;
  types: string[];
  tags: Tag[];
  price: [number, number];
  sizes: string[] | null;
  hue: number;
  blurb: string[];
}

const KINDS: Record<Kind, KindSpec> = {
  running: {
    category: "shoes",
    types: ["Running Shoe", "Road Runner", "Tempo Trainer"],
    tags: ["running", "cushioned", "lightweight", "breathable", "wide-fit"],
    price: [129, 459],
    sizes: ["6", "7", "8", "9", "10", "11"],
    hue: 205,
    blurb: ["A responsive foam midsole keeps easy and tempo runs feeling light.", "The engineered mesh upper breathes well on humid mornings."],
  },
  sneaker: {
    category: "shoes",
    types: ["Court Sneaker", "Everyday Sneaker", "Low-Top"],
    tags: ["lightweight", "vegan", "wide-fit", "cushioned"],
    price: [129, 329],
    sizes: ["6", "7", "8", "9", "10", "11"],
    hue: 25,
    blurb: ["A clean everyday silhouette that pairs with almost anything.", "The padded collar and cupsole make all-day wear comfortable."],
  },
  sandal: {
    category: "shoes",
    types: ["Slide Sandal", "Trail Sandal", "Strap Sandal"],
    tags: ["waterproof", "lightweight", "vegan"],
    price: [129, 219],
    sizes: ["6", "7", "8", "9", "10", "11"],
    hue: 165,
    blurb: ["Quick-drying straps and a contoured footbed for warm days.", "Grippy rubber outsole handles wet pavements and pool decks."],
  },
  apparel: {
    category: "apparel",
    types: ["Running Tee", "Training Shorts", "Windbreaker", "Hoodie", "Track Pants"],
    tags: ["breathable", "organic-cotton", "lightweight", "running", "waterproof"],
    price: [39, 189],
    sizes: ["S", "M", "L", "XL"],
    hue: 280,
    blurb: ["Soft, breathable fabric that moves with you from workout to weekend.", "Flatlock seams reduce chafing on longer sessions."],
  },
  bag: {
    category: "bags",
    types: ["Daypack", "Sling Bag", "Laptop Backpack", "Belt Bag", "Weekender Duffel"],
    tags: ["travel", "laptop", "waterproof", "lightweight"],
    price: [19, 129],
    sizes: null,
    hue: 45,
    blurb: ["Water-resistant fabric and a padded back panel for daily carry.", "Plenty of organiser pockets keep cables, keys and snacks in place."],
  },
};

// Per 20 products: 9 shoes, 6 apparel, 5 accessories (bags). Larger counts cycle through it.
const PLAN: Kind[] = [
  ...Array<Kind>(4).fill("running"),
  ...Array<Kind>(3).fill("sneaker"),
  ...Array<Kind>(2).fill("sandal"),
  ...Array<Kind>(6).fill("apparel"),
  ...Array<Kind>(5).fill("bag"),
];

const BRANDS = ["Velora", "Korra", "Nimbo", "Tavik", "Lumio", "Arden", "Solace", "Brisa"];
const MODELS = ["Stride", "Pulse", "Drift", "Glide", "Crest", "Haven", "Vale", "Rove", "Tempo", "Aero"];
const CLOSERS = ["Backed by a 30-day fit guarantee.", "Ships in recyclable packaging.", "Designed in Kuala Lumpur, tested on local trails and city streets."];

const AUTHORS = ["Aisyah R.", "Daniel T.", "Mei Ling", "Hafiz A.", "Priya K.", "Jun Wei", "Nurul H.", "Arjun S.", "Siti Z.", "Marcus L.", "Farah N.", "Kevin O."];
const TITLES: Record<number, string[]> = {
  1: ["Disappointed", "Fell apart fast"],
  2: ["Not great", "Expected better"],
  3: ["It's okay", "Mixed feelings"],
  4: ["Really good", "Solid buy"],
  5: ["Love it", "Excellent", "Exactly as described"],
};
const PRAISE = [
  "Very comfortable from day one.",
  "Fits true to size for me.",
  "Quality materials and neat stitching.",
  "Great value for the price.",
  "Still holding up well after a month.",
  "Shipping was quick and the packaging was tidy.",
];
const GRIPES = ["Runs a bit small, size up.", "The stitching came loose after a few weeks.", "Feels overpriced for what it is.", "Delivery took longer than promised."];
const FAKE_TEXTS = ["Best product ever!!! BUY NOW!!!", "Amazing!!! Love it!!!"];

interface RawReview {
  author: string;
  rating: number;
  title: string;
  body: string;
  verified: boolean;
  createdAt: Date;
  /** Index into the buyer list, when a real buyer account wrote it. */
  buyerSlot: number | null;
}

export interface ProductPlan {
  id: string;
  kind: Kind;
  name: string;
  brand: string;
  description: string;
  tags: Tag[];
  priceCents: number;
  shippingCents: number;
  imageHue: number;
  variants: { size: string; stock: number; position: number }[];
  fitFeedback: { heightCm: number; weightKg: number; usualSize: string; fit: string }[];
  reviews: RawReview[];
}

/** Everything comes from the PRNG up front, so skipping a kept product never shifts the others. */
export function planProducts({ seed, count, idPrefix }: { seed: number; count: number; idPrefix: string }): ProductPlan[] {
  const rand = mulberry32(seed);
  const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const pickSome = <T>(xs: readonly T[], n: number): T[] => [...xs].sort(() => rand() - 0.5).slice(0, n);
  /** RM prices ending in .90: e.g. 128 → RM 128.90. */
  const ninety = (minRm: number, maxRm: number) => int(minRm - 1, maxRm - 1) * 100 + 90;

  function genuineReview(slot: number): RawReview {
    const rating = pick([5, 5, 5, 4, 4, 4, 3, 2, 1]);
    const good = rating >= 4;
    const body = good ? pickSome(PRAISE, 2).join(" ") : rating === 3 ? `${pick(PRAISE)} ${pick(GRIPES)}` : pickSome(GRIPES, 2).join(" ");
    return {
      author: AUTHORS[slot % AUTHORS.length]!,
      rating,
      title: pick(TITLES[rating]!),
      body,
      verified: rand() < 0.85,
      createdAt: daysAgo(int(5, 200), int(0, 23)),
      buyerSlot: slot,
    };
  }

  /** A same-day burst of short, generic, unverified 5-star reviews: the fake-review filter's target. */
  function fakeBurst(): RawReview[] {
    const day = int(1, 4);
    const text = pick(FAKE_TEXTS);
    return Array.from({ length: 4 }, (_, i) => ({
      author: `user${int(1000, 9999)}`,
      rating: 5,
      title: "Amazing!!!",
      body: text,
      verified: false,
      createdAt: daysAgo(day, i),
      buyerSlot: null,
    }));
  }

  function sampleFit(bias: number): string {
    const r = rand();
    if (bias < 0) return r < 0.6 ? "small" : r < 0.9 ? "true" : "large";
    if (bias > 0) return r < 0.6 ? "large" : r < 0.9 ? "true" : "small";
    return r < 0.15 ? "small" : r < 0.85 ? "true" : "large";
  }

  const suspicious = new Set(pickSome([...Array(count).keys()], Math.min(3, count)));
  const usedNames = new Set<string>();
  return Array.from({ length: count }, (_, i) => {
    const kind = PLAN[i % PLAN.length]!;
    const spec = KINDS[kind];
    let name: string;
    let brand: string;
    do {
      brand = pick(BRANDS);
      name = `${brand} ${pick(MODELS)} ${int(1, 5)} ${pick(spec.types)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const variants = (spec.sizes ?? []).map((size, position) => ({ size, position, stock: rand() < 0.1 ? 0 : int(1, 40) }));
    const bias = pick([-1, 0, 0, 0, 1]);
    const fitFeedback = spec.sizes
      ? Array.from({ length: int(10, 30) }, () => {
          const heightCm = int(152, 192);
          return { heightCm, weightKg: Math.max(45, Math.min(110, heightCm - 105 + int(-12, 12))), usualSize: pick(spec.sizes!), fit: sampleFit(bias) };
        })
      : [];
    const reviews = suspicious.has(i)
      ? [genuineReview(0), genuineReview(1), ...fakeBurst()]
      : Array.from({ length: int(3, 8) }, (_, n) => genuineReview(n));

    return {
      id: `${idPrefix}-${String(i + 1).padStart(2, "0")}`,
      kind,
      name,
      brand,
      description: `${spec.blurb.join(" ")} ${pick(CLOSERS)}`,
      tags: pickSome(spec.tags, int(2, 3)),
      priceCents: ninety(...spec.price),
      shippingCents: rand() < 0.25 ? 0 : ninety(4, 12),
      imageHue: (spec.hue + int(-15, 15) + 360) % 360,
      variants,
      fitFeedback,
      reviews,
    };
  });
}

/** Seller trust stats in a believable range: on-time 92–98%, returns 2–6%. */
export function sellerStats(seed: number) {
  const r = mulberry32(seed + 1000);
  return {
    onTimeRate: Math.round((0.92 + r() * 0.06) * 1000) / 1000,
    returnRate: Math.round((0.02 + r() * 0.04) * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// SVG photos: gradient + category outline + name. No network, no packages.
// ---------------------------------------------------------------------------
const ICONS: Record<Category, string> = {
  shoes:
    '<path d="M190 470c0-70 50-90 100-90l100-40c40-15 70 0 90 40l110 40c40 12 50 50 30 70H210c-15 0-20-8-20-20z"/><path d="M200 505h440"/>',
  apparel: '<path d="M300 220l80-40q20 30 40 0l80 40 60 80-50 30-20-30v220H310V300l-20 30-50-30z"/>',
  bags: '<path d="M250 330h300l20 230H230z"/><path d="M330 330v-40a70 70 0 0 1 140 0v40"/>',
  tech: '<rect x="270" y="230" width="260" height="320" rx="30"/><circle cx="400" cy="480" r="30"/>',
};
const ANGLES = ["Front view", "Side view", "Detail"];
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function productSvg(p: ProductPlan, n: number): string {
  const category = KINDS[p.kind].category;
  const light = 93 - (n - 1) * 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1" gradientTransform="rotate(${(n - 1) * 25} .5 .5)">
      <stop offset="0" stop-color="hsl(${p.imageHue} 60% ${light}%)"/>
      <stop offset="1" stop-color="hsl(${(p.imageHue + 35) % 360} 55% ${light - 14}%)"/>
    </linearGradient>
  </defs>
  <rect width="800" height="800" fill="url(#g)"/>
  <g fill="none" stroke="hsl(${p.imageHue} 45% 30%)" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" transform="rotate(${(n - 2) * 6} 400 400)">
    ${ICONS[category]}
  </g>
  <text x="400" y="650" text-anchor="middle" font-family="system-ui, sans-serif" font-size="36" font-weight="700" fill="hsl(${p.imageHue} 40% 20%)">${escapeXml(p.name)}</text>
  <text x="400" y="700" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" fill="hsl(${p.imageHue} 30% 35%)">Photo ${n} · ${ANGLES[n - 1]}</text>
</svg>
`;
}

/** Only our own upload paths, so a stored URL can never point outside uploads/. */
export function uploadPath(url: string): string | null {
  const m = url.match(/^\/uploads\/((?:seed\/)?[A-Za-z0-9-]+\.(?:svg|jpg|png|webp))$/);
  return m ? join(UPLOAD_ROOT, m[1]!) : null;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/** Existing buyers write the genuine reviews; three demo buyers are created only if there are none. */
export async function reviewBuyers(prisma: PrismaClient): Promise<User[]> {
  const buyers = await prisma.user.findMany({ where: { role: "BUYER" }, orderBy: { createdAt: "asc" }, take: 8 });
  if (buyers.length > 0) return buyers;
  const passwordHash = await bcrypt.hash("Buyerpass1", BCRYPT_ROUNDS);
  return Promise.all(
    [1, 2, 3].map((n) =>
      prisma.user.upsert({
        where: { email: `buyer${n}@seed.clearcart.test` },
        create: { email: `buyer${n}@seed.clearcart.test`, name: `Seed Buyer ${n}`, role: "BUYER", passwordHash },
        update: {},
      }),
    ),
  );
}

/** Writes the product's SVGs, then creates it with variants, fit feedback, flagged reviews, digest and images. */
export async function createPlannedProduct(prisma: PrismaClient, p: ProductPlan, sellerId: string, buyers: User[]) {
  const flags = detectSuspicious(p.reviews);
  // One review per buyer account per product; the rest are anonymous like the main seed's.
  const reviews = p.reviews.map((r, i) => {
    const buyer = r.buyerSlot !== null && r.buyerSlot < buyers.length ? buyers[r.buyerSlot]! : null;
    return {
      author: buyer?.name ?? r.author,
      buyerId: buyer?.id ?? null,
      rating: r.rating,
      title: r.title,
      body: r.body,
      verified: buyer ? true : r.verified,
      createdAt: r.createdAt,
      isSuspicious: flags[i]!.isSuspicious,
      suspicionReason: flags[i]!.reason,
    };
  });
  const digest = heuristicDigest(reviews);

  await mkdir(SEED_DIR, { recursive: true });
  const imageRows = [];
  for (let n = 1; n <= IMAGES_PER_PRODUCT; n++) {
    const file = `${p.id}-${n}.svg`;
    await writeFile(join(SEED_DIR, file), productSvg(p, n), "utf8");
    imageRows.push({ url: `/uploads/seed/${file}`, alt: `${p.name}, photo ${n}`, isThumbnail: n === 1, sortOrder: n });
  }

  await prisma.product.create({
    data: {
      id: p.id,
      slug: `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${p.id}`,
      name: p.name,
      brand: p.brand,
      category: KINDS[p.kind].category,
      description: p.description,
      imageHue: p.imageHue,
      tags: p.tags.join(","),
      priceCents: p.priceCents,
      shippingCents: p.shippingCents,
      sellerId,
      status: "ACTIVE",
      variants: { create: p.variants },
      fitFeedback: { create: p.fitFeedback },
      reviews: { create: reviews },
      digest: { create: { ...digest, pros: JSON.stringify(digest.pros), cons: JSON.stringify(digest.cons) } },
      images: { create: imageRows },
    },
  });
  return { images: imageRows.length, reviews: reviews.length, flagged: reviews.filter((r) => r.isSuspicious).length };
}
