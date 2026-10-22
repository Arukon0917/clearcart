import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  AddressInputSchema,
  CardExpirySchema,
  ChangePasswordSchema,
  NewPaymentMethodSchema,
  ProfileUpdateSchema,
} from "@clearcart/shared";
import { prisma } from "./db";
import { HttpError } from "./errors";
import { REFRESH_COOKIE, currentUser, readCookie, requireAuth, toAuthUser } from "./middleware/auth";
import { clientIp, rateLimit } from "./middleware/rateLimit";
import { parse } from "./middleware/validate";
import {
  addAddress,
  addPaymentMethod,
  listAddresses,
  listPaymentMethods,
  ownedAddress,
  ownedPaymentMethod,
  removeAddress,
  removePaymentMethod,
  setDefaultAddress,
  setDefaultPaymentMethod,
  toAddressView,
  toPaymentView,
} from "./services/accountService";
import { revokeOtherSessions } from "./services/sessionService";

const BCRYPT_ROUNDS = 12;
// Same budget as login: 5 attempts per 15 minutes, per IP + account.
const passwordLimit = rateLimit({ max: 5, windowMs: 15 * 60_000, key: (req) => `${clientIp(req)}|pw|${String(req.res?.locals.user?.id ?? "")}` });

export const accountRoutes = Router();
accountRoutes.use("/account", requireAuth);

// ---- Profile ----

accountRoutes.get("/account/profile", (_req, res) => {
  res.json(currentUser(res));
});

accountRoutes.patch("/account/profile", async (req, res) => {
  const { name } = parse(ProfileUpdateSchema, req.body);
  const user = await prisma.user.update({ where: { id: currentUser(res).id }, data: { name } });
  res.json(toAuthUser(user));
});

/** Verifies the current password, sets the new one, and signs out every other session. */
accountRoutes.post("/account/password", passwordLimit.middleware, async (req, res) => {
  const { currentPassword, newPassword } = parse(ChangePasswordSchema, req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: currentUser(res).id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    // 400, not 401: a 401 would make the client think its session expired.
    throw new HttpError(400, "Current password is incorrect", [{ path: "currentPassword", message: "Current password is incorrect" }]);
  }
  passwordLimit.reset(req);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) } });
  const revoked = await revokeOtherSessions(user.id, readCookie(req, REFRESH_COOKIE));
  res.json({ revokedSessions: revoked });
});

// ---- Addresses ----

accountRoutes.get("/account/addresses", async (_req, res) => {
  res.json((await listAddresses(currentUser(res).id)).map(toAddressView));
});

accountRoutes.post("/account/addresses", async (req, res) => {
  const input = parse(AddressInputSchema, req.body);
  res.status(201).json(toAddressView(await addAddress(currentUser(res).id, input)));
});

accountRoutes.put("/account/addresses/:id", async (req, res) => {
  const input = parse(AddressInputSchema, req.body);
  const row = await ownedAddress(currentUser(res).id, String(req.params.id));
  const updated = await prisma.address.update({ where: { id: row.id }, data: { ...input, line2: input.line2 ?? null } });
  res.json(toAddressView(updated));
});

accountRoutes.delete("/account/addresses/:id", async (req, res) => {
  await removeAddress(currentUser(res).id, String(req.params.id));
  res.status(204).end();
});

accountRoutes.post("/account/addresses/:id/default", async (req, res) => {
  const userId = currentUser(res).id;
  await setDefaultAddress(userId, String(req.params.id));
  res.json((await listAddresses(userId)).map(toAddressView));
});

// ---- Payment methods (card numbers can't be edited: delete and re-add; expiry can change) ----

accountRoutes.get("/account/payment-methods", async (_req, res) => {
  res.json((await listPaymentMethods(currentUser(res).id)).map(toPaymentView));
});

accountRoutes.post("/account/payment-methods", async (req, res) => {
  const input = parse(NewPaymentMethodSchema, req.body);
  res.status(201).json(toPaymentView(await addPaymentMethod(currentUser(res).id, input)));
});

accountRoutes.patch("/account/payment-methods/:id", async (req, res) => {
  const expiry = parse(CardExpirySchema, req.body);
  const row = await ownedPaymentMethod(currentUser(res).id, String(req.params.id));
  if (row.type !== "CARD") throw new HttpError(409, "Only a card's expiry date can be updated");
  res.json(toPaymentView(await prisma.paymentMethod.update({ where: { id: row.id }, data: expiry })));
});

accountRoutes.delete("/account/payment-methods/:id", async (req, res) => {
  await removePaymentMethod(currentUser(res).id, String(req.params.id));
  res.status(204).end();
});

accountRoutes.post("/account/payment-methods/:id/default", async (req, res) => {
  const userId = currentUser(res).id;
  await setDefaultPaymentMethod(userId, String(req.params.id));
  res.json((await listPaymentMethods(userId)).map(toPaymentView));
});
