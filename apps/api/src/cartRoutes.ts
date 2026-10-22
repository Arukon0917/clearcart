import { Router } from "express";
import type { CartItem as CartItemRow } from "@prisma/client";
import {
  AddCartItemSchema,
  BulkIdsSchema,
  BulkSelectSchema,
  GuestCartSchema,
  UpdateCartItemSchema,
  isSelectable,
  type CartView,
} from "@clearcart/shared";
import { prisma } from "./db";
import { HttpError, notFound } from "./errors";
import { currentUser, requireAuth } from "./middleware/auth";
import { parse } from "./middleware/validate";
import { buildCartView, maxQtyFor, resolveProduct, unavailableReason, type CartLineInput } from "./services/cartService";

const toLine = (row: CartItemRow): CartLineInput => ({
  id: row.id,
  productId: row.productId,
  size: row.size || null,
  qty: row.qty,
  selected: row.selected,
  addedPriceCents: row.addedPriceCents,
});

async function cartViewFor(userId: string): Promise<CartView> {
  const rows = await prisma.cartItem.findMany({ where: { cart: { userId } }, orderBy: { addedAt: "desc" } });
  return buildCartView(rows.map(toLine));
}

async function cartIdFor(userId: string): Promise<string> {
  return (await prisma.cart.upsert({ where: { userId }, create: { userId }, update: {} })).id;
}

/** Only items in the caller's own cart; another user's item looks missing. */
async function ownItem(userId: string, id: string): Promise<CartItemRow> {
  const item = await prisma.cartItem.findFirst({ where: { id, cart: { userId } } });
  if (!item) throw notFound("Cart item");
  return item;
}

export const cartRoutes = Router();

/** Guests: price and validate a localStorage cart without saving anything. */
cartRoutes.post("/cart/preview", async (req, res) => {
  const { items } = parse(GuestCartSchema, req.body);
  res.json(
    await buildCartView(
      items.map((i) => ({
        id: `${i.productId}|${i.size ?? ""}`,
        productId: i.productId,
        size: i.size,
        qty: i.qty,
        selected: i.selected,
        addedPriceCents: i.priceCents ?? null,
      })),
    ),
  );
});

cartRoutes.use("/cart", requireAuth);

cartRoutes.get("/cart", async (_req, res) => {
  res.json(await cartViewFor(currentUser(res).id));
});

cartRoutes.post("/cart/items", async (req, res) => {
  const userId = currentUser(res).id;
  const { productId, size, qty } = parse(AddCartItemSchema, req.body);
  const { entry, stock, sizeOk } = await resolveProduct(productId, size);
  if (!entry) throw notFound("Product");
  if (!sizeOk) {
    const message = entry.record.variants.length ? "Pick a size" : "This product doesn't come in sizes";
    throw new HttpError(400, message, [{ path: "size", message }]);
  }
  if (stock === 0) throw new HttpError(409, `${entry.detail.name}${size ? ` in size ${size}` : ""} is out of stock`);

  const max = maxQtyFor(stock);
  const cartId = await cartIdFor(userId);
  const key = { cartId_productId_size: { cartId, productId: entry.record.id, size: size ?? "" } };
  const existing = await prisma.cartItem.findUnique({ where: key });
  if (existing && existing.qty >= max) throw new HttpError(409, `You already have the maximum (${max}) in your cart`);
  const nextQty = Math.min(max, (existing?.qty ?? 0) + qty);
  const unit = entry.detail.price.itemCents;
  await prisma.cartItem.upsert({
    where: key,
    create: { cartId, productId: entry.record.id, size: size ?? "", qty: nextQty, addedPriceCents: unit },
    update: { qty: nextQty, selected: true, addedPriceCents: unit },
  });
  res.status(201).json(await cartViewFor(userId));
});

cartRoutes.patch("/cart/items/:id", async (req, res) => {
  const userId = currentUser(res).id;
  const { qty, selected } = parse(UpdateCartItemSchema, req.body);
  const item = await ownItem(userId, String(req.params.id));
  if (qty !== undefined || selected) {
    const [line] = (await buildCartView([toLine(item)])).items;
    const reason = unavailableReason(line!);
    if (reason) throw new HttpError(409, reason);
    if (qty !== undefined && qty > line!.maxQty) {
      throw new HttpError(409, `Only ${line!.maxQty} of ${line!.name} available`, [{ path: "qty", message: `Max ${line!.maxQty}` }]);
    }
  }
  await prisma.cartItem.update({ where: { id: item.id }, data: { ...(qty !== undefined && { qty }), ...(selected !== undefined && { selected }) } });
  res.json(await cartViewFor(userId));
});

/** Bulk select / unselect ("select all" included). Unavailable lines are never selected. */
cartRoutes.post("/cart/select", async (req, res) => {
  const userId = currentUser(res).id;
  const { ids, selected } = parse(BulkSelectSchema, req.body);
  let targetIds = ids;
  if (selected) {
    const view = await cartViewFor(userId);
    const selectable = new Set(view.items.filter((l) => isSelectable(l.status)).map((l) => l.id));
    targetIds = ids.filter((id) => selectable.has(id));
  }
  await prisma.cartItem.updateMany({ where: { id: { in: targetIds }, cart: { userId } }, data: { selected } });
  res.json(await cartViewFor(userId));
});

cartRoutes.delete("/cart/items", async (req, res) => {
  const userId = currentUser(res).id;
  const { ids } = parse(BulkIdsSchema, req.body);
  await prisma.cartItem.deleteMany({ where: { id: { in: ids }, cart: { userId } } });
  res.json(await cartViewFor(userId));
});

/** On login/register: add the guest cart, summing quantities and capping at stock. Invalid lines are dropped. */
cartRoutes.post("/cart/merge", async (req, res) => {
  const userId = currentUser(res).id;
  const { items } = parse(GuestCartSchema, req.body);
  const cartId = await cartIdFor(userId);
  for (const item of items) {
    const { entry, stock, sizeOk } = await resolveProduct(item.productId, item.size);
    if (!entry || !sizeOk || stock === 0) continue;
    const key = { cartId_productId_size: { cartId, productId: entry.record.id, size: item.size ?? "" } };
    const existing = await prisma.cartItem.findUnique({ where: key });
    const qty = Math.min(maxQtyFor(stock), (existing?.qty ?? 0) + item.qty);
    await prisma.cartItem.upsert({
      where: key,
      create: {
        cartId,
        productId: entry.record.id,
        size: item.size ?? "",
        qty,
        selected: item.selected,
        addedPriceCents: item.priceCents ?? entry.detail.price.itemCents,
      },
      update: { qty },
    });
  }
  res.json(await cartViewFor(userId));
});
