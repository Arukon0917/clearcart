import { Prisma } from "@prisma/client";
import { formatAddress, paymentSummary, type Address, type CartItem, type CartQuote, type CheckoutPayload, type Order } from "@clearcart/shared";
import {
  addAddress,
  addPaymentMethod,
  ownedAddress,
  ownedPaymentMethod,
  paymentExpired,
  paymentFields,
  toAddressView,
} from "./accountService";
import { initialShipments } from "./fulfilment";
import { prisma } from "../db";
import { HttpError, type FieldIssue } from "../errors";
import { invalidateCatalog } from "./catalogService";
import { resolveProduct } from "./cartService";
import { quoteCart } from "./pricing";

const DELIVERY_DAYS = 4;
const ORDER_NO_ATTEMPTS = 3;

interface PricedCart {
  quote: CartQuote;
  sellerIds: string[];
}

/**
 * Prices always come from the server catalog, never from the client. Every problem is collected
 * so the buyer learns about all unavailable items at once, not one per attempt.
 */
async function priceItems(items: CartItem[]): Promise<PricedCart> {
  const problems: FieldIssue[] = [];
  const resolved = await Promise.all(items.map((i) => resolveProduct(i.productId, i.size)));
  const lines = items.map((item, i) => {
    const { entry, stock, sizeOk } = resolved[i]!;
    const path = `items.${i}`;
    if (!entry) {
      problems.push({ path, message: "An item in your cart is no longer available" });
      return null;
    }
    const label = `${entry.detail.name}${item.size ? ` (size ${item.size})` : ""}`;
    if (!sizeOk) problems.push({ path, message: entry.record.variants.length ? `Pick a size for ${entry.detail.name}` : `${label} is no longer available` });
    else if (stock === 0) problems.push({ path, message: `${label} is out of stock` });
    else if (stock !== null && item.quantity > stock) problems.push({ path, message: `Only ${stock} of ${label} left` });
    return {
      sellerId: entry.record.sellerId,
      line: {
        productId: entry.record.id,
        name: entry.detail.name,
        size: item.size,
        quantity: item.quantity,
        unitCents: entry.detail.price.itemCents,
        shippingCents: entry.detail.price.shippingCents,
      },
    };
  });
  if (problems.length) {
    throw new HttpError(409, `Some items can't be bought: ${problems.map((p) => p.message).join("; ")}`, problems);
  }
  const ok = lines.filter((l) => l !== null);
  return { quote: quoteCart(ok.map((l) => l.line)), sellerIds: ok.map((l) => l.sellerId) };
}

export async function quote(items: CartItem[]): Promise<CartQuote> {
  return (await priceItems(items)).quote;
}

const orderNumber = (seq: number) => `CC-${new Date().getFullYear()}-${String(seq).padStart(6, "0")}`;
const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** A buyer's selected cart lines, or a guest's items. Cart lines must belong to the caller. */
async function itemsToBuy(req: CheckoutPayload, buyerId?: string): Promise<{ items: CartItem[]; cartItemIds: string[] }> {
  if (!req.cartItemIds) return { items: req.items!, cartItemIds: [] };
  if (!buyerId) throw new HttpError(401, "Log in to check out your saved cart");
  const ids = [...new Set(req.cartItemIds)];
  const rows = await prisma.cartItem.findMany({ where: { id: { in: ids }, cart: { userId: buyerId } } });
  if (rows.length !== ids.length) throw new HttpError(409, "Some selected items are no longer in your cart. Refresh and try again.");
  return {
    items: rows.map((r) => ({ productId: r.productId, size: r.size || null, quantity: r.qty })),
    cartItemIds: rows.map((r) => r.id),
  };
}

