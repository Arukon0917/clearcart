import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Check, Copy, Package, Truck, X } from "lucide-react";
import {
  ORDER_STATUS_LABELS,
  SHIPMENT_FLOW,
  SHIPMENT_STATUS_LABELS,
  type OrderDetail,
  type ShipmentEventView,
  type ShipmentStatus,
  type ShipmentView,
} from "@clearcart/shared";
import { RequireAuth } from "../RequireAuth";
import { api, money } from "../lib/api";
import { useAuth } from "../lib/auth";

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Buyer-only pages: guests are sent to log in (they can still use /track). */
function RequireLogin({ children }: { children: ReactNode }) {
  return <RequireAuth role="BUYER">{children}</RequireAuth>;
}

const STATUS_TONE: Record<ShipmentStatus, string> = {
  PENDING: "bg-raised text-muted",
  PROCESSING: "bg-warn-soft text-warn",
  SHIPPED: "bg-brand-50 text-brand-700",
  OUT_FOR_DELIVERY: "bg-brand-50 text-brand-700",
  DELIVERED: "bg-brand-600 text-on-accent",
  CANCELLED: "bg-bad-soft text-bad",
};

export function ShipmentBadge({ status }: { status: ShipmentStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>{SHIPMENT_STATUS_LABELS[status]}</span>;
}

/** What happened (with timestamps and notes), followed by the steps still to come. */
export function ShipmentTimeline({ status, events }: { status: ShipmentStatus; events: ShipmentEventView[] }) {
  const upcoming = status === "CANCELLED" ? [] : SHIPMENT_FLOW.slice(SHIPMENT_FLOW.indexOf(status) + 1);
  return (
    <ol className="relative ml-3 border-l-2 border-line">
      {events.map((e, i) => (
        <li key={i} className="mb-5 ml-6 last:mb-0">
          <span className={`absolute -left-[13px] grid size-6 place-items-center rounded-full text-on-accent ${e.status === "CANCELLED" ? "bg-bad" : "bg-brand-600"}`}>
            {e.status === "CANCELLED" ? <X className="size-3.5" /> : <Check className="size-3.5" />}
          </span>
          <p className="font-semibold">{SHIPMENT_STATUS_LABELS[e.status]}</p>
          <p className="text-xs text-muted">{formatDate(e.createdAt)}</p>
          {e.note && <p className="mt-0.5 text-sm">{e.note}</p>}
        </li>
      ))}
      {upcoming.map((s) => (
        <li key={s} className="mb-5 ml-6 last:mb-0">
          <span className="absolute -left-[13px] size-6 rounded-full border-2 border-line-strong bg-surface" />
          <p className="text-muted">{SHIPMENT_STATUS_LABELS[s]}</p>
        </li>
      ))}
    </ol>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context or permission): the number is still selectable.
    }
  };
  return (
    <button type="button" onClick={copy} aria-label="Copy tracking number" className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-0.5 text-xs hover:bg-subtle">
      {copied ? <Check className="size-3.5 text-brand-600" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** `reviewable`: the buyer's own order page; guests on /track can't review. */
function ShipmentCard({ shipment: s, reviewable }: { shipment: ShipmentView; reviewable: boolean }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Sold by {s.sellerName}</h2>
        <ShipmentBadge status={s.status} />
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <ul className="divide-y divide-line-soft text-sm">
            {s.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{i.name}</span>
                  <span className="text-muted">{i.size ? ` · Size ${i.size}` : ""} × {i.qty}</span>
                </span>
                <span className="flex items-center gap-3">
                  {reviewable && s.status === "DELIVERED" && (
                    <Link to={`/p/${i.productId}#write-review`} className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium hover:bg-subtle">
                      Review
                    </Link>
                  )}
                  {money(i.priceCents * i.qty)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t border-line pt-2 text-sm font-semibold">
            <span>Items from this seller</span>
            <span>{money(s.subtotalCents)}</span>
          </p>
          {s.trackingNo ? (
            <div className="mt-4 rounded-xl bg-subtle p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><Truck className="size-4" /> {s.courier ?? "Courier"}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-muted">Tracking no.</span>
                <span className="select-all font-mono font-semibold">{s.trackingNo}</span>
                <CopyButton text={s.trackingNo} />
              </p>
            </div>
          ) : (
            s.status !== "CANCELLED" && <p className="mt-4 text-sm text-muted">Tracking details appear once the seller ships.</p>
          )}
        </div>
        <ShipmentTimeline status={s.status} events={s.events} />
      </div>
    </section>
  );
}

function OrderView({ order, reviewable = false }: { order: OrderDetail; reviewable?: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Order {order.orderNo}</h1>
          <p className="text-muted">
            Placed {formatDate(order.createdAt)} · {ORDER_STATUS_LABELS[order.status]}
            {order.shipments.length > 1 && ` · ships in ${order.shipments.length} parcels`}
          </p>
        </div>
        <p className="text-lg font-semibold">Total paid {money(order.totalCents)}</p>
      </div>
      {order.shipments.map((s) => <ShipmentCard key={s.id} shipment={s} reviewable={reviewable} />)}
    </div>
  );
}

function OrdersList() {
  const { user } = useAuth();
  const orders = useQuery({ queryKey: ["orders", user?.id], queryFn: api.orders, staleTime: 0 });
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">My orders</h1>
      {orders.isPending && <div className="h-40 animate-pulse rounded-card bg-line" />}
      {orders.isError && <p className="text-bad">{orders.error.message}</p>}
      {orders.data?.length === 0 && <p className="mt-10 text-center text-muted">No orders yet.</p>}
      <ul className="space-y-3">
        {orders.data?.map((o) => (
          <li key={o.id}>
            <Link to={`/orders/${encodeURIComponent(o.orderNo)}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 hover:border-brand-600">
              <Package className="size-6 text-muted" />
              <span className="flex-1">
                <span className="block font-semibold">{o.orderNo}</span>
                <span className="text-sm text-muted">
                  {formatDate(o.createdAt)} · {o.shipments.reduce((n, s) => n + s.items.reduce((m, i) => m + i.qty, 0), 0)} items
                  {o.shipments.length > 1 && ` from ${o.shipments.length} sellers`}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-semibold">{money(o.totalCents)}</span>
                <span className="text-sm text-brand-700">{ORDER_STATUS_LABELS[o.status]}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrderDetailView() {
  const { orderNo = "" } = useParams();
  const order = useQuery({ queryKey: ["order", orderNo], queryFn: () => api.order(orderNo), staleTime: 0 });
  return (
    <div>
      <Link to="/orders" className="text-sm text-muted hover:text-ink">← My orders</Link>
      <div className="mt-3">
        {order.isPending && <div className="h-40 animate-pulse rounded-card bg-line" />}
        {order.isError && <p className="text-bad">{order.error.message}</p>}
        {order.data && <OrderView order={order.data} reviewable />}
      </div>
    </div>
  );
}

export function OrdersPage() {
  return (
    <RequireLogin>
      <OrdersList />
    </RequireLogin>
  );
}

export function OrderDetailPage() {
  return (
    <RequireLogin>
      <OrderDetailView />
    </RequireLogin>
  );
}

/** Public: guests look up an order with its number plus the checkout email. */
export function TrackPage() {
  const [params, setParams] = useSearchParams();
  const orderNo = params.get("orderNo") ?? "";
  const email = params.get("email") ?? "";
  const order = useQuery({
    queryKey: ["track", orderNo, email],
    queryFn: () => api.track(orderNo, email),
    enabled: !!orderNo && !!email,
    retry: false,
    staleTime: 0,
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setParams({ orderNo: String(form.get("orderNo") ?? "").trim(), email: String(form.get("email") ?? "").trim() });
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Track your package</h1>
      <form onSubmit={onSubmit} className="mb-8 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-5">
        <label className="flex-1 text-sm font-medium">
          Order number
          <input name="orderNo" required defaultValue={orderNo} placeholder="CC-2026-000123" className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2" />
        </label>
        <label className="flex-1 text-sm font-medium">
          Email used at checkout
          <input name="email" type="email" required defaultValue={email} className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2" />
        </label>
        <button disabled={order.isFetching} className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-60">
          {order.isFetching ? "Looking up…" : "Track"}
        </button>
      </form>
      {order.isFetching && <div className="h-40 animate-pulse rounded-card bg-line" />}
      {order.isError && <p className="text-bad">{order.error.message}</p>}
      {order.data && !order.isFetching && <OrderView order={order.data} />}
    </div>
  );
}
