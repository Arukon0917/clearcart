import type { Prisma } from "@prisma/client";
import {
  SHIPMENT_STATUS_LABELS,
  ShipmentUpdateSchema,
  canTransition,
  deriveOrderStatus,
  type ShipmentStatus,
} from "@clearcart/shared";
import type { z } from "zod";
import { prisma } from "../db";
import { HttpError, notFound } from "../errors";

type ShipmentChange = z.output<typeof ShipmentUpdateSchema>;

/** Nested-create data for checkout: one PENDING shipment per seller in the cart. */
export function initialShipments(sellerIds: string[], actorUserId: string | null) {
  return [...new Set(sellerIds)].map((sellerId) => ({
    sellerId,
    status: "PENDING",
    events: { create: { status: "PENDING", note: "Order placed", actorUserId } },
  }));
}

/** Order.status is a cache of the shipments' state, recomputed after every shipment change. */
async function syncOrderStatus(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const shipments = await tx.shipment.findMany({ where: { orderId }, select: { status: true } });
  await tx.order.update({
    where: { id: orderId },
    data: { status: deriveOrderStatus(shipments.map((s) => s.status as ShipmentStatus)) },
  });
}

/** Applies one workflow step to the seller's own shipment. Invalid moves and lost races are 409s. */
export async function changeShipmentStatus(
  shipmentId: string,
  sellerId: string,
  actorUserId: string,
  change: ShipmentChange,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findFirst({ where: { id: shipmentId, sellerId } });
    if (!shipment) throw notFound("Order");
    const from = shipment.status as ShipmentStatus;
    const to = change.status;
    if (!canTransition(from, to)) {
      throw new HttpError(409, `An order that is "${SHIPMENT_STATUS_LABELS[from]}" can't be moved to "${SHIPMENT_STATUS_LABELS[to]}"`);
    }

    const now = new Date();
    // Conditional on the status we validated against, so two tabs can't both apply a move.
    const { count } = await tx.shipment.updateMany({
      where: { id: shipment.id, status: from },
      data: {
        status: to,
        ...(to === "SHIPPED" && { courier: change.courier, trackingNo: change.trackingNo, shippedAt: now }),
        ...(to === "DELIVERED" && { deliveredAt: now }),
        ...(to === "CANCELLED" && { cancelReason: change.reason }),
      },
    });
    if (count === 0) throw new HttpError(409, "This order was just updated elsewhere. Refresh and try again.");

    const note = to === "CANCELLED" ? [change.reason, change.note].filter(Boolean).join(" · ") : change.note || null;
    await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: to, note, actorUserId, createdAt: now } });
    await syncOrderStatus(tx, shipment.orderId);
  });
}

const LEGACY_STATUS: Record<string, ShipmentStatus> = {
  PLACED: "PENDING",
  PACKED: "PROCESSING",
  SHIPPED: "SHIPPED",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
};

/**
 * Orders placed before per-seller shipments get one shipment per seller, carrying over the old
 * order-level status and history. Idempotent: only touches orders that have no shipments yet.
 */
export async function backfillShipments(): Promise<number> {
  const orders = await prisma.order.findMany({
    where: { shipments: { none: {} } },
    include: { items: { select: { sellerId: true } }, events: { orderBy: { createdAt: "asc" } } },
  });
  let migrated = 0;
  for (const order of orders) {
    const sellerIds = [...new Set(order.items.map((i) => i.sellerId))];
    if (sellerIds.length === 0) continue;
    const status = LEGACY_STATUS[order.status] ?? "PENDING";
    const at = (s: string) => order.events.find((e) => e.status === s)?.createdAt ?? null;
    const shipped = ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status);
    await prisma.$transaction([
      ...sellerIds.map((sellerId) =>
        prisma.shipment.create({
          data: {
            orderId: order.id,
            sellerId,
            status,
            trackingNo: shipped ? order.trackingNo : null,
            shippedAt: shipped ? at("SHIPPED") : null,
            deliveredAt: status === "DELIVERED" ? at("DELIVERED") : null,
            createdAt: order.createdAt,
            events: {
              create: order.events.map((e) => ({ status: LEGACY_STATUS[e.status] ?? "PENDING", note: e.note, createdAt: e.createdAt })),
            },
          },
        }),
      ),
      prisma.order.update({ where: { id: order.id }, data: { status: deriveOrderStatus(sellerIds.map(() => status)) } }),
    ]);
    migrated++;
  }
  return migrated;
}
