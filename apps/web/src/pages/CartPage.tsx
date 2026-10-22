import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { CheckCircle2, ImageOff, LogIn, Minus, Plus, ShoppingCart, Store, Trash2, X } from "lucide-react";
import { isSelectable, type CartLineView, type Order } from "@clearcart/shared";
import { money } from "../lib/api";
import { saveCheckoutPick, useCart } from "../lib/cart";
import { ConfirmDialog, ProductImage } from "../components";
import { CheckoutForm, totals } from "./CheckoutForm";

const REASON: Partial<Record<CartLineView["status"], string>> = {
  out_of_stock: "Out of stock",
  unavailable: "No longer available",
};

/** Desktop column template, shared by the header row and every item row so they line up. */
const GRID = "md:grid-cols-[32px_80px_minmax(0,1fr)_120px_130px_120px_44px]";
const checkboxClass = "size-4 shrink-0 accent-brand-600 disabled:opacity-40";

function TriCheckbox({ checked, indeterminate, disabled, label, onChange }: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled}
      onChange={(e) => onChange(e.target.checked)} className={checkboxClass} />
  );
}

/** Checked / indeterminate state for a set of lines; unavailable lines don't count. */
function selection(lines: CartLineView[]) {
  const selectable = lines.filter((l) => isSelectable(l.status));
  const picked = selectable.filter((l) => l.selected).length;
  return {
    ids: selectable.map((l) => l.id),
    checked: picked > 0 && picked === selectable.length,
    indeterminate: picked > 0 && picked < selectable.length,
    disabled: selectable.length === 0,
  };
}

/** Fixed 80×80 square. A missing or broken photo becomes a neutral placeholder, never a broken icon. */
function CartThumb({ line, dim }: { line: CartLineView; dim: boolean }) {
  const [failed, setFailed] = useState(false);
  const box = `size-20 shrink-0 overflow-hidden rounded-lg bg-surface ${dim ? "grayscale" : ""}`;
  if (line.thumbnailUrl && !failed) {
    return (
      <div className={box}>
        <img src={line.thumbnailUrl} alt={line.name} loading="lazy" onError={() => setFailed(true)} className="aspect-square size-full object-cover" />
      </div>
    );
  }
  if (!failed && line.category) {
    return (
      <div className={box} role="img" aria-label={line.name}>
        <ProductImage hue={line.imageHue} category={line.category} className="size-full" />
      </div>
    );
  }
  return (
    <div className={`${box} grid place-items-center text-muted`} role="img" aria-label={`${line.name} (no photo)`}>
      <ImageOff className="size-6" />
    </div>
  );
}

function Stepper({ line, usable, cart }: { line: CartLineView; usable: boolean; cart: ReturnType<typeof useCart> }) {
  return (
    <div className="flex w-[110px] flex-col items-center">
      <div className="flex items-center rounded-lg border border-line-strong" aria-label={`Quantity of ${line.name}`}>
        <button type="button" aria-label="Decrease quantity" disabled={!usable || line.qty <= 1} onClick={() => cart.setQty(line.id, line.qty - 1)}
          className="grid size-8 place-items-center disabled:opacity-30"><Minus className="size-3.5" /></button>
        <span className="w-8 text-center text-sm tabular-nums">{line.qty}</span>
        <button type="button" aria-label="Increase quantity" disabled={!usable || line.qty >= line.maxQty} onClick={() => cart.setQty(line.id, line.qty + 1)}
          className="grid size-8 place-items-center disabled:opacity-30"><Plus className="size-3.5" /></button>
      </div>
      {usable && <span className="mt-1 text-[11px] text-muted">{line.stock !== null ? `${line.stock} in stock` : `Max ${line.maxQty}`}</span>}
    </div>
  );
}

/**
 * One grid row on desktop; on mobile a card (checkbox + image | details, then quantity/total/remove).
 * The bottom-row wrapper uses `md:contents` so its children become desktop grid cells.
 */
