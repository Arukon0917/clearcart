/**
 * Creates (or tops up) a test seller with deterministic products, SVG photos and reviews.
 *
 *   npm run seller:seed -w @clearcart/api -- --name "Test Store" --email teststore@clearcart.test \
 *     --password TestStore123 [--count 20] [--seed 3] [--reset]
 *
 * An existing account is never modified (name, password, role); only its products are seeded.
 * With --reset, the seller's products that were never ordered are deleted and recreated.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PASSWORD_RULE, PasswordSchema } from "@clearcart/shared";
import { BCRYPT_ROUNDS, createPlannedProduct, idPrefixFor, planProducts, reviewBuyers, sellerStats, uploadPath } from "./sellerKit";

const prisma = new PrismaClient();

const ArgsSchema = z.object({
  name: z.string().trim().min(2, "--name must be at least 2 characters").max(60),
  email: z.string().trim().toLowerCase().pipe(z.email("--email must be a valid email")),
  password: PasswordSchema,
  count: z.coerce.number().int().min(1).max(100).default(20),
  seed: z.coerce.number().int().default(1),
  reset: z.boolean().default(false),
});

function readArgs() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
      count: { type: "string" },
      seed: { type: "string" },
      reset: { type: "boolean" },
    },
  });
  const parsed = ArgsSchema.safeParse(values);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? "args");
      const hint = field === "password" ? ` (${PASSWORD_RULE})` : "";
      console.error(`--${field}: ${issue.message}${hint}`);
    }
    console.error('Usage: npm run seller:seed -w @clearcart/api -- --name "<name>" --email <email> --password <pw> [--count 20] [--seed 3] [--reset]');
    process.exit(1);
  }
  return parsed.data;
}

async function main() {
  const args = readArgs();

  let user = await prisma.user.findUnique({ where: { email: args.email }, include: { seller: true } });
  let created = false;
  if (user && user.role !== "SELLER") throw new Error(`${args.email} exists but is a ${user.role} account; refusing to touch it.`);
  if (user && !user.seller) throw new Error(`${args.email} is a SELLER without a store profile; fix that account by hand.`);
  if (!user) {
    const passwordHash = await bcrypt.hash(args.password, BCRYPT_ROUNDS);
    user = await prisma.user.create({
      data: {
        email: args.email,
        name: args.name,
        role: "SELLER",
        passwordHash,
        seller: { create: { id: randomUUID(), name: args.name, ...sellerStats(args.seed) } },
      },
      include: { seller: true },
    });
    created = true;
  }
  const seller = user.seller!;

  const owned = await prisma.product.findMany({ where: { sellerId: seller.id }, select: { id: true, images: { select: { url: true } } } });
  const kept = new Set<string>();
  if (owned.length > 0) {
    if (!args.reset) {
      console.log(`${args.email} already has ${owned.length} product(s); nothing seeded. Pass --reset to recreate them.`);
      return;
    }
    // Products that were ever ordered stay, for order history; everything else is recreated.
    const ordered = await prisma.orderItem.findMany({
      where: { productId: { in: owned.map((p) => p.id) } },
      select: { productId: true },
      distinct: ["productId"],
    });
    for (const o of ordered) kept.add(o.productId);
    const removable = owned.filter((p) => !kept.has(p.id));
    await prisma.product.deleteMany({ where: { sellerId: seller.id, id: { in: removable.map((p) => p.id) } } });
    for (const url of removable.flatMap((p) => p.images.map((i) => i.url))) {
      const path = uploadPath(url);
      if (path) await rm(path, { force: true });
    }
    console.log(`Reset: removed ${removable.length} product(s), kept ${kept.size} with orders`);
  }

  const buyers = await reviewBuyers(prisma);
  let products = 0;
  let images = 0;
  let reviews = 0;
  let flagged = 0;
  for (const plan of planProducts({ seed: args.seed, count: args.count, idPrefix: idPrefixFor(args.email) })) {
    if (kept.has(plan.id)) continue;
    const r = await createPlannedProduct(prisma, plan, seller.id, buyers);
    products++;
    images += r.images;
    reviews += r.reviews;
    flagged += r.flagged;
  }

  console.log("Seller seed complete");
  console.log(`  account:  ${user.email} (${created ? "created" : "existing, unchanged"}), store "${seller.name}"`);
  console.log(`  trust:    on-time ${(seller.onTimeRate * 100).toFixed(1)}%, returns ${(seller.returnRate * 100).toFixed(1)}%`);
  console.log(`  products: ${products} created${kept.size ? `, ${kept.size} kept (have orders)` : ""} (PRNG seed ${args.seed})`);
  console.log(`  images:   ${images} SVGs in uploads/seed/`);
  console.log(`  reviews:  ${reviews} (${flagged} flagged suspicious) from ${buyers.length} buyer account(s) + anonymous`);
  console.log("  Restart the API so the cached catalog picks up the new products.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
