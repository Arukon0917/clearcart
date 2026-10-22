import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { LoginRequestSchema, RegisterRequestSchema, type AuthResponse } from "@clearcart/shared";
import { prisma } from "./db";
import { HttpError } from "./errors";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  currentUser,
  readCookie,
  requireAuth,
  setAuthCookies,
  toAuthUser,
} from "./middleware/auth";
import { clientIp, rateLimit } from "./middleware/rateLimit";
import { parse } from "./middleware/validate";
import { endSession, rotateSession, startSession } from "./services/sessionService";

const BCRYPT_ROUNDS = 12;
// A new seller has no delivery history; start them neutral rather than at zero.
const NEW_SELLER = { onTimeRate: 0.9, returnRate: 0.1 };
const INVALID_LOGIN = "Invalid email or password";
// Compared against when the email is unknown, so both failure paths take the same bcrypt time.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", BCRYPT_ROUNDS);

const MINUTE = 60_000;
const rawEmail = (body: unknown) => String((body as { email?: unknown } | undefined)?.email ?? "").trim().toLowerCase();
const loginLimit = rateLimit({ max: 5, windowMs: 15 * MINUTE, key: (req) => `${clientIp(req)}|${rawEmail(req.body)}` });
const registerLimit = rateLimit({ max: 10, windowMs: 60 * MINUTE, key: (req) => clientIp(req) });

export const authRoutes = Router();

authRoutes.post("/auth/register", registerLimit.middleware, async (req, res) => {
  const { name, email, password, role } = parse(RegisterRequestSchema, req.body);
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new HttpError(409, "An account with this email already exists", [{ path: "email", message: "This email is already registered" }]);
  }
  const user = await prisma.user.create({
    data: {
      name,
      email,
      role,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      lastLoginAt: new Date(),
      ...(role === "SELLER" && { seller: { create: { id: randomUUID(), name, ...NEW_SELLER } } }),
    },
  });
  setAuthCookies(res, user, await startSession(user.id, req));
  res.status(201).json({ user: toAuthUser(user) } satisfies AuthResponse);
});

authRoutes.post("/auth/login", loginLimit.middleware, async (req, res) => {
  const { email, password } = parse(LoginRequestSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, INVALID_LOGIN, undefined, "INVALID_CREDENTIALS");

  loginLimit.reset(req);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setAuthCookies(res, updated, await startSession(user.id, req));
  res.json({ user: toAuthUser(updated) } satisfies AuthResponse);
});

authRoutes.post("/auth/refresh", async (req, res) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (!token) throw new HttpError(401, "Log in to continue");
  try {
    const { user, token: next } = await rotateSession(token, req);
    setAuthCookies(res, user, next);
    res.json({ user: toAuthUser(user) } satisfies AuthResponse);
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
});

authRoutes.post("/auth/logout", async (req, res) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (token) await endSession(token);
  clearAuthCookies(res);
  res.status(204).end();
});

authRoutes.get("/auth/me", requireAuth, (_req, res) => {
  res.json(currentUser(res));
});
