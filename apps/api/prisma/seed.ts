import { PrismaClient } from "@prisma/client";
import type { Category, Tag } from "@clearcart/shared";
import { detectSuspicious } from "../src/services/reviewSignals";
import { heuristicDigest } from "../src/services/reviewDigest";

const prisma = new PrismaClient();

// Deterministic PRNG so every teammate gets the same catalog.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261022);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

// ---------------------------------------------------------------------------
// Sellers: two of them are deliberately sketchy (slow, high returns, fake reviews).
// ---------------------------------------------------------------------------
interface SellerSpec {
  id: string;
  name: string;
  onTimeRate: number;
  returnRate: number;
  quality: number;
  fakeRate: number;
  shipping: number[];
}

const SELLERS: SellerSpec[] = [
  { id: "northwind", name: "Northwind Outfitters", onTimeRate: 0.97, returnRate: 0.04, quality: 0.85, fakeRate: 0, shipping: [0] },
  { id: "peakpine", name: "Peak & Pine", onTimeRate: 0.94, returnRate: 0.06, quality: 0.8, fakeRate: 0.03, shipping: [0, 4.99] },
  { id: "lumen", name: "Lumen Goods", onTimeRate: 0.96, returnRate: 0.05, quality: 0.82, fakeRate: 0.02, shipping: [0, 3.99] },
  { id: "urbanthread", name: "UrbanThread Co.", onTimeRate: 0.89, returnRate: 0.09, quality: 0.7, fakeRate: 0.08, shipping: [4.99] },
  { id: "quickdeal", name: "QuickDeal Hub", onTimeRate: 0.74, returnRate: 0.19, quality: 0.55, fakeRate: 0.3, shipping: [7.99] },
  { id: "bargainblitz", name: "BargainBlitz", onTimeRate: 0.66, returnRate: 0.27, quality: 0.45, fakeRate: 0.5, shipping: [5.99, 9.99] },
];
const sellerById = new Map(SELLERS.map((s) => [s.id, s]));

// ---------------------------------------------------------------------------
// Review text
// ---------------------------------------------------------------------------
type Aspect = "Comfort" | "Durability" | "Value" | "Quality" | "Shipping" | "Battery" | "Sound" | "Capacity";

const SENTENCES: Record<Aspect, { pos: string[]; neg: string[] }> = {
  Comfort: {
    pos: ["Super comfortable right out of the box.", "Really comfortable for long days on my feet."],
    neg: ["Not comfortable after an hour of wear.", "The comfort just isn't there for me."],
  },
  Durability: {
    pos: ["Still holding up after months of daily use.", "Feels durable and sturdy."],
    neg: ["Started to peel after a few weeks.", "Wore out much faster than I expected."],
  },
  Value: {
    pos: ["Great value for the price.", "Worth every dollar."],
    neg: ["Overpriced for what you get.", "Not worth the price in my opinion."],
  },
  Quality: {
    pos: ["The materials feel premium.", "Excellent build quality."],
    neg: ["Stitching came loose quickly.", "Materials feel flimsy."],
  },
  Shipping: {
    pos: ["Arrived quickly and well packaged.", "Fast shipping, no surprises."],
    neg: ["Delivery took two weeks longer than promised.", "Arrived with damaged packaging."],
  },
  Battery: {
    pos: ["Battery life easily lasts all week.", "Charges fast and holds the charge."],
    neg: ["Battery drains way too fast.", "Struggles to hold a charge after a month."],
  },
  Sound: {
    pos: ["Sound is crisp with solid bass.", "Audio is clear and rich."],
    neg: ["Sound is tinny at higher volume.", "Audio cuts out now and then."],
  },
  Capacity: {
    pos: ["Tons of space, fits everything I need.", "Roomy with smart pockets."],
    neg: ["Smaller inside than the photos suggest.", "Not enough pockets for my gear."],
  },
};

const ASPECTS_BY_CATEGORY: Record<Category, Aspect[]> = {
  shoes: ["Comfort", "Durability", "Value", "Quality", "Shipping"],
  apparel: ["Comfort", "Durability", "Value", "Quality", "Shipping"],
  bags: ["Capacity", "Durability", "Value", "Quality", "Shipping"],
  tech: ["Battery", "Sound", "Value", "Quality", "Shipping"],
};

const FIT_SENTENCE = {
  small: "Runs a bit small, I had to exchange for a size up.",
  true: "Fits exactly as expected.",
  large: "Runs large, size down if you're between sizes.",
};