function CartRow({ line, cart }: { line: CartLineView; cart: ReturnType<typeof useCart> }) {
  const usable = isSelectable(line.status);
  const reason = REASON[line.status] ?? (line.qty > line.maxQty ? `Only ${line.maxQty} left` : null);
  const lineTotal = line.unitCents !== null ? money(line.unitCents * line.qty) : "—";
  const unitPrice = line.unitCents !== null && (
    <>
      {line.previousUnitCents !== null && <span className="mr-1 text-xs text-muted line-through">{money(line.previousUnitCents)}</span>}
      {money(line.unitCents)}
    </>
  );

  return (
    <li className={`grid grid-cols-[24px_80px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 px-4 py-3 ${GRID} md:gap-y-0 ${usable ? "" : "bg-subtle/60"}`}>
      <input type="checkbox" aria-label={`Select ${line.name}`} checked={line.selected} disabled={!usable}
        onChange={(e) => cart.setSelected([line.id], e.target.checked)} className={checkboxClass} />
      <CartThumb line={line} dim={!usable} />
      <div className={`min-w-0 ${usable ? "" : "opacity-60"}`}>
        {line.slug ? (
          <Link to={`/p/${line.slug}`} title={line.name} className="line-clamp-2 break-words text-sm font-medium hover:underline">{line.name}</Link>
        ) : (
          <span title={line.name} className="line-clamp-2 break-words text-sm font-medium">{line.name}</span>
        )}
        <p className="mt-0.5 text-xs text-muted">
          {line.size && <>Size {line.size}</>}
          {line.size && (reason || line.previousUnitCents !== null) && " · "}
          {reason && <span className="font-medium text-bad">{reason}</span>}
          {!reason && line.previousUnitCents !== null && <span className="text-warn">Price changed</span>}
        </p>
        <p className="mt-1 text-sm tabular-nums md:hidden">{unitPrice}</p>
      </div>
      <p className={`hidden text-right text-sm tabular-nums md:block ${usable ? "" : "opacity-60"}`}>{unitPrice}</p>

      <div className="col-span-3 flex items-center justify-between gap-3 border-t border-line-soft pt-3 md:contents">
        <div className="flex justify-center"><Stepper line={line} usable={usable} cart={cart} /></div>
        <p className={`ml-auto text-right text-sm font-semibold tabular-nums md:ml-0 ${usable ? "" : "opacity-60"}`}>{lineTotal}</p>
        <button type="button" aria-label={`Remove ${line.name}`} onClick={() => cart.remove([line.id])}
          className="grid size-10 place-items-center justify-self-end rounded-lg text-muted hover:bg-raised hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
          <Trash2 className="size-4" />
        </button>
      </div>
    </li>
  );
}

/** Keeps the page's bottom padding equal to the fixed summary bar, so it never covers the last row. */
function useBarHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, height };
}

/** Where the guest modal sends people: back to the cart, then on to checkout once logged in. */
const CHECKOUT_LOGIN_QUERY = `?${new URLSearchParams({ next: "/cart", checkout: "1" })}`;

/** Guests can fill a cart but must log in to pay. Their cart (and what's ticked) survives the login. */
function LoginToCheckoutDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="login-checkout-title" onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-card bg-surface p-6 text-center shadow-xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 rounded p-1 text-muted hover:bg-raised"><X className="size-5" /></button>
        <LogIn className="mx-auto size-8 text-brand-600" aria-hidden />
        <h2 id="login-checkout-title" className="mt-2 text-lg font-semibold">Log in to check out</h2>
        <p className="mt-1 text-sm text-muted">Your cart will be saved.</p>
        <div className="mt-5 grid gap-2">
          <Link to={`/login${CHECKOUT_LOGIN_QUERY}`} autoFocus className="rounded-xl bg-brand-600 py-2.5 font-semibold text-on-accent hover:bg-brand-700">Log in</Link>
          <Link to={`/register${CHECKOUT_LOGIN_QUERY}`} className="rounded-xl border border-line-strong py-2.5 font-semibold hover:bg-subtle">Create account</Link>
        </div>
      </div>
    </div>
  );
}

