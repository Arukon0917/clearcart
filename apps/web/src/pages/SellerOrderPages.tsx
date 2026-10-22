import { useCallback, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MapPin } from "lucide-react";
import {
  COURIERS,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
  ShipmentUpdateSchema,
  type SellerShipmentDetail,
  type ShipmentStatus,
  type ShipmentUpdate,
} from "@clearcart/shared";
import { ApiError, api, money } from "../lib/api";
import { Toast } from "../components";
import { RequireSeller } from "./SellerPage";
import { ShipmentBadge, ShipmentTimeline, formatDate } from "./OrderPages";

const isStatus = (s: string | null): s is ShipmentStatus => SHIPMENT_STATUSES.includes(s as ShipmentStatus);

function OrdersList() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("status");
  const status = isStatus(raw) ? raw : undefined;
  const orders = useQuery({ queryKey: ["seller-orders", status ?? "ALL"], queryFn: () => api.sellerOrders(status), staleTime: 0 });
  const counts = orders.data?.counts;
  const tabs: (ShipmentStatus | "ALL")[] = ["ALL", ...SHIPMENT_STATUSES];

  return (
    <div>
      <Link to="/seller" className="text-sm text-muted hover:text-ink">← Your store</Link>
      <h1 className="mt-2 text-2xl font-bold">Orders</h1>

      <div role="tablist" className="mt-4 flex gap-4 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const active = (status ?? "ALL") === t;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setParams(t === "ALL" ? {} : { status: t })}
              className={`whitespace-nowrap border-b-2 px-1 pb-2 text-sm font-medium ${active ? "border-brand-600 text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t === "ALL" ? "All" : SHIPMENT_STATUS_LABELS[t]}
              {counts && <span className="ml-1.5 rounded-full bg-raised px-1.5 text-xs">{counts[t]}</span>}
            </button>
          );
        })}
      </div>

      {orders.isPending && <div className="mt-6 h-40 animate-pulse rounded-card bg-line" />}
      {orders.isError && <p className="mt-6 text-bad">{orders.error.message}</p>}
      {orders.data?.items.length === 0 && (
        <p className="mt-10 text-center text-muted">{status ? `No ${SHIPMENT_STATUS_LABELS[status].toLowerCase()} orders.` : "No orders yet."}</p>
      )}

      {!!orders.data?.items.length && (
        <div className="mt-4 overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3 font-medium">Order</th>
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Buyer</th>
                <th className="p-3 font-medium">Items</th>
                <th className="p-3 font-medium">Your subtotal</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.items.map((o) => (
                <tr key={o.shipmentId} className="border-t border-line-soft hover:bg-subtle">
                  <td className="p-3">
                    <Link to={`/seller/orders/${o.shipmentId}`} className="font-medium text-brand-700 hover:underline">{o.orderNo}</Link>
                  </td>
                  <td className="p-3 text-muted">{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td className="p-3">{o.buyerName}</td>
                  <td className="p-3">{o.itemCount}</td>
                  <td className="p-3">{money(o.subtotalCents)}</td>
                  <td className="p-3"><ShipmentBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const firstSegment = (path: string) => path.split(".")[0]!;
const inputClass = (error?: string) => `mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm ${error ? "border-bad" : "border-line-strong"}`;

/** Offers only the moves the workflow allows from the current status. */
function UpdatePanel({ shipment, onSaved }: { shipment: SellerShipmentDetail; onSaved: (s: SellerShipmentDetail) => void }) {
  const [next, setNext] = useState<ShipmentStatus | "">(shipment.nextStatuses[0] ?? "");
  const [courier, setCourier] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = useMutation({
    mutationFn: (change: ShipmentUpdate) => api.updateShipment(shipment.id, change),
    onSuccess: (saved) => {
      setNote("");
      setReason("");
      setNext(saved.nextStatuses[0] ?? "");
      onSaved(saved);
    },
    onError: (err) =>
      setErrors(
        err instanceof ApiError && err.details?.length
          ? Object.fromEntries(err.details.map((d) => [firstSegment(d.path), d.message]))
          : { form: err.message },
      ),
  });

  if (shipment.nextStatuses.length === 0) {
    return <p className="text-sm text-muted">This order is {SHIPMENT_STATUS_LABELS[shipment.status].toLowerCase()}. No further updates.</p>;
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!next) return;
    const change: ShipmentUpdate = {
      status: next,
      note: note || undefined,
      ...(next === "SHIPPED" && { courier: (courier || undefined) as ShipmentUpdate["courier"], trackingNo }),
      ...(next === "CANCELLED" && { reason }),
    };
    const result = ShipmentUpdateSchema.safeParse(change);
    if (!result.success) {
      return setErrors(Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message])));
    }
    setErrors({});
    update.mutate(change);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <fieldset>
        <legend className="text-sm font-medium">Move to</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {shipment.nextStatuses.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={next === s}
              onClick={() => { setNext(s); setErrors({}); }}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                next === s ? (s === "CANCELLED" ? "border-bad bg-bad text-on-accent" : "border-brand-600 bg-brand-600 text-on-accent") : "border-line-strong bg-surface"
              }`}
            >
              {s === "CANCELLED" ? "Cancel order" : SHIPMENT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </fieldset>

      {next === "SHIPPED" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Courier
            <select value={courier} onChange={(e) => setCourier(e.target.value)} className={inputClass(errors.courier)}>
              <option value="">Choose…</option>
              {COURIERS.map((c) => <option key={c}>{c}</option>)}
            </select>
            {errors.courier && <span className="text-xs text-bad">{errors.courier}</span>}
          </label>
          <label className="text-sm">Tracking number
            <input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} maxLength={30} placeholder="e.g. EP123456789MY" className={`${inputClass(errors.trackingNo)} font-mono uppercase`} />
            {errors.trackingNo && <span className="text-xs text-bad">{errors.trackingNo}</span>}
          </label>
        </div>
      )}
      {next === "CANCELLED" && (
        <label className="block text-sm">Reason (shown to the buyer)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Item is out of stock" className={inputClass(errors.reason)} />
          {errors.reason && <span className="text-xs text-bad">{errors.reason}</span>}
        </label>
      )}
      <label className="block text-sm">Note <span className="text-muted">(optional, shown on the timeline)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass(errors.note)} />
        {errors.note && <span className="text-xs text-bad">{errors.note}</span>}
      </label>
      {errors.form && <p className="text-sm text-bad" role="alert">{errors.form}</p>}
      <button disabled={!next || update.isPending} className="w-full rounded-xl bg-brand-600 py-2.5 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-60">
        {update.isPending ? "Updating…" : "Update status"}
      </button>
    </form>
  );
}