const TITLES: Record<number, string[]> = {
  5: ["Love it", "Exactly what I wanted", "Highly recommend"],
  4: ["Really good", "Solid choice", "Happy with it"],
  3: ["It's okay", "Mixed feelings", "Decent, not great"],
  2: ["Disappointed", "Not as described", "Expected more"],
  1: ["Would not buy again", "Poor", "Returned it"],
};

const FAKE_TEXTS = [
  "Best product ever!!! Highly recommend!!!",
  "Amazing amazing amazing. Five stars!!!",
  "Great product great seller fast shipping A+++",
  "Perfect perfect perfect, buy it now!!!",
  "Love it!!! 10/10 would buy again!!!",
];
const FAKE_TITLES = ["AMAZING!!!", "BEST EVER", "Must buy!!!", "5 STARS"];

const NAMES = ["Maya", "Jonas", "Priya", "Lee", "Sofia", "Omar", "Hana", "Diego", "Ava", "Kenji", "Zara", "Theo", "Nia", "Luca", "Mei", "Sam", "Ines", "Ravi", "Elif", "Noah"];
const author = () => `${pick(NAMES)} ${String.fromCharCode(65 + int(0, 25))}.`;

const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

// ---------------------------------------------------------------------------
// Sizes and fit
// ---------------------------------------------------------------------------
const SIZE_SCALES: Partial<Record<Category, string[]>> = {
  shoes: ["6", "7", "8", "9", "10", "11", "12"],
  apparel: ["XS", "S", "M", "L", "XL"],
};

type FitBias = -1 | 0 | 1;
type FitLabel = "small" | "true" | "large";

function usualSizeFor(category: Category, heightCm: number, weightKg: number): string {
  const scale = SIZE_SCALES[category]!;
  const index =
    category === "shoes"
      ? (heightCm - 150) / 7
      : (heightCm - 150) / 10 + (weightKg - 60) / 25;
  return scale[clampInt(index, 0, scale.length - 1)]!;
}

