import { randomBytes } from "node:crypto";
import type { Address as AddressRow, PaymentMethod as PaymentRow } from "@prisma/client";
import {
  AddressInputSchema,
  MAX_ADDRESSES,
  MAX_PAYMENT_METHODS,
  NewPaymentMethodSchema,
  detectCardBrand,
  maskPhone,
  paymentSummary,
  type Address,
  type AddressView,
  type CardBrand,
  type PaymentMethodView,
  type PaymentType,
} from "@clearcart/shared";
import type { z } from "zod";
import { prisma } from "../db";
import { HttpError, notFound } from "../errors";

type ParsedPaymentMethod = z.output<typeof NewPaymentMethodSchema>;
type ParsedAddress = z.output<typeof AddressInputSchema>;

// ---- Addresses ----

export const toAddressView = (a: AddressRow): AddressView => ({
  id: a.id,
  label: a.label as Address["label"],
  recipientName: a.recipientName,
  phone: a.phone,
  line1: a.line1,
  line2: a.line2 ?? undefined,
  postcode: a.postcode,
  city: a.city,
  state: a.state as Address["state"],
  isDefault: a.isDefault,
});

export const listAddresses = (userId: string) =>
  prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });

export async function ownedAddress(userId: string, id: string): Promise<AddressRow> {
  const row = await prisma.address.findFirst({ where: { id, userId } });
  if (!row) throw notFound("Address");
  return row;
}

/** The first address becomes the default; at most MAX_ADDRESSES. */
export async function addAddress(userId: string, input: ParsedAddress): Promise<AddressRow> {
  return prisma.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES) throw new HttpError(409, `You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`);
    return tx.address.create({ data: { ...input, line2: input.line2 ?? null, userId, isDefault: count === 0 } });
  });
}

export async function setDefaultAddress(userId: string, id: string): Promise<void> {
  await ownedAddress(userId, id);
  await prisma.$transaction([
    prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.address.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

/** Deleting the default promotes the oldest remaining address. */
export async function removeAddress(userId: string, id: string): Promise<void> {
  const row = await ownedAddress(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id: row.id } });
    if (!row.isDefault) return;
    const next = await tx.address.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
  });
}

// ---- Payment methods ----

const isExpired = (m: number | null, y: number | null) => {
  if (m === null || y === null) return false;
  const now = new Date();
  return y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1);
};

export const toPaymentView = (p: PaymentRow): PaymentMethodView => ({
  id: p.id,
  type: p.type as PaymentType,
  isDefault: p.isDefault,
  summary: paymentSummary(p),
  brand: p.brand as CardBrand | null,
  last4: p.last4,
  expMonth: p.expMonth,
  expYear: p.expYear,
  holderName: p.holderName,
  bankName: p.bankName,
  provider: p.provider,
  maskedPhone: p.maskedPhone,
  expired: p.type === "CARD" && isExpired(p.expMonth, p.expYear),
});

/**
 * The only place a new method's details are turned into storable fields. For cards, the full
 * number is used here (brand, last 4) and then dropped; it is never written or logged anywhere.
 */
export function paymentFields(input: ParsedPaymentMethod) {
  if (input.type === "CARD") {
    return {
      type: "CARD",
      brand: detectCardBrand(input.number),
      last4: input.number.slice(-4),
      expMonth: input.expMonth,
      expYear: input.expYear,
      holderName: input.holderName,
      token: `pm_${randomBytes(12).toString("hex")}`,
    };
  }
  if (input.type === "FPX") return { type: "FPX", bankName: input.bankName };
  return { type: "EWALLET", provider: input.provider, maskedPhone: maskPhone(input.phone) };
}

export const listPaymentMethods = (userId: string) =>
  prisma.paymentMethod.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });

export async function ownedPaymentMethod(userId: string, id: string): Promise<PaymentRow> {
  const row = await prisma.paymentMethod.findFirst({ where: { id, userId } });
  if (!row) throw notFound("Payment method");
  return row;
}

export async function addPaymentMethod(userId: string, input: ParsedPaymentMethod): Promise<PaymentRow> {
  const fields = paymentFields(input);
  return prisma.$transaction(async (tx) => {
    const count = await tx.paymentMethod.count({ where: { userId } });
    if (count >= MAX_PAYMENT_METHODS) throw new HttpError(409, `You can save up to ${MAX_PAYMENT_METHODS} payment methods. Delete one first.`);
    return tx.paymentMethod.create({ data: { ...fields, userId, isDefault: count === 0 } });
  });
}

export async function setDefaultPaymentMethod(userId: string, id: string): Promise<void> {
  await ownedPaymentMethod(userId, id);
  await prisma.$transaction([
    prisma.paymentMethod.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.paymentMethod.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function removePaymentMethod(userId: string, id: string): Promise<void> {
  const row = await ownedPaymentMethod(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.delete({ where: { id: row.id } });
    if (!row.isDefault) return;
    const next = await tx.paymentMethod.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
    if (next) await tx.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
  });
}

export { isExpired as paymentExpired };
