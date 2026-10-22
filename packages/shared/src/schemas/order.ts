import { z } from "zod";
import { CartItemSchema, CartQuoteSchema } from "./cart";
import { AddressInputSchema, NewPaymentMethodSchema } from "./account";

export const CheckoutRequestSchema = z.object({
  // Exactly one of these: a logged-in buyer's selected cart lines, or a guest's localStorage items.
  // Either way, the server re-reads every price, stock level and shipping fee itself.
  items: z.array(CartItemSchema).min(1, "Your cart is empty").max(50).optional(),
  cartItemIds: z.array(z.string().min(1)).min(1, "Select at least one item").max(100).optional(),
  contact: z.object({
    email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  }),
  // A saved address (logged in) or a new one, optionally saved to the account.
  shipping: z
    .object({
      addressId: z.string().min(1).optional(),
      address: AddressInputSchema.optional(),
      save: z.boolean().default(false),
    })
    .refine((s) => !s.addressId !== !s.address, { message: "Choose or enter a shipping address", path: ["address"] }),
  // Mock payment. A saved method, or a new one; a card's CVV is checked in the browser and never sent.
  payment: z
    .object({
      paymentMethodId: z.string().min(1).optional(),
      method: NewPaymentMethodSchema.optional(),
      save: z.boolean().default(false),
    })
    .refine((p) => !p.paymentMethodId !== !p.method, { message: "Choose or enter a payment method", path: ["method"] }),
}).refine((r) => !r.items !== !r.cartItemIds, { message: "Send either cart item ids or items", path: ["items"] });
/** What the checkout form sends. */
export type CheckoutRequest = z.input<typeof CheckoutRequestSchema>;
/** What the server works with after validation (card number normalised). */
export type CheckoutPayload = z.output<typeof CheckoutRequestSchema>;

// ---- Shipments: one per (order, seller); each seller moves only their own. ----

export const SHIPMENT_STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;
export const ShipmentStatusSchema = z.enum(SHIPMENT_STATUSES);
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;

/** The happy path, in order. CANCELLED branches off it. */
export const SHIPMENT_FLOW: readonly ShipmentStatus[] = ["PENDING", "PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];

/** The only moves the server accepts; anything else is a 409. */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  PENDING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export const canTransition = (from: ShipmentStatus, to: ShipmentStatus) => SHIPMENT_TRANSITIONS[from].includes(to);

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  PENDING: "Order placed",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const COURIERS = ["Pos Laju", "J&T Express", "Ninja Van", "DHL eCommerce", "City-Link", "GDEX"] as const;
export type Courier = (typeof COURIERS)[number];

export const ShipmentUpdateSchema = z
  .object({
    status: ShipmentStatusSchema,
    note: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
    courier: z.enum(COURIERS, { error: "Choose a courier from the list" }).optional(),
    trackingNo: z.string().trim().toUpperCase().optional(),
    reason: z.string().trim().max(300, "Keep the reason under 300 characters").optional(),
  })
  .superRefine((u, ctx) => {
    if (u.status === "SHIPPED") {
      if (!u.courier) ctx.addIssue({ code: "custom", path: ["courier"], message: "Choose a courier" });
      if (!u.trackingNo || !/^[A-Z0-9]{8,30}$/.test(u.trackingNo)) {
        ctx.addIssue({ code: "custom", path: ["trackingNo"], message: "Use 8–30 letters and numbers" });
      }
    }
    if (u.status === "CANCELLED" && (u.reason ?? "").length < 3) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason for cancelling" });
    }
  });
export type ShipmentUpdate = z.input<typeof ShipmentUpdateSchema>;

// ---- Orders: status is derived from the shipments, never set by hand. ----

export const ORDER_STATUSES = [
  "PENDING",
  "PROCESSING",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Order placed",
  PROCESSING: "Processing",
  PARTIALLY_SHIPPED: "Partially shipped",
  SHIPPED: "Shipped",
  OUT_FOR_DELIVERY: "Out for delivery",
  PARTIALLY_DELIVERED: "Partially delivered",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

const IN_TRANSIT: readonly ShipmentStatus[] = ["SHIPPED", "OUT_FOR_DELIVERY"];

/** Cancelled shipments are ignored unless every shipment was cancelled. */
export function deriveOrderStatus(shipments: readonly ShipmentStatus[]): OrderStatus {
  const live = shipments.filter((s) => s !== "CANCELLED");
  if (live.length === 0) return "CANCELLED";
  if (live.every((s) => s === "DELIVERED")) return "DELIVERED";
  if (live.some((s) => s === "DELIVERED")) return "PARTIALLY_DELIVERED";
  if (live.every((s) => s === "OUT_FOR_DELIVERY")) return "OUT_FOR_DELIVERY";
  if (live.every((s) => IN_TRANSIT.includes(s))) return "SHIPPED";
  if (live.some((s) => IN_TRANSIT.includes(s))) return "PARTIALLY_SHIPPED";
  if (live.some((s) => s === "PROCESSING")) return "PROCESSING";
  return "PENDING";
}

export const TrackQuerySchema = z.object({
  orderNo: z.string().trim().min(1, "Enter your order number").transform((s) => s.toUpperCase()),
  email: z.email("Enter the email you used at checkout"),
});
export type TrackQuery = z.input<typeof TrackQuerySchema>;

export interface ShipmentItem {
  productId: string;
  name: string;
  size: string | null;
  qty: number;
  priceCents: number;
}

export interface ShipmentEventView {
  status: ShipmentStatus;
  note: string | null;
  createdAt: string;
}

export interface ShipmentView {
  id: string;
  sellerName: string;
  status: ShipmentStatus;
  courier: string | null;
  trackingNo: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: ShipmentItem[];
  subtotalCents: number;
  events: ShipmentEventView[];
}

/** Buyer / guest-tracking view: the whole order, one card per seller shipment. */
export interface OrderDetail {
  id: string;
  orderNo: string;
  status: OrderStatus;
  email: string;
  createdAt: string;
  totalCents: number;
  shipments: ShipmentView[];
}

export const SellerOrderQuerySchema = z.object({ status: ShipmentStatusSchema.optional() });

/** Seller views only ever contain that seller's shipment: their items and their subtotal. */
export interface SellerOrderRow {
  shipmentId: string;
  orderNo: string;
  createdAt: string;
  buyerName: string;
  itemCount: number;
  subtotalCents: number;
  status: ShipmentStatus;
}

export interface SellerOrderListResponse {
  items: SellerOrderRow[];
  counts: Record<ShipmentStatus | "ALL", number>;
}

export interface SellerShipmentDetail extends Omit<ShipmentView, "sellerName"> {
  orderNo: string;
  orderCreatedAt: string;
  buyerName: string;
  address: string;
  cancelReason: string | null;
  nextStatuses: ShipmentStatus[];
}

export const OrderSchema = z.object({
  orderId: z.string(),
  orderNo: z.string(),
  email: z.string(),
  quote: CartQuoteSchema,
  estimatedDelivery: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;