function sampleFit(bias: FitBias): FitLabel {
  const r = rand();
  const [small, trueToSize] = bias === -1 ? [0.65, 0.3] : bias === 1 ? [0.05, 0.3] : [0.12, 0.78];
  return r < small ? "small" : r < small + trueToSize ? "true" : "large";
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
interface ProductSpec {
  name: string;
  brand: string;
  category: Category;
  description: string;
  tags: Tag[];
  priceDollars: number;
  sellerId: string;
  genuineReviews: number;
  /** Planted fake reviews. The detector has to find them on its own. */
  fakeReviews: number;
  quality: number;
  fitBias: FitBias;
  shippingDollars?: number;
}

/** Hand-written products for the demo story: "running shoes under $100 for wide feet". */
const DEMO_PRODUCTS: ProductSpec[] = [
  {
    name: "Stride Cloudline Wide Runner",
    brand: "Stride",
    category: "shoes",
    description: "A cushioned daily running shoe built on a genuinely wide last, with a roomy toe box and a soft foam midsole.",
    tags: ["running", "wide-fit", "cushioned"],
    priceDollars: 84,
    sellerId: "northwind",
    genuineReviews: 28,
    fakeReviews: 0,
    quality: 0.88,
    fitBias: 0,
  },
  {
    name: "Aerofoot Pace Wide",
    brand: "Aerofoot",
    category: "shoes",
    description: "Lightweight running shoe marketed for wide feet. Breathable mesh upper and a firm, responsive sole.",
    tags: ["running", "wide-fit", "lightweight"],
    priceDollars: 79,
    sellerId: "bargainblitz",
    genuineReviews: 18,
    fakeReviews: 12,
    quality: 0.45,
    fitBias: -1,
  },
  {
    name: "Trailborn Ridge Wide Trail",
    brand: "Trailborn",
    category: "shoes",
    description: "Waterproof trail runner with a wide fit, aggressive lugs and a rock plate for rough terrain.",
    tags: ["running", "trail", "wide-fit", "waterproof"],
    priceDollars: 89,
    sellerId: "peakpine",
    genuineReviews: 22,
    fakeReviews: 1,
    quality: 0.8,
    fitBias: -1,
    shippingDollars: 0,
  },
];

interface ItemTemplate {
  item: string;
  tags: Tag[];
  price: [number, number];
  blurb: string;
}

const CATALOG: Record<Category, { count: number; brands: string[]; items: ItemTemplate[] }> = {
  shoes: {
    count: 15,
    brands: ["Stride", "Aerofoot", "Trailborn", "Kinetic", "Solace"],
    items: [
      { item: "Daily Trainer", tags: ["running", "cushioned"], price: [70, 140], blurb: "A do-it-all running shoe with a balanced, cushioned ride." },
      { item: "Trail Runner", tags: ["running", "trail", "waterproof"], price: [90, 160], blurb: "Grippy, waterproof and stable on muddy trails." },
      { item: "Everyday Sneaker", tags: ["lightweight", "vegan"], price: [50, 110], blurb: "A clean, lightweight sneaker made without animal materials." },
      { item: "Walking Shoe", tags: ["cushioned", "wide-fit"], price: [60, 120], blurb: "Supportive walking shoe with extra width and plush cushioning." },
      { item: "Court Sneaker", tags: ["vegan"], price: [55, 100], blurb: "Retro court style in vegan leather." },
      { item: "Hiking Boot", tags: ["trail", "waterproof"], price: [110, 190], blurb: "Waterproof mid-height boot for long days on the trail." },
    ],
  },
  apparel: {
    count: 16,
    brands: ["Northloom", "Kinetic", "Hearth & Hem", "Solace"],
    items: [
      { item: "Organic Cotton Tee", tags: ["organic-cotton", "breathable"], price: [18, 40], blurb: "A soft, breathable tee in certified organic cotton." },
      { item: "Running Tank", tags: ["running", "breathable", "lightweight"], price: [20, 45], blurb: "Featherweight tank that dries fast on hot runs." },
      { item: "Rain Shell Jacket", tags: ["waterproof", "lightweight", "travel"], price: [80, 180], blurb: "Packable waterproof shell that folds into its own pocket." },
      { item: "Fleece Hoodie", tags: ["vegan"], price: [45, 95], blurb: "Cosy recycled fleece hoodie for cool evenings." },
      { item: "Trail Shorts", tags: ["trail", "lightweight"], price: [30, 60], blurb: "Light, stretchy shorts with a zip pocket." },
      { item: "Merino Base Layer", tags: ["breathable", "travel"], price: [55, 110], blurb: "Odour-resistant merino layer that works on the trail and in town." },
    ],
  },
  bags: {
    count: 12,
    brands: ["Packwell", "Northloom", "Driftway"],
    items: [
      { item: "Commuter Backpack", tags: ["laptop", "waterproof"], price: [60, 140], blurb: "Weatherproof backpack with a padded 16\" laptop sleeve." },
      { item: "Weekender Duffel", tags: ["travel"], price: [70, 160], blurb: "Carry-on sized duffel with a separate shoe compartment." },
      { item: "Everyday Tote", tags: ["vegan", "laptop"], price: [35, 90], blurb: "Structured vegan tote that fits a laptop and lunch." },
      { item: "Carry-On Roller", tags: ["travel"], price: [120, 260], blurb: "Hard-shell carry-on with silent spinner wheels." },
    ],
  },
  tech: {
    count: 14,
    brands: ["Lumen", "Voltix", "Auralis"],
    items: [
      { item: "Wireless Earbuds", tags: ["wireless"], price: [40, 180], blurb: "Compact earbuds with a pocketable charging case." },
      { item: "Noise-Cancelling Headphones", tags: ["wireless", "noise-cancelling"], price: [90, 320], blurb: "Over-ear headphones with adaptive noise cancelling." },
      { item: "Fast Charger", tags: ["fast-charging"], price: [18, 50], blurb: "Compact GaN charger that tops up a phone in 30 minutes." },
      { item: "Power Bank", tags: ["fast-charging", "travel"], price: [25, 80], blurb: "Slim 10,000 mAh power bank, airline-safe." },
    ],
  },
};

const MODELS = ["Aero", "Flux", "Nova", "Terra", "Pulse", "Vista", "Echo", "Zen", "Orbit", "Swift", "Atlas", "Halo", "Vertex", "Drift", "Comet", "Sierra"];

function generatedProducts(): ProductSpec[] {
  const specs: ProductSpec[] = [];
  for (const [category, { count, brands, items }] of Object.entries(CATALOG) as [Category, (typeof CATALOG)[Category]][]) {
    for (let i = 0; i < count; i++) {
      const template = items[i % items.length]!;
      const brand = brands[(i + Math.floor(i / items.length)) % brands.length]!;
      const seller = pick(SELLERS);
      const genuineReviews = int(6, 30);
      specs.push({
        name: `${brand} ${MODELS[i % MODELS.length]} ${template.item}`,
        brand,
        category,
        description: template.blurb,
        tags: template.tags,
        priceDollars: int(template.price[0], template.price[1]),
        sellerId: seller.id,
        genuineReviews,
        fakeReviews: Math.round(genuineReviews * seller.fakeRate * (0.6 + rand() * 0.8)),
        quality: Math.min(0.95, Math.max(0.2, seller.quality + (rand() - 0.5) * 0.3)),
        fitBias: pick([-1, 0, 0, 1] as const),
      });
    }
  }
  return specs;
}

const slugify = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function genuineReview(spec: ProductSpec) {
  const rating = clampInt(1 + spec.quality * 4 + (rand() - 0.5) * 2.4, 1, 5);
  const aspects = ASPECTS_BY_CATEGORY[spec.category];
  const first = pick(aspects);
  const second = pick(aspects.filter((a) => a !== first));
  const tone = (positive: boolean, a: Aspect) => pick(positive ? SENTENCES[a].pos : SENTENCES[a].neg);
  const sentences =
    rating === 3 ? [tone(true, first), tone(false, second)] : [tone(rating >= 4, first), tone(rating >= 4, second)];

  // Fit comments follow the product's real fit, whatever the rating.
  if (SIZE_SCALES[spec.category] && rand() < 0.4) {
    sentences.push(FIT_SENTENCE[spec.fitBias === -1 ? "small" : spec.fitBias === 1 ? "large" : "true"]);
  }
  return {
    author: author(),
    rating,
    title: pick(TITLES[rating]!),
    body: sentences.join(" "),
    verified: rand() < 0.9,
    createdAt: daysAgo(int(1, 300)),
  };
}

function fakeReview() {
  return {
    author: author(),
    rating: 5,
    title: pick(FAKE_TITLES),
    body: pick(FAKE_TEXTS),
    verified: false,
    // Fake reviews tend to arrive in bursts.
    createdAt: daysAgo(int(1, 20)),
  };
}

async function seedProduct(spec: ProductSpec, index: number) {
  const seller = sellerById.get(spec.sellerId)!;
  const raw = [
    ...Array.from({ length: spec.genuineReviews }, () => genuineReview(spec)),
    ...Array.from({ length: spec.fakeReviews }, fakeReview),
  ];
  const flags = detectSuspicious(raw);
  const reviews = raw.map((r, i) => ({
    ...r,
    isSuspicious: flags[i]!.isSuspicious,
    suspicionReason: flags[i]!.reason,
  }));
  const digest = heuristicDigest(reviews);

  const scale = SIZE_SCALES[spec.category];
  const variants = (scale ?? []).map((size, position) => ({
    size,
    position,
    stock: rand() < 0.15 ? 0 : int(1, 20),
  }));
  const fitFeedback = scale
    ? Array.from({ length: int(15, 55) }, () => {
        const heightCm = int(152, 196);
        const weightKg = clampInt(heightCm - 105 + (rand() - 0.5) * 30, 45, 120);
        return {
          heightCm,
          weightKg,
          usualSize: usualSizeFor(spec.category, heightCm, weightKg),
          fit: sampleFit(spec.fitBias),
        };
      })
    : [];

  const shipping = spec.shippingDollars ?? pick(seller.shipping);
  await prisma.product.create({
    data: {
      id: `p${String(index + 1).padStart(3, "0")}`,
      slug: slugify(spec.name),
      name: spec.name,
      brand: spec.brand,
      category: spec.category,
      description: spec.description,
      imageHue: int(0, 359),
      tags: spec.tags.join(","),
      priceCents: spec.priceDollars * 100 - 1,
      shippingCents: Math.round(shipping * 100),
      sellerId: seller.id,
      status: "ACTIVE",
      variants: { create: variants },
      reviews: { create: reviews },
      fitFeedback: { create: fitFeedback },
      digest: {
        create: { ...digest, pros: JSON.stringify(digest.pros), cons: JSON.stringify(digest.cons) },
      },
    },
  });
  return reviews.filter((r) => r.isSuspicious).length;
}

async function main() {
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.seller.deleteMany();

  await prisma.seller.createMany({
    data: SELLERS.map(({ id, name, onTimeRate, returnRate }) => ({ id, name, onTimeRate, returnRate })),
  });

  const specs = [...DEMO_PRODUCTS, ...generatedProducts()];
  let flagged = 0;
  for (const [i, spec] of specs.entries()) flagged += await seedProduct(spec, i);

  console.log(`Seeded ${SELLERS.length} sellers, ${specs.length} products, ${flagged} reviews flagged as suspicious.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
