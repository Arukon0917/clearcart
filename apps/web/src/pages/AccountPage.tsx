import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Landmark, MapPin, Plus, Wallet, X } from "lucide-react";
import {
  ADDRESS_LABELS,
  AddressInputSchema,
  ChangePasswordSchema,
  CvvSchema,
  EWALLETS,
  FPX_BANKS,
  MAX_ADDRESSES,
  MAX_PAYMENT_METHODS,
  MY_STATES,
  NewPaymentMethodSchema,
  PASSWORD_RULE,
  ProfileUpdateSchema,
  detectCardBrand,
  formatAddress,
  formatCardNumber,
  passwordStrength,
  type AddressInput,
  type AddressView,
  type NewPaymentMethod,
  type PaymentMethodView,
  type PaymentType,
} from "@clearcart/shared";
import { RequireAuth } from "../RequireAuth";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/stores";
import { ConfirmDialog } from "../components";

// ---------------------------------------------------------------------------
// Shared form pieces (also used by checkout)
// ---------------------------------------------------------------------------

export type Errors = Record<string, string>;

/** Zod/API issues → { field: message }, optionally only those under `prefix` (e.g. "shipping.address"). */
export function issuesToErrors(issues: { path: PropertyKey[] | string; message: string }[], prefix = ""): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const path = Array.isArray(i.path) ? i.path.map(String).join(".") : String(i.path);
    if (prefix && !path.startsWith(`${prefix}.`)) continue;
    const key = (prefix ? path.slice(prefix.length + 1) : path).split(".")[0] || "form";
    out[key] ??= i.message;
  }
  return out;
}

const inputClass = (error?: string) => `mt-1 w-full rounded-lg border bg-surface px-3 py-2 text-sm ${error ? "border-bad" : "border-line-strong"}`;
const ErrorText = ({ error }: { error?: string }) => (error ? <span className="text-xs text-bad">{error}</span> : null);
const primaryButton = "rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-60";
const quietButton = "rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-raised hover:text-ink disabled:opacity-50";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-card bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-raised"><X className="size-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- Address ----

export type AddressDraft = Required<{ [K in keyof AddressInput]: string }>;
export const EMPTY_ADDRESS: AddressDraft = { label: "Home", recipientName: "", phone: "", line1: "", line2: "", postcode: "", city: "", state: "" };
export const addressToDraft = (a: AddressView): AddressDraft => ({ ...a, line2: a.line2 ?? "" });

export function validateAddress(draft: AddressDraft): { data?: AddressInput; errors: Errors } {
  const r = AddressInputSchema.safeParse(draft);
  return r.success ? { data: draft as AddressInput, errors: {} } : { errors: issuesToErrors(r.error.issues) };
}