function CartList({ cart }: { cart: ReturnType<typeof useCart> }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [askLogin, setAskLogin] = useState(false);
  const bar = useBarHeight();
  const items = cart.view!.items;
  const groups = [...items.reduce((m, l) => m.set(l.sellerName, [...(m.get(l.sellerName) ?? []), l]), new Map<string, CartLineView[]>())];
  const selected = items.filter((l) => l.selected && isSelectable(l.status));
  const all = selection(items);
  const t = totals(selected);
  const checkout = () => {
    if (cart.isGuest) {
      // Remembered so the same lines are ticked at checkout after the login merges the cart.
      saveCheckoutPick(selected);
      setAskLogin(true);
    } else {
      navigate("/checkout");
      window.scrollTo(0, 0);
    }
  };

  return (
    <div style={{ paddingBottom: bar.height + 16 }}>
      <h1 className="mb-4 text-2xl font-bold">Cart</h1>

      <div className={`hidden items-center gap-x-3 rounded-card border border-line bg-surface px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted md:mb-4 md:grid ${GRID}`}>
        <TriCheckbox label="Select all" {...all} onChange={(v) => cart.setSelected(all.ids, v)} />
        <span className="col-span-2">Product</span>
        <span className="text-right">Unit price</span>
        <span className="text-center">Quantity</span>
        <span className="text-right">Total</span>
        <span />
      </div>

      <div className="space-y-4">
        {groups.map(([seller, lines]) => {
          const g = selection(lines);
          return (
            <section key={seller} className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="flex items-center gap-3 border-b border-line bg-subtle px-4 py-3">
                <TriCheckbox label={`Select all from ${seller}`} {...g} onChange={(v) => cart.setSelected(g.ids, v)} />
                <Store className="size-4 text-muted" aria-hidden />
                <h2 className="truncate font-semibold">{seller}</h2>
              </div>
              <ul className="divide-y divide-line-soft">
                {lines.map((l) => <CartRow key={l.id} line={l} cart={cart} />)}
              </ul>
            </section>
          );
        })}
      </div>

      <div ref={bar.ref} className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface shadow-[0_-4px_16px_var(--color-shadow)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <TriCheckbox label="Select all" {...all} onChange={(v) => cart.setSelected(all.ids, v)} /> Select all
          </label>
          <button type="button" disabled={selected.length === 0} onClick={() => setConfirming(true)} className="text-sm text-bad hover:underline disabled:text-muted disabled:no-underline">
            Remove selected
          </button>
          <div className="ml-auto text-right text-sm">
            <p>Selected ({selected.length}) · <span className="text-lg font-bold tabular-nums">{money(t.totalCents)}</span></p>
            <p className="text-xs text-muted tabular-nums">
              Items {money(t.subtotalCents)} · Shipping {t.shippingCents ? money(t.shippingCents) : "Free"} · Tax {money(t.taxCents)}
            </p>
          </div>
          <button type="button" disabled={selected.length === 0} onClick={checkout}
            className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-50">
            Checkout ({selected.length})
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Remove selected items?"
          message={`${selected.length} item${selected.length === 1 ? "" : "s"} will be removed from your cart.`}
          confirmLabel="Remove"
          onConfirm={() => { cart.remove(selected.map((l) => l.id)); setConfirming(false); }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {askLogin && <LoginToCheckoutDialog onClose={() => setAskLogin(false)} />}
    </div>
  );
}

function Confirmation({ order }: { order: Order }) {
  return (
    <div className="mx-auto max-w-md rounded-card border border-line bg-surface p-8 text-center">
      <CheckCircle2 className="mx-auto size-12 text-brand-600" />
      <h1 className="mt-3 text-2xl font-bold">Order placed</h1>
      <p className="mt-1 text-muted">Order <span className="font-semibold text-ink">{order.orderNo}</span> · confirmation sent to {order.email}</p>
      <p className="mt-4 text-3xl font-bold">{money(order.quote.totalCents)}</p>
      <p className="text-sm text-muted">Arrives by {new Date(order.estimatedDelivery).toLocaleDateString()}.</p>
      <div className="mt-6 flex justify-center gap-2">
        <Link to={`/track?${new URLSearchParams({ orderNo: order.orderNo, email: order.email })}`} className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-on-accent">Track package</Link>
        <Link to="/" className="rounded-xl border border-line-strong px-5 py-2.5 font-semibold">Keep shopping</Link>
      </div>
    </div>
  );
}

export function CartPage() {
  const cart = useCart();
  if (cart.isPending) return <div className="h-64 animate-pulse rounded-card bg-line" />;
  if (cart.error && !cart.view) {
    return (
      <p className="py-20 text-center text-bad">
        {cart.error.message} <button type="button" onClick={() => cart.refetch()} className="text-brand-700 underline">Try again</button>
      </p>
    );
  }
  const items = cart.view?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <ShoppingCart className="mx-auto size-12 text-muted" />
        <h1 className="mt-3 text-xl font-semibold">Your cart is empty</h1>
        <p className="mt-1 text-muted">Find something you'll love. Every price shown is the price you pay.</p>
        <Link to="/" className="mt-5 inline-block rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-on-accent hover:bg-brand-700">Continue shopping</Link>
      </div>
    );
  }

  return <CartList cart={cart} />;
}

/** /checkout: buyers only (guarded in main.tsx). Pays for the lines ticked in the server cart. */
export function CheckoutPage() {
  const cart = useCart();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);

  if (order) return <Confirmation order={order} />;
  if (cart.isPending) return <div className="h-96 animate-pulse rounded-card bg-line" />;
  const selected = (cart.view?.items ?? []).filter((l) => l.selected && isSelectable(l.status));
  if (selected.length === 0) return <Navigate to="/cart" replace />;
  return <CheckoutForm cart={cart} lines={selected} onBack={() => navigate("/cart")} onPlaced={setOrder} />;
}
