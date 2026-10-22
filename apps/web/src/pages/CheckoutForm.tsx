import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Lock, MapPin } from "lucide-react";
import {
  CvvSchema,
  formatAddress,
  taxFor,
  type AddressView,
  type CartLineView,
  type CheckoutRequest,
  type Order,
  type PaymentMethodView,
} from "@clearcart/shared";
import { ApiError, api, money } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { useCart } from "../lib/cart";
import {
  AddressFields,
  EMPTY_ADDRESS,
  EMPTY_PAYMENT,
  PaymentFields,
  PaymentIcon,
  issuesToErrors,
  paymentLine,
  validateAddress,
  validatePayment,
  type AddressDraft,
  type Errors,
  type PaymentDraft,
} from "./AccountPage";

/** Same formula as the server's quote: shipping per line, tax on the item subtotal. */
export function totals(lines: CartLineView[]) {
  const subtotalCents = lines.reduce((s, l) => s + (l.unitCents ?? 0) * l.qty, 0);
  const shippingCents = lines.reduce((s, l) => s + l.shippingCents, 0);
  const taxCents = taxFor(subtotalCents);
  return { subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents };
}

const NEW = "new";
const linkButton = "text-sm font-medium text-brand-700 hover:underline";

function Section({ step, title, action, children }: { step: number; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold"><span className="mr-2 inline-grid size-6 place-items-center rounded-full bg-brand-600 text-xs text-on-accent">{step}</span>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Radio list of saved entries plus "Add new"; picking one closes it. */
function Picker<T extends { id: string; isDefault: boolean }>({ items, selected, render, onPick, disabled }: {
  items: T[];
  selected: string;
  render: (item: T) => ReactNode;
  onPick: (id: string) => void;
  disabled?: (item: T) => string | null;
}) {
  return (
    <ul className="space-y-2" role="radiogroup">
      {[...items.map((i) => ({ id: i.id, node: render(i), why: disabled?.(i) ?? null })), { id: NEW, node: <span className="font-medium">+ Add new</span>, why: null }].map((o) => (
        <li key={o.id}>
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${selected === o.id ? "border-brand-600 bg-brand-50" : "border-line"} ${o.why ? "cursor-not-allowed opacity-50" : ""}`}>
            <input type="radio" name="picker" className="mt-1 accent-brand-600" checked={selected === o.id} disabled={Boolean(o.why)} onChange={() => onPick(o.id)} />
            <span className="min-w-0 flex-1 text-sm">{o.node}{o.why && <span className="block text-xs text-bad">{o.why}</span>}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const SaveBox = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="mt-3 flex items-center gap-2 text-sm">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-brand-600" /> Save for next time
  </label>
);

const addressSummary = (a: AddressView) => (
  <>
    <span className="font-medium">{a.label}</span>{a.isDefault && <span className="text-xs text-muted"> · default</span>}
    <span className="block">{a.recipientName} · {a.phone}</span>
    <span className="block text-muted">{formatAddress(a)}</span>
  </>
);

export function CheckoutForm({ cart, lines, onBack, onPlaced }: {
  cart: ReturnType<typeof useCart>;
  lines: CartLineView[];
  onBack: () => void;
  onPlaced: (o: Order) => void;
}) {
  // Only reachable behind <RequireAuth role="BUYER">, so there's always a user.
  const user = useAuth().user!;
  const queryClient = useQueryClient();
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: api.addresses });
  const methods = useQuery({ queryKey: ["payment-methods"], queryFn: api.paymentMethods });

  // null = "use the default"; NEW = typing a new one.
  const [addressPick, setAddressPick] = useState<string | null>(null);
  const [paymentPick, setPaymentPick] = useState<string | null>(null);
  const [pickingAddress, setPickingAddress] = useState(false);
  const [pickingPayment, setPickingPayment] = useState(false);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>({ ...EMPTY_ADDRESS, recipientName: user.name });
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({ ...EMPTY_PAYMENT, holderName: user.name });
  const [saveAddress, setSaveAddress] = useState(true);
  const [savePayment, setSavePayment] = useState(true);
  const [cvv, setCvv] = useState("");
  const [errors, setErrors] = useState<{ address: Errors; payment: Errors; cvv?: string }>({ address: {}, payment: {} });

  const savedAddresses = addresses.data ?? [];
  const usableMethods = (methods.data ?? []).filter((m) => !m.expired);
  const address = addressPick === NEW ? null : savedAddresses.find((a) => a.id === (addressPick ?? savedAddresses.find((x) => x.isDefault)?.id)) ?? null;
  const method: PaymentMethodView | null =
    paymentPick === NEW ? null : usableMethods.find((m) => m.id === (paymentPick ?? usableMethods.find((x) => x.isDefault)?.id ?? usableMethods[0]?.id)) ?? null;

  const t = totals(lines);
  const cartItemIds = lines.map((l) => l.id);

  const checkout = useMutation({
    mutationFn: api.checkout,
    onSuccess: (order) => {
      // The server removed only the purchased lines from the cart.
      for (const key of ["cart", "products", "product", "addresses", "payment-methods"]) queryClient.invalidateQueries({ queryKey: [key] });
      onPlaced(order);
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      // Stock or availability changed: refresh the cart so the reasons show on each line.
      if (err.status === 409) cart.refetch();
      const d = err.details ?? [];
      setErrors((e) => ({
        ...e,
        address: issuesToErrors(d, "shipping.address"),
        payment: issuesToErrors(d, "payment.method"),
      }));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = { address: {}, payment: {} };
    let shipping: CheckoutRequest["shipping"] | undefined;
    let payment: CheckoutRequest["payment"] | undefined;

    if (address) shipping = { addressId: address.id };
    else {
      const r = validateAddress(addressDraft);
      next.address = r.errors;
      if (r.data) shipping = { address: r.data, save: saveAddress };
    }
    if (method) {
      // Mock card check: the CVV is validated here and never sent.
      if (method.type === "CARD") {
        const c = CvvSchema.safeParse(cvv);
        if (!c.success) next.cvv = c.error.issues[0]!.message;
      }
      payment = { paymentMethodId: method.id };
    } else {
      const r = validatePayment(paymentDraft);
      next.payment = r.errors;
      if (r.data) payment = { method: r.data, save: savePayment };
    }
    setErrors(next);
    if (!shipping || !payment || next.cvv) return;
    checkout.mutate({ cartItemIds, shipping, payment });
  };

  if (addresses.isPending || methods.isPending) return <div className="h-96 animate-pulse rounded-card bg-line" />;
  const generalError = checkout.isError && (!(checkout.error instanceof ApiError) || checkout.error.status !== 400 || !checkout.error.details?.length);

  return (
    <form onSubmit={submit} noValidate className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" /> Back to cart</button>
        <h1 className="text-2xl font-bold">Checkout</h1>

        <Section step={1} title="Contact">
          <p className="text-sm"><span className="font-medium">{user.name}</span> · confirmation goes to <span className="font-medium">{user.email}</span></p>
        </Section>

        <Section
          step={2}
          title="Shipping address"
          action={savedAddresses.length > 0 && !pickingAddress && <button type="button" onClick={() => setPickingAddress(true)} className={linkButton}>Change</button>}
        >
          {pickingAddress ? (
            <Picker items={savedAddresses} selected={address?.id ?? NEW} render={addressSummary}
              onPick={(id) => { setAddressPick(id); setPickingAddress(false); }} />
          ) : address ? (
            <p className="flex gap-2 text-sm"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" /><span>{addressSummary(address)}</span></p>
          ) : (
            <>
              <AddressFields value={addressDraft} onChange={setAddressDraft} errors={errors.address} />
              <SaveBox checked={saveAddress} onChange={setSaveAddress} />
            </>
          )}
        </Section>

        <Section
          step={3}
          title="Payment"
          action={(methods.data?.length ?? 0) > 0 && !pickingPayment && <button type="button" onClick={() => setPickingPayment(true)} className={linkButton}>Change</button>}
        >
          {pickingPayment ? (
            <Picker items={methods.data ?? []} selected={method?.id ?? NEW}
              render={(m) => <span className="flex items-center gap-2"><PaymentIcon type={m.type} brand={m.brand} />{paymentLine(m)}{m.isDefault && <span className="text-xs text-muted">· default</span>}</span>}
              disabled={(m) => (m.expired ? "Expired" : null)}
              onPick={(id) => { setPaymentPick(id); setCvv(""); setPickingPayment(false); }} />
          ) : method ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm"><PaymentIcon type={method.type} brand={method.brand} /> {paymentLine(method)}</p>
              {method.type === "CARD" && (
                <label className="block max-w-[10rem] text-sm">CVV
                  <input type="password" inputMode="numeric" autoComplete="cc-csc" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    className={`mt-1 w-full rounded-lg border bg-surface px-3 py-2 ${errors.cvv ? "border-bad" : "border-line-strong"}`} />
                  {errors.cvv && <span className="text-xs text-bad">{errors.cvv}</span>}
                </label>
              )}
            </div>
          ) : (
            <>
              <PaymentFields value={paymentDraft} onChange={setPaymentDraft} errors={errors.payment} />
              <SaveBox checked={savePayment} onChange={setSavePayment} />
            </>
          )}
          <p className="mt-3 flex items-center gap-1 text-xs text-muted"><Lock className="size-3" /> Demo payment. No real charge is made.</p>
        </Section>
      </div>

      <aside className="h-fit space-y-4 rounded-card border border-line bg-surface p-4 lg:sticky lg:top-20">
        <h2 className="font-semibold">Order summary ({lines.length})</h2>
        <ul className="space-y-2 text-sm">
          {lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="min-w-0">{l.name}{l.size && <span className="text-muted"> · {l.size}</span>} × {l.qty}</span>
              <span className="tabular-nums">{money((l.unitCents ?? 0) * l.qty)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-line-soft pt-3 text-sm tabular-nums">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(t.subtotalCents)}</dd></div>
          <div className="flex justify-between"><dt>Shipping</dt><dd>{t.shippingCents ? money(t.shippingCents) : "Free"}</dd></div>
          <div className="flex justify-between"><dt>Tax</dt><dd>{money(t.taxCents)}</dd></div>
          <div className="flex justify-between pt-2 text-lg font-bold"><dt>Total</dt><dd>{money(t.totalCents)}</dd></div>
        </dl>
        <p className="text-xs text-muted">Prices are re-checked when you pay.</p>
        {generalError && (
          <p className="text-sm text-bad" role="alert">
            {checkout.error!.message}
            {checkout.error instanceof ApiError && checkout.error.status === 409 && <> <button type="button" onClick={onBack} className="underline">Review your cart</button></>}
          </p>
        )}
        <button disabled={checkout.isPending || lines.length === 0} className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-60">
          {checkout.isPending ? "Placing order…" : `Pay ${money(t.totalCents)}`}
        </button>
      </aside>
    </form>
  );
}