export function AddressFields({ value, onChange, errors }: { value: AddressDraft; onChange: (v: AddressDraft) => void; errors: Errors }) {
  const set = (k: keyof AddressDraft) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <fieldset className="sm:col-span-2">
        <legend className="text-sm">Label</legend>
        <div className="mt-1 flex gap-2">
          {ADDRESS_LABELS.map((l) => (
            <button key={l} type="button" aria-pressed={value.label === l} onClick={() => onChange({ ...value, label: l })}
              className={`rounded-full border px-3 py-1 text-sm ${value.label === l ? "border-brand-600 bg-brand-600 text-on-accent" : "border-line-strong bg-surface"}`}>
              {l}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="text-sm">Recipient name<input value={value.recipientName} onChange={set("recipientName")} autoComplete="name" className={inputClass(errors.recipientName)} /><ErrorText error={errors.recipientName} /></label>
      <label className="text-sm">Phone<input value={value.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="012-345 6789" className={inputClass(errors.phone)} /><ErrorText error={errors.phone} /></label>
      <label className="text-sm sm:col-span-2">Address line 1<input value={value.line1} onChange={set("line1")} autoComplete="address-line1" className={inputClass(errors.line1)} /><ErrorText error={errors.line1} /></label>
      <label className="text-sm sm:col-span-2">Address line 2 <span className="text-muted">(optional)</span><input value={value.line2} onChange={set("line2")} autoComplete="address-line2" className={inputClass(errors.line2)} /><ErrorText error={errors.line2} /></label>
      <label className="text-sm">Postcode<input value={value.postcode} onChange={set("postcode")} inputMode="numeric" maxLength={5} autoComplete="postal-code" className={inputClass(errors.postcode)} /><ErrorText error={errors.postcode} /></label>
      <label className="text-sm">City<input value={value.city} onChange={set("city")} autoComplete="address-level2" className={inputClass(errors.city)} /><ErrorText error={errors.city} /></label>
      <label className="text-sm sm:col-span-2">State
        <select value={value.state} onChange={set("state")} className={inputClass(errors.state)}>
          <option value="">Choose…</option>
          {MY_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <ErrorText error={errors.state} />
      </label>
    </div>
  );
}

// ---- Payment ----

export interface PaymentDraft {
  type: PaymentType;
  number: string;
  expiry: string;
  holderName: string;
  cvv: string;
  bankName: string;
  provider: string;
  phone: string;
}
export const EMPTY_PAYMENT: PaymentDraft = { type: "CARD", number: "", expiry: "", holderName: "", cvv: "", bankName: "", provider: "", phone: "" };

/** Validates in the browser (CVV included) and returns what may be sent: never the CVV. */
export function validatePayment(draft: PaymentDraft): { data?: NewPaymentMethod; errors: Errors } {
  let candidate: NewPaymentMethod;
  const errors: Errors = {};
  if (draft.type === "CARD") {
    const [mm, yy] = draft.expiry.split("/").map((s) => s.trim());
    candidate = { type: "CARD", number: draft.number, expMonth: Number(mm), expYear: 2000 + Number(yy), holderName: draft.holderName };
    if (!/^\d{2}\s*\/\s*\d{2}$/.test(draft.expiry)) errors.expMonth = "Use MM/YY";
    const cvv = CvvSchema.safeParse(draft.cvv);
    if (!cvv.success) errors.cvv = cvv.error.issues[0]!.message;
  } else if (draft.type === "FPX") {
    // Unvalidated strings; the schema below rejects anything that isn't in the list.
    candidate = { type: "FPX", bankName: draft.bankName as never };
  } else {
    candidate = { type: "EWALLET", provider: draft.provider as never, phone: draft.phone };
  }
  const r = NewPaymentMethodSchema.safeParse(candidate);
  if (!r.success) Object.assign(errors, { ...issuesToErrors(r.error.issues), ...errors });
  return Object.keys(errors).length ? { errors } : { data: candidate, errors };
}

const BRAND_STYLE: Record<string, string> = {
  Visa: "bg-blue-700 text-white",
  Mastercard: "bg-orange-500 text-white",
  Amex: "bg-sky-500 text-white",
  UnionPay: "bg-red-600 text-white",
  JCB: "bg-green-600 text-white",
};

export function PaymentIcon({ type, brand }: { type: PaymentType; brand?: string | null }) {
  if (type === "CARD" && brand && BRAND_STYLE[brand]) {
    return <span className={`grid h-7 w-11 shrink-0 place-items-center rounded text-[10px] font-bold uppercase ${BRAND_STYLE[brand]}`} aria-hidden>{brand === "Mastercard" ? "MC" : brand}</span>;
  }
  const Icon = type === "CARD" ? CreditCard : type === "FPX" ? Landmark : Wallet;
  return <span className="grid h-7 w-11 shrink-0 place-items-center rounded bg-raised text-muted" aria-hidden><Icon className="size-4" /></span>;
}

const TYPE_LABEL: Record<PaymentType, string> = { CARD: "Card", FPX: "FPX", EWALLET: "E-wallet" };

export function PaymentFields({ value, onChange, errors }: { value: PaymentDraft; onChange: (v: PaymentDraft) => void; errors: Errors }) {
  const set = (k: keyof PaymentDraft) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const brand = detectCardBrand(value.number);
  const formatExpiry = (raw: string) => {
    const d = raw.replace(/\D/g, "").slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };
  return (
    <div className="space-y-3">
      <div role="tablist" className="flex gap-1 rounded-xl bg-raised p-1">
        {(Object.keys(TYPE_LABEL) as PaymentType[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={value.type === t} onClick={() => onChange({ ...value, type: t })}
            className={`flex-1 rounded-lg py-1.5 text-sm font-semibold ${value.type === t ? "bg-surface shadow-sm" : "text-muted"}`}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {value.type === "CARD" && (
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm sm:col-span-4">Card number
            <span className="relative block">
              <input value={value.number} onChange={(e) => onChange({ ...value, number: formatCardNumber(e.target.value) })} inputMode="numeric" autoComplete="cc-number"
                placeholder="4242 4242 4242 4242" className={`${inputClass(errors.number)} pr-16 font-mono`} />
              {value.number && <span className="absolute right-2 top-1/2 -translate-y-1/2 pt-1"><PaymentIcon type="CARD" brand={brand} /></span>}
            </span>
            <ErrorText error={errors.number} />
          </label>
          <label className="text-sm sm:col-span-2">Name on card<input value={value.holderName} onChange={set("holderName")} autoComplete="cc-name" className={inputClass(errors.holderName)} /><ErrorText error={errors.holderName} /></label>
          <label className="text-sm">Expiry<input value={value.expiry} onChange={(e) => onChange({ ...value, expiry: formatExpiry(e.target.value) })} inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" className={inputClass(errors.expMonth)} /><ErrorText error={errors.expMonth} /></label>
          <label className="text-sm">CVV<input value={value.cvv} onChange={(e) => onChange({ ...value, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" autoComplete="cc-csc" type="password" className={inputClass(errors.cvv)} /><ErrorText error={errors.cvv} /></label>
          <p className="text-xs text-muted sm:col-span-4">We keep only the brand, last 4 digits and expiry. The CVV never leaves your browser.</p>
        </div>
      )}
      {value.type === "FPX" && (
        <label className="block text-sm">Bank
          <select value={value.bankName} onChange={set("bankName")} className={inputClass(errors.bankName)}>
            <option value="">Choose your bank…</option>
            {FPX_BANKS.map((b) => <option key={b}>{b}</option>)}
          </select>
          <ErrorText error={errors.bankName} />
        </label>
      )}
      {value.type === "EWALLET" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">E-wallet
            <select value={value.provider} onChange={set("provider")} className={inputClass(errors.provider)}>
              <option value="">Choose…</option>
              {EWALLETS.map((w) => <option key={w}>{w}</option>)}
            </select>
            <ErrorText error={errors.provider} />
          </label>
          <label className="text-sm">Phone linked to the wallet<input value={value.phone} onChange={set("phone")} type="tel" inputMode="tel" placeholder="012-345 6789" className={inputClass(errors.phone)} /><ErrorText error={errors.phone} /></label>
        </div>
      )}
    </div>
  );
}

export const paymentLine = (pm: PaymentMethodView) =>
  pm.type === "CARD" && pm.expMonth && pm.expYear ? `${pm.summary} · exp ${String(pm.expMonth).padStart(2, "0")}/${String(pm.expYear).slice(-2)}` : pm.summary;

const DefaultBadge = () => <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Default</span>;

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function ProfileTab() {
  const { user, updateUser } = useAuth();
  const toast = useToast((s) => s.show);
  const [name, setName] = useState(user?.name ?? "");
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: api.updateProfile,
    onSuccess: (u) => {
      updateUser(u);
      toast("Profile saved");
    },
    onError: (err) => setError(err.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = ProfileUpdateSchema.safeParse({ name });
    if (!r.success) return setError(r.error.issues[0]!.message);
    setError(undefined);
    save.mutate(r.data.name);
  };
  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-4">
      <label className="block text-sm">Display name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputClass(error)} /><ErrorText error={error} /></label>
      <label className="block text-sm">Email<input value={user?.email ?? ""} readOnly disabled className={`${inputClass()} bg-subtle text-muted`} />
        <span className="text-xs text-muted">Your email can't be changed here.</span>
      </label>
      <button disabled={save.isPending || name.trim() === user?.name} className={primaryButton}>{save.isPending ? "Saving…" : "Save"}</button>
    </form>
  );
}

function AddressModal({ initial, onClose }: { initial?: AddressView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const [draft, setDraft] = useState<AddressDraft>(initial ? addressToDraft(initial) : EMPTY_ADDRESS);
  const [errors, setErrors] = useState<Errors>({});
  const save = useMutation({
    mutationFn: (input: AddressInput) => (initial ? api.updateAddress(initial.id, input) : api.addAddress(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addresses"] });
      toast(initial ? "Address updated" : "Address added");
      onClose();
    },
    onError: (err) => setErrors(err instanceof ApiError && err.details?.length ? issuesToErrors(err.details) : { form: err.message }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validateAddress(draft);
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <Modal title={initial ? "Edit address" : "Add address"} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <AddressFields value={draft} onChange={setDraft} errors={errors} />
        {errors.form && <p className="text-sm text-bad" role="alert">{errors.form}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={quietButton}>Cancel</button>
          <button disabled={save.isPending} className={primaryButton}>{save.isPending ? "Saving…" : "Save address"}</button>
        </div>
      </form>
    </Modal>
  );
}

function AddressesTab() {
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const addresses = useQuery({ queryKey: ["addresses"], queryFn: api.addresses });
  const [editing, setEditing] = useState<AddressView | "new" | null>(null);
  const [deleting, setDeleting] = useState<AddressView | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["addresses"] });
  const makeDefault = useMutation({ mutationFn: api.setDefaultAddress, onSuccess: refresh, onError: (e) => toast(e.message) });
  const remove = useMutation({
    mutationFn: api.deleteAddress,
    onSuccess: () => { setDeleting(null); refresh(); toast("Address deleted"); },
    onError: (e) => toast(e.message),
  });
  const count = addresses.data?.length ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">{count}/{MAX_ADDRESSES} saved</p>
        <button type="button" disabled={count >= MAX_ADDRESSES} onClick={() => setEditing("new")} className={`${primaryButton} inline-flex items-center gap-1 px-4 py-2 text-sm`}>
          <Plus className="size-4" /> Add address
        </button>
      </div>
      {addresses.isPending && <div className="h-32 animate-pulse rounded-card bg-line" />}
      {addresses.isError && <p className="text-bad">{addresses.error.message}</p>}
      {addresses.data?.length === 0 && <p className="py-10 text-center text-muted">No saved addresses yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {addresses.data?.map((a) => (
          <article key={a.id} className={`rounded-card border bg-surface p-4 ${a.isDefault ? "border-brand-600" : "border-line"}`}>
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-muted" aria-hidden />
              <h3 className="font-semibold">{a.label}</h3>
              {a.isDefault && <DefaultBadge />}
            </div>
            <p className="mt-2 text-sm">{a.recipientName} · {a.phone}</p>
            <p className="text-sm text-muted">{formatAddress(a)}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              <button type="button" onClick={() => setEditing(a)} className={quietButton}>Edit</button>
              <button type="button" onClick={() => setDeleting(a)} className={`${quietButton} hover:text-bad`}>Delete</button>
              {!a.isDefault && <button type="button" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(a.id)} className={quietButton}>Set default</button>}
            </div>
          </article>
        ))}
      </div>
      {editing && <AddressModal initial={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog title="Delete this address?" message={`${deleting.label}: ${formatAddress(deleting)}`} confirmLabel="Delete"
          pending={remove.isPending} onConfirm={() => remove.mutate(deleting.id)} onCancel={() => setDeleting(null)} />
      )}
    </div>
  );
}

function PaymentModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const [draft, setDraft] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [errors, setErrors] = useState<Errors>({});
  const save = useMutation({
    mutationFn: api.addPaymentMethod,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
      toast("Payment method added");
      onClose();
    },
    onError: (err) => setErrors(err instanceof ApiError && err.details?.length ? issuesToErrors(err.details) : { form: err.message }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = validatePayment(draft);
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <Modal title="Add payment method" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <PaymentFields value={draft} onChange={setDraft} errors={errors} />
        {errors.form && <p className="text-sm text-bad" role="alert">{errors.form}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={quietButton}>Cancel</button>
          <button disabled={save.isPending} className={primaryButton}>{save.isPending ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentsTab() {
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const methods = useQuery({ queryKey: ["payment-methods"], queryFn: api.paymentMethods });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<PaymentMethodView | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["payment-methods"] });
  const makeDefault = useMutation({ mutationFn: api.setDefaultPaymentMethod, onSuccess: refresh, onError: (e) => toast(e.message) });
  const remove = useMutation({
    mutationFn: api.deletePaymentMethod,
    onSuccess: () => { setDeleting(null); refresh(); toast("Payment method deleted"); },
    onError: (e) => toast(e.message),
  });
  const count = methods.data?.length ?? 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">{count}/{MAX_PAYMENT_METHODS} saved · to change a card, delete it and add it again</p>
        <button type="button" disabled={count >= MAX_PAYMENT_METHODS} onClick={() => setAdding(true)} className={`${primaryButton} inline-flex items-center gap-1 px-4 py-2 text-sm`}>
          <Plus className="size-4" /> Add method
        </button>
      </div>
      {methods.isPending && <div className="h-32 animate-pulse rounded-card bg-line" />}
      {methods.isError && <p className="text-bad">{methods.error.message}</p>}
      {methods.data?.length === 0 && <p className="py-10 text-center text-muted">No saved payment methods yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {methods.data?.map((pm) => (
          <article key={pm.id} className={`rounded-card border bg-surface p-4 ${pm.isDefault ? "border-brand-600" : "border-line"}`}>
            <div className="flex items-center gap-3">
              <PaymentIcon type={pm.type} brand={pm.brand} />
              <p className="min-w-0 flex-1 font-medium">{paymentLine(pm)}</p>
              {pm.isDefault && <DefaultBadge />}
            </div>
            {pm.holderName && <p className="mt-1 text-sm text-muted">{pm.holderName}</p>}
            {pm.expired && <p className="mt-1 text-xs font-medium text-bad">Expired</p>}
            <div className="mt-3 flex flex-wrap gap-1">
              <button type="button" onClick={() => setDeleting(pm)} className={`${quietButton} hover:text-bad`}>Delete</button>
              {!pm.isDefault && <button type="button" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(pm.id)} className={quietButton}>Set default</button>}
            </div>
          </article>
        ))}
      </div>
      {adding && <PaymentModal onClose={() => setAdding(false)} />}
      {deleting && (
        <ConfirmDialog title="Delete this payment method?" message={paymentLine(deleting)} confirmLabel="Delete"
          pending={remove.isPending} onConfirm={() => remove.mutate(deleting.id)} onCancel={() => setDeleting(null)} />
      )}
    </div>
  );
}

function SecurityTab() {
  const toast = useToast((s) => s.show);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const strength = passwordStrength(form.newPassword);
  const change = useMutation({
    mutationFn: () => api.changePassword(form.currentPassword, form.newPassword),
    onSuccess: () => {
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      toast("Password changed. Other devices have been signed out");
    },
    onError: (err) => setErrors(err instanceof ApiError && err.details?.length ? issuesToErrors(err.details) : { form: err.message }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = ChangePasswordSchema.safeParse(form);
    const next = r.success ? {} : issuesToErrors(r.error.issues);
    if (form.confirm !== form.newPassword) next.confirm = "Passwords don't match";
    setErrors(next);
    if (Object.keys(next).length === 0) change.mutate();
  };
  const field = (key: keyof typeof form, label: string, autoComplete: string) => (
    <label className="block text-sm">{label}
      <input type="password" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} autoComplete={autoComplete} className={inputClass(errors[key])} />
      <ErrorText error={errors[key]} />
    </label>
  );
  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-4">
      {field("currentPassword", "Current password", "current-password")}
      {field("newPassword", "New password", "new-password")}
      {form.newPassword && (
        <div aria-live="polite">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= strength.score ? (strength.score >= 3 ? "bg-brand-600" : "bg-caution") : "bg-line"}`} />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Strength: {strength.label}</p>
        </div>
      )}
      <p className="-mt-2 text-xs text-muted">{PASSWORD_RULE}</p>
      {field("confirm", "Confirm new password", "new-password")}
      {errors.form && <p className="text-sm text-bad" role="alert">{errors.form}</p>}
      <button disabled={change.isPending} className={primaryButton}>{change.isPending ? "Changing…" : "Change password"}</button>
    </form>
  );
}

const TABS = { profile: "Profile", addresses: "Addresses", payments: "Payment methods", security: "Security" } as const;
type Tab = keyof typeof TABS;

function Account() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (params.get("tab") as Tab) in TABS ? (params.get("tab") as Tab) : "profile";
  return (
    <div>
      <h1 className="text-2xl font-bold">Account</h1>
      <div role="tablist" className="mb-6 mt-4 flex gap-5 overflow-x-auto border-b border-line">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setParams(t === "profile" ? {} : { tab: t })}
            className={`whitespace-nowrap border-b-2 px-1 pb-2 font-medium ${tab === t ? "border-brand-600 text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {TABS[t]}
          </button>
        ))}
      </div>
      {tab === "profile" && <ProfileTab />}
      {tab === "addresses" && <AddressesTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "security" && <SecurityTab />}
    </div>
  );
}

export function AccountPage() {
  return (
    <RequireAuth>
      <Account />
    </RequireAuth>
  );
}
