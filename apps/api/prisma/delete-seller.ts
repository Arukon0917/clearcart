/**
 * Deletes a SELLER account and everything that belongs to it.
 *
 *   npm run seller:delete -w @clearcart/api -- --email <email> [--force]
 *
 * Always prints a dry-run summary first. Without --force it refuses when any order involves the
 * seller, and otherwise asks you to type DELETE. With --force it also removes the seller's order
 * items and shipments, recomputing (or deleting, if emptied) the affected orders.
 */
import { rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { deriveOrderStatus, type CartQuote, type ShipmentStatus } from "@clearcart/shared";
import { quoteCart } from "../src/services/pricing";
import { uploadPath } from "./sellerKit";

const prisma = new PrismaClient();

function readArgs() {
  const { values } = parseArgs({ options: { email: { type: "string" }, force: { type: "boolean" } } });
  const email = values.email?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run seller:delete -w @clearcart/api -- --email <email> [--force]");
    process.exit(1);
  }
  return { email, force: Boolean(values.force) };
}

async function confirm(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error("No terminal to confirm in. Run this interactively, or pass --force.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type DELETE to confirm: ");
  rl.close();
  return answer.trim() === "DELETE";
}

async function main() {
  const { email, force } = readArgs();
  const user = await prisma.user.findUnique({ where: { email }, include: { seller: true } });
  if (!user) throw new Error(`No account with email ${email}.`);
  if (user.role !== "SELLER") throw new Error(`${email} is a ${user.role} account, not a seller; refusing.`);

  const sellerId = user.seller?.id ?? null;
  const products = sellerId ? await prisma.product.findMany({ where: { sellerId }, select: { id: true, images: { select: { url: true } } } }) : [];
  const productIds = products.map((p) => p.id);
  const imageUrls = products.flatMap((p) => p.images.map((i) => i.url));
  const inProducts = { productId: { in: productIds } };
  const sellerScope = { sellerId: sellerId ?? "__none__" };

  const [variants, reviews, ownReviews, cartItems, sessions, orderItems, shipments, shipmentEvents, buyerOrders] = await Promise.all([
    prisma.variant.count({ where: inProducts }),
    prisma.review.count({ where: inProducts }),
    prisma.review.count({ where: { buyerId: user.id } }),
    prisma.cartItem.count({ where: { OR: [inProducts, { cart: { userId: user.id } }] } }),
    prisma.session.count({ where: { userId: user.id } }),
    prisma.orderItem.findMany({ where: sellerScope, select: { orderId: true } }),
    prisma.shipment.findMany({ where: sellerScope, select: { orderId: true } }),
    prisma.shipmentEvent.count({ where: { shipment: sellerScope } }),
    prisma.order.count({ where: { buyerId: user.id } }),
  ]);
  const affectedOrderIds = [...new Set([...orderItems, ...shipments].map((o) => o.orderId))];

  console.log(`Dry run for ${email} (${user.name}, store ${user.seller?.name ?? "none"})`);
  console.log(`  products ${products.length}, images ${imageUrls.length}, variants ${variants}, reviews on products ${reviews}`);
  console.log(`  cart items ${cartItems}, sessions ${sessions}, reviews written ${ownReviews}, orders placed as buyer ${buyerOrders}`);
  console.log(`  order items ${orderItems.length}, shipments ${shipments.length}, shipment events ${shipmentEvents}, orders affected ${affectedOrderIds.length}`);

  if (!force) {
    if (affectedOrderIds.length > 0) {
      console.log("Stopped: orders involve this seller. Re-run with --force to remove their part of those orders too.");
      process.exitCode = 1;
      return;
    }
    if (!(await confirm())) {
      console.log("Cancelled; nothing was deleted.");
      return;
    }
  }

  let ordersDeleted = 0;
  let ordersRecomputed = 0;
  await prisma.$transaction(
    async (tx) => {
      // Children first. Every filter is scoped to this user's id, their seller id or their products.
      await tx.review.deleteMany({ where: { OR: [inProducts, { buyerId: user.id }] } });
      await tx.cartItem.deleteMany({ where: { OR: [inProducts, { cart: { userId: user.id } }] } });
      await tx.cart.deleteMany({ where: { userId: user.id } });
      await tx.variant.deleteMany({ where: inProducts });
      await tx.productImage.deleteMany({ where: inProducts });

      if (force && sellerId) {
        await tx.shipmentEvent.deleteMany({ where: { shipment: { sellerId } } });
        await tx.shipment.deleteMany({ where: { sellerId } });
        await tx.orderItem.deleteMany({ where: { sellerId } });
        for (const orderId of affectedOrderIds) {
          const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, shipments: { select: { status: true } } } });
          if (!order) continue;
          if (order.items.length === 0) {
            await tx.order.delete({ where: { id: orderId } });
            ordersDeleted++;
            continue;
          }
          // Other sellers' part of the order stays; re-price it from the original quote lines.
          const remaining = new Set(order.items.map((i) => i.productId));
          const old = JSON.parse(order.quote) as CartQuote;
          const quote = quoteCart(old.lines.filter((l) => remaining.has(l.productId)).map(({ lineCents: _lineCents, ...line }) => line));
          await tx.order.update({
            where: { id: orderId },
            data: {
              quote: JSON.stringify(quote),
              totalCents: quote.totalCents,
              ...(order.shipments.length > 0 && { status: deriveOrderStatus(order.shipments.map((s) => s.status as ShipmentStatus)) }),
            },
          });
          ordersRecomputed++;
        }
      }

      if (sellerId) {
        await tx.product.deleteMany({ where: { sellerId } }); // Fit feedback and digests cascade.
        await tx.seller.delete({ where: { id: sellerId } });
      }
      await tx.session.deleteMany({ where: { userId: user.id } });
      // Orders they placed as a buyer belong to the other sellers too; keep them, just unlink.
      await tx.order.updateMany({ where: { buyerId: user.id }, data: { buyerId: null } });
      await tx.user.delete({ where: { id: user.id } });
    },
    { timeout: 60_000 },
  );

  // Files only after the rows are gone, so a failed transaction never leaves products without images.
  let filesRemoved = 0;
  for (const url of imageUrls) {
    const path = uploadPath(url);
    if (path) {
      await rm(path, { force: true });
      filesRemoved++;
    }
  }

  console.log(`Deleted ${email}`);
  console.log(`  products ${products.length}, image rows ${imageUrls.length}, files ${filesRemoved}, variants ${variants}`);
  console.log(`  reviews ${reviews + ownReviews}, cart items ${cartItems}, sessions ${sessions}`);
  if (force) {
    console.log(`  order items ${orderItems.length}, shipments ${shipments.length}, shipment events ${shipmentEvents}`);
    console.log(`  orders deleted ${ordersDeleted}, orders recomputed ${ordersRecomputed}`);
  }
  console.log("  Restart the API so the cached catalog drops the removed products.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