function OrderDetail() {
  const { shipmentId = "" } = useParams();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const shipment = useQuery({ queryKey: ["seller-order", shipmentId], queryFn: () => api.sellerOrder(shipmentId), staleTime: 0 });

  const onSaved = (saved: SellerShipmentDetail) => {
    queryClient.setQueryData(["seller-order", shipmentId], saved);
    queryClient.invalidateQueries({ queryKey: ["seller-orders"] });
    setToast(`Marked as ${SHIPMENT_STATUS_LABELS[saved.status].toLowerCase()}`);
  };

  if (shipment.isPending) return <div className="h-96 animate-pulse rounded-card bg-line" />;
  if (shipment.isError) {
    return <p className="py-20 text-center text-muted">{shipment.error.message}. <Link to="/seller/orders" className="text-brand-700 underline">Back to orders</Link></p>;
  }
  const s = shipment.data;

  return (
    <div>
      <Link to="/seller/orders" className="text-sm text-muted hover:text-ink">← Orders</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Order {s.orderNo}</h1>
        <ShipmentBadge status={s.status} />
      </div>
      <p className="text-muted">Placed {formatDate(s.orderCreatedAt)} by {s.buyerName}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-3 font-semibold">Your items</h2>
            <ul className="divide-y divide-line-soft text-sm">
              {s.items.map((i, idx) => (
                <li key={idx} className="flex justify-between gap-3 py-2">
                  <span><span className="font-medium">{i.name}</span><span className="text-muted">{i.size ? ` · Size ${i.size}` : ""} × {i.qty}</span></span>
                  <span>{money(i.priceCents * i.qty)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between border-t border-line pt-2 font-semibold"><span>Your subtotal</span><span>{money(s.subtotalCents)}</span></p>
          </section>
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><MapPin className="size-4" /> Ship to</h2>
            <p className="text-sm">{s.buyerName}<br />{s.address}</p>
            {s.trackingNo && <p className="mt-3 text-sm text-muted">{s.courier} · <span className="font-mono text-ink">{s.trackingNo}</span></p>}
          </section>
          <section className="rounded-card border border-line bg-surface p-5">
            <h2 className="mb-4 font-semibold">Timeline</h2>
            <ShipmentTimeline status={s.status} events={s.events} />
          </section>
        </div>
        <aside className="h-fit rounded-card border border-line bg-surface p-5 lg:sticky lg:top-20">
          <h2 className="mb-3 font-semibold">Update status</h2>
          {/* Keyed by status so the panel resets to the new set of valid moves after each update. */}
          <UpdatePanel key={s.status} shipment={s} onSaved={onSaved} />
        </aside>
      </div>
      {toast && <Toast message={toast} onDone={clearToast} />}
    </div>
  );
}

export function SellerOrdersPage() {
  return (
    <RequireSeller>
      <OrdersList />
    </RequireSeller>
  );
}

export function SellerOrderDetailPage() {
  return (
    <RequireSeller>
      <OrderDetail />
    </RequireSeller>
  );
}
