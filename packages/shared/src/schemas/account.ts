import { z } from "zod";
import { PasswordSchema } from "./auth";

export const MAX_ADDRESSES = 5;
export const MAX_PAYMENT_METHODS = 5;

// ---- Addresses (Malaysia) ----

export const MY_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
] as const;

export const ADDRESS_LABELS = ["Home", "Work", "Other"] as const;

/** Malaysian mobile: +60 / 60 / 0 prefix, then 1x and 9–11 digits in all after the prefix. Spaces and dashes are ignored. */
export const MyPhoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^(\+?60|0)1\d{8,10}$/, "Use a Malaysian mobile number, e.g. 012-345 6789 or +60 12-345 6789"));

export const AddressInputSchema = z.object({
  label: z.enum(ADDRESS_LABELS, { error: "Choose a label" }),
  recipientName: z.string().trim().min(2, "Enter the recipient's name").max(60, "Use at most 60 characters"),
  phone: MyPhoneSchema,
  line1: z.string().trim().min(3, "Enter the street address").max(100, "Use at most 100 characters"),
  line2: z.string().trim().max(100, "Use at most 100 characters").optional().transform((s) => s || undefined),
  postcode: z.string().trim().regex(/^\d{5}$/, "Postcodes have 5 digits"),
  city: z.string().trim().min(2, "Enter a city").max(60, "Use at most 60 characters"),
  state: z.enum(MY_STATES, { error: "Choose a state" }),
});
export type AddressInput = z.input<typeof AddressInputSchema>;
export type Address = z.output<typeof AddressInputSchema>;

export interface AddressView extends Address {
  id: string;
  isDefault: boolean;
}

export const formatAddress = (a: Address) =>
  [a.line1, a.line2, `${a.postcode} ${a.city}`, a.state, "Malaysia"].filter(Boolean).join(", ");

// ---- Payment methods ----

export const PAYMENT_TYPES = ["CARD", "FPX", "EWALLET"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const FPX_BANKS = [
  "Maybank2u",
  "CIMB Clicks",
  "Public Bank",
  "RHB Now",
  "Hong Leong Connect",
  "AmOnline",
  "Bank Islam",
  "Bank Rakyat",
  "BSN",
  "Affin Bank",
  "Alliance Bank",
  "OCBC",
  "HSBC",
  "UOB",
  "Standard Chartered",
] as const;
export const EWALLETS = ["Touch 'n Go", "GrabPay", "Boost"] as const;

export type CardBrand = "Visa" | "Mastercard" | "Amex" | "UnionPay" | "JCB" | "Card";

const digitsOnly = (s: string) => s.replace(/\D/g, "");

export function detectCardBrand(number: string): CardBrand {
  const n = digitsOnly(number);
  if (/^4/.test(n)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(n)) return "Mastercard";
  if (/^3[47]/.test(n)) return "Amex";
  if (/^62/.test(n)) return "UnionPay";
  if (/^35/.test(n)) return "JCB";
  return "Card";
}

export function luhnValid(number: string): boolean {
  const n = digitsOnly(number);
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Groups as you type: Amex 4-6-5, everything else in fours. */
export function formatCardNumber(input: string): string {
  const n = digitsOnly(input).slice(0, 19);
  if (detectCardBrand(n) === "Amex") return [n.slice(0, 4), n.slice(4, 10), n.slice(10, 15)].filter(Boolean).join(" ");
  return n.replace(/(\d{4})(?=\d)/g, "$1 ");
}

const expiryNotPast = (c: { expMonth: number; expYear: number }) => {
  const now = new Date();
  return c.expYear > now.getFullYear() || (c.expYear === now.getFullYear() && c.expMonth >= now.getMonth() + 1);
};

export const CardExpirySchema = z
  .object({
    expMonth: z.number({ error: "Enter the expiry month" }).int().min(1, "Month must be 1–12").max(12, "Month must be 1–12"),
    expYear: z.number({ error: "Enter the expiry year" }).int().min(2000).max(2100),
  })
  .refine(expiryNotPast, { message: "This card has expired", path: ["expMonth"] });

/**
 * What the server receives for a new card. The full number exists only in memory on the server
 * (brand, Luhn, last 4) and is never stored or logged. The CVV is not part of this schema at all.
 */
export const CardInputSchema = z
  .object({
    type: z.literal("CARD"),
    number: z
      .string()
      .transform(digitsOnly)
      .pipe(z.string().min(12, "Enter the full card number").max(19, "Card numbers have at most 19 digits"))
      .refine(luhnValid, "This card number isn't valid"),
    expMonth: z.number({ error: "Enter the expiry month" }).int().min(1, "Month must be 1–12").max(12, "Month must be 1–12"),
    expYear: z.number({ error: "Enter the expiry year" }).int().min(2000).max(2100),
    holderName: z.string().trim().min(2, "Enter the name on the card").max(60, "Use at most 60 characters"),
  })
  .refine(expiryNotPast, { message: "This card has expired", path: ["expMonth"] });

/** Client-only: the CVV is checked in the browser and stripped before anything is sent. */
export const CvvSchema = z.string().regex(/^\d{3,4}$/, "Enter the 3 or 4 digit security code");

export const FpxInputSchema = z.object({ type: z.literal("FPX"), bankName: z.enum(FPX_BANKS, { error: "Choose your bank" }) });
export const EwalletInputSchema = z.object({
  type: z.literal("EWALLET"),
  provider: z.enum(EWALLETS, { error: "Choose an e-wallet" }),
  phone: MyPhoneSchema,
});

export const NewPaymentMethodSchema = z.discriminatedUnion("type", [CardInputSchema, FpxInputSchema, EwalletInputSchema]);
export type NewPaymentMethod = z.input<typeof NewPaymentMethodSchema>;

export interface PaymentMethodView {
  id: string;
  type: PaymentType;
  isDefault: boolean;
  /** e.g. "Visa •••• 4242", "FPX · Maybank2u", "Touch 'n Go •••• 5678". */
  summary: string;
  brand: CardBrand | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  holderName: string | null;
  bankName: string | null;
  provider: string | null;
  maskedPhone: string | null;
  expired: boolean;
}

export const maskPhone = (phone: string) => `•••• ${digitsOnly(phone).slice(-4)}`;

export function paymentSummary(pm: { type: string; brand?: string | null; last4?: string | null; bankName?: string | null; provider?: string | null; maskedPhone?: string | null }): string {
  if (pm.type === "CARD") return `${pm.brand ?? "Card"} •••• ${pm.last4 ?? "????"}`;
  if (pm.type === "FPX") return `FPX · ${pm.bankName ?? "Online banking"}`;
  return `${pm.provider ?? "E-wallet"} ${pm.maskedPhone ?? ""}`.trim();
}

// ---- Profile & security ----

export const ProfileUpdateSchema = z.object({
  name: z.string().trim().min(2, "Use at least 2 characters").max(40, "Use at most 40 characters"),
});

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(200),
    newPassword: PasswordSchema,
  })
  .refine((p) => p.currentPassword !== p.newPassword, { message: "Choose a password different from your current one", path: ["newPassword"] });

/** Rough strength hint for the UI only; the rule that's enforced is PasswordSchema. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ["Too short", "Weak", "Fair", "Good", "Strong"][s]! };
}
