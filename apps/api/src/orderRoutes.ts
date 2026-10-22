import { Router, type Response } from "express";
import type { OrderItem, Prisma } from "@prisma/client";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
  SellerOrderQuerySchema,
  ShipmentUpdateSchema,
  TrackQuerySchema,
  type OrderDetail,
  type OrderStatus,
  type SellerOrderListResponse,
  type SellerShipmentDetail,
  type ShipmentItem,
  type ShipmentStatus,
  type ShipmentView,
} from "@clearcart/shared";
import { prisma } from "./db";
import { HttpError, notFound } from "./errors";
import { currentUser, requireAuth } from "./middleware/auth";
import { parse } from "./middleware/validate";
import { changeShipmentStatus } from "./services/fulfilment";

const eventsInclude = { events: { orderBy: { createdAt: "asc" } } } satisfies Prisma.ShipmentInclude;

const orderInclude = {
  items: true,
  shipments: { include: { seller: { select: { name: true } }, ...eventsInclude }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.OrderInclude;

type OrderRecord = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
type ShipmentRecord = Prisma.ShipmentGetPayload<{ include: typeof eventsInclude }>;

const toItems = (items: OrderItem[]): ShipmentItem[] =>
  items.map((i) => ({ productId: i.productId, name: i.name, size: i.size, qty: i.qty, priceCents: i.priceCents }));
const subtotal = (items: OrderItem[]) => items.reduce((s, i) => s + i.priceCents * i.qty, 0);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Only the items this shipment's seller sold; never mixes sellers. */
function shipmentFields(s: ShipmentRecord, items: OrderItem[]): Omit<ShipmentView, "sellerName"> {
  return {
    id: s.id,
    status: s.status as ShipmentStatus,
    courier: s.courier,
    trackingNo: s.trackingNo,
    shippedAt: iso(s.shippedAt),
    deliveredAt: iso(s.deliveredAt),
    items: toItems(items),
    subtotalCents: subtotal(items),
    events: s.events.map((e) => ({ status: e.status as ShipmentStatus, note: e.note, createdAt: e.createdAt.toISOString() })),
  };
}

function toOrderDetail(o: OrderRecord): OrderDetail {
  return {
    id: o.id,
    orderNo: o.orderNo ?? o.id,
    status: o.status as OrderStatus,
    email: o.email,
    createdAt: o.createdAt.toISOString(),
    totalCents: o.totalCents,
    shipments: o.shipments.map((s) => ({
      sellerName: s.seller.name,
      ...shipmentFields(s, o.items.filter((i) => i.sellerId === s.sellerId)),
    })),
  };
}

async function sellerIdFor(res: Response): Promise<string> {
  const seller = await prisma.seller.findUnique({ where: { userId: currentUser(res).id } });
  if (!seller) throw notFound("Seller profile");
  return seller.id;
}

/** Missing and another seller's shipment look identical. */
async function sellerShipment(shipmentId: string, sellerId: string): Promise<SellerShipmentDetail> {
  const s = await prisma.shipment.findFirst({
    where: { id: shipmentId, sellerId },
    include: { ...eventsInclude, order: { include: { items: { where: { sellerId } } } } },
  });
  if (!s) throw notFound("Order");
  const status = s.status as ShipmentStatus;
  return {
    ...shipmentFields(s, s.order.items),
    orderNo: s.order.orderNo ?? s.order.id,
    orderCreatedAt: s.order.createdAt.toISOString(),
    buyerName: s.order.name,
    address: s.order.address,
    cancelReason: s.cancelReason,
    nextStatuses: [...SHIPMENT_TRANSITIONS[status]],
  };
}

export const orderRoutes = Router();

orderRoutes.get("/orders", requireAuth, async (_req, res) => {
  const orders = await prisma.order.findMany({
    where: { buyerId: currentUser(res).id },
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  res.json(orders.map(toOrderDetail));
});

orderRoutes.get("/orders/:orderNo", requireAuth, async (req, res) => {
  const order = await prisma.order.findUnique({ where: { orderNo: String(req.params.orderNo) }, include: orderInclude });
  // Someone else's order looks exactly like a missing one.
  if (!order || order.buyerId !== currentUser(res).id) throw notFound("Order");
  res.json(toOrderDetail(order));
});

/** Guest tracking: the order number alone isn't enough, the checkout email must match too. */
orderRoutes.get("/track", async (req, res) => {
  const { orderNo, email } = parse(TrackQuerySchema, req.query);
  const order = await prisma.order.findUnique({ where: { orderNo }, include: orderInclude });
  if (!order || order.email.toLowerCase() !== email.toLowerCase()) {
    throw new HttpError(404, "No order matches that number and email");
  }
  res.json(toOrderDetail(order));
});

// /api/seller/* is seller-only at the app level (app.ts); every query below is scoped to this seller.

orderRoutes.get("/seller/orders", async (req, res) => {
  const { status } = parse(SellerOrderQuerySchema, req.query);
  const sellerId = await sellerIdFor(res);
  const [shipments, grouped] = await Promise.all([
    prisma.shipment.findMany({
      where: { sellerId, ...(status && { status }) },
      include: { order: { include: { items: { where: { sellerId } } } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.shipment.groupBy({ by: ["status"], where: { sellerId }, _count: { _all: true } }),
  ]);

  const counts = Object.fromEntries([...SHIPMENT_STATUSES, "ALL"].map((s) => [s, 0])) as SellerOrderListResponse["counts"];
  for (const g of grouped) {
    counts[g.status as ShipmentStatus] = g._count._all;
    counts.ALL += g._count._all;
  }
  const body: SellerOrderListResponse = {
    items: shipments.map((s) => ({
      shipmentId: s.id,
      orderNo: s.order.orderNo ?? s.order.id,
      createdAt: s.order.createdAt.toISOString(),
      buyerName: s.order.name,
      itemCount: s.order.items.reduce((n, i) => n + i.qty, 0),
      subtotalCents: subtotal(s.order.items),
      status: s.status as ShipmentStatus,
    })),
    counts,
  };
  res.json(body);
});

orderRoutes.get("/seller/orders/:shipmentId", async (req, res) => {
  res.json(await sellerShipment(String(req.params.shipmentId), await sellerIdFor(res)));
});

orderRoutes.post("/seller/orders/:shipmentId/status", async (req, res) => {
  const change = parse(ShipmentUpdateSchema, req.body);
  const sellerId = await sellerIdFor(res);
  const shipmentId = String(req.params.shipmentId);
  await changeShipmentStatus(shipmentId, sellerId, currentUser(res).id, change);
  res.json(await sellerShipment(shipmentId, sellerId));
});