/** Saved address/method (must be the buyer's own) or the new one typed at checkout. */
async function shippingAndPayment(req: CheckoutPayload, buyerId?: string) {
  if (!buyerId && (req.shipping.addressId || req.payment.paymentMethodId)) {
    throw new HttpError(401, "Log in to use saved addresses and payment methods");
  }
  const address: Address = req.shipping.addressId
    ? toAddressView(await ownedAddress(buyerId!, req.shipping.addressId))
    : req.shipping.address!;
  let summary: string;
  if (req.payment.paymentMethodId) {
    const pm = await ownedPaymentMethod(buyerId!, req.payment.paymentMethodId);
    if (pm.type === "CARD" && paymentExpired(pm.expMonth, pm.expYear)) {
      throw new HttpError(409, "That card has expired. Choose another payment method.", [{ path: "payment.paymentMethodId", message: "Card expired" }]);
    }
    summary = paymentSummary(pm);
  } else {
    // Only brand + last 4 survive; the full number in req is dropped with the request.
    summary = paymentSummary(paymentFields(req.payment.method!));
  }
  // Snapshot without the saved-address id/default flag, so later edits never touch past orders.
  const { label, recipientName, phone, line1, line2, postcode, city, state } = address;
  return { address: { label, recipientName, phone, line1, line2, postcode, city, state }, summary };
}

/** "Save for next time": best effort, after the order exists. A full address book never fails a purchase. */
async function saveForNextTime(req: CheckoutPayload, buyerId: string): Promise<void> {
  try {
    if (req.shipping.save && req.shipping.address) await addAddress(buyerId, req.shipping.address);
  } catch {
    // e.g. already at the 5-address limit.
  }
  try {
    if (req.payment.save && req.payment.method) await addPaymentMethod(buyerId, req.payment.method);
  } catch {
    // e.g. already at the 5-method limit.
  }
}

export async function checkout(req: CheckoutPayload, buyerId?: string): Promise<Order> {
  const { items, cartItemIds } = await itemsToBuy(req, buyerId);
  const { quote: cartQuote, sellerIds } = await priceItems(items);
  const { contact } = req;
  const { address, summary } = await shippingAndPayment(req, buyerId);

  // Sequential order numbers; two simultaneous checkouts can collide, so retry on the unique index.
  for (let attempt = 1; ; attempt++) {
    try {
      // Stock, order and cart cleanup succeed or fail together.
      const order = await prisma.$transaction(async (tx) => {
        for (const l of cartQuote.lines) {
          if (!l.size) continue; // Stock is tracked per size only.
          const { count } = await tx.variant.updateMany({
            where: { productId: l.productId, size: l.size, stock: { gte: l.quantity } },
            data: { stock: { decrement: l.quantity } },
          });
          if (count === 0) throw new HttpError(409, `${l.name} (size ${l.size}) just sold out`, [{ path: "items", message: `${l.name} (size ${l.size}) just sold out` }]);
        }
        const created = await tx.order.create({
          data: {
            orderNo: orderNumber((await tx.order.count()) + attempt),
            // Derived from the shipments; every shipment starts PENDING.
            status: "PENDING",
            email: contact.email,
            name: address.recipientName,
            address: `${formatAddress(address)} · ${address.phone}`,
            shippingAddress: JSON.stringify(address),
            paymentSummary: summary,
            quote: JSON.stringify(cartQuote),
            totalCents: cartQuote.totalCents,
            ...(buyerId && { buyer: { connect: { id: buyerId } } }),
            items: {
              create: cartQuote.lines.map((l, i) => ({
                productId: l.productId,
                sellerId: sellerIds[i]!,
                name: l.name,
                size: l.size,
                qty: l.quantity,
                priceCents: l.unitCents,
              })),
            },
            // Each seller ships (and gets tracking for) their own part of the order.
            shipments: { create: initialShipments(sellerIds, buyerId ?? null) },
          },
        });
        // Only what was bought leaves the cart; unselected lines stay.
        if (cartItemIds.length) await tx.cartItem.deleteMany({ where: { id: { in: cartItemIds } } });
        return created;
      });
      invalidateCatalog(); // Stock changed.
      if (buyerId) await saveForNextTime(req, buyerId);
      const eta = new Date(order.createdAt);
      eta.setDate(eta.getDate() + DELIVERY_DAYS);
      return {
        orderId: order.id,
        orderNo: order.orderNo!,
        email: order.email,
        quote: cartQuote,
        estimatedDelivery: eta.toISOString(),
      };
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= ORDER_NO_ATTEMPTS) throw err;
    }
  }
}
