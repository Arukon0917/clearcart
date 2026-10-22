import type { CookieOptions, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import type { AuthUser, Role } from "@clearcart/shared";
import { prisma } from "../db";
import { HttpError } from "../errors";

export const ACCESS_COOKIE = "cc_at";
export const REFRESH_COOKIE = "cc_rt";
const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_PATH = "/api/auth";

/** Called once from server.ts so a missing secret stops the process at boot, not on the first login. */
export function assertAuthConfig(): void {
  if (!process.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET is not set. Add it to apps/api/.env (e.g. a 64-char random hex string).");
    process.exit(1);
  }
}

const secret = () => process.env.JWT_SECRET!;

/** No cookie-parser dependency: the Cookie header is simple enough to split by hand. */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of req.headers.cookie?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const baseCookie = (): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
});

export function setAuthCookies(res: Response, user: { id: string; role: string }, refreshToken: string): void {
  const access = jwt.sign({ role: user.role }, secret(), { subject: user.id, expiresIn: ACCESS_TTL_MS / 1000 });
  res.cookie(ACCESS_COOKIE, access, { ...baseCookie(), path: "/", maxAge: ACCESS_TTL_MS });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie(), path: REFRESH_PATH, maxAge: REFRESH_TTL_MS });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(), path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: REFRESH_PATH });
}

/** Strips the password hash; this is the only user shape that leaves the API. */
export function toAuthUser(u: { id: string; email: string; name: string; role: string; createdAt: Date }): AuthUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role, createdAt: u.createdAt.toISOString() };
}

export const currentUser = (res: Response) => res.locals.user as AuthUser;

/** Resolves the access cookie to a user, or null when it's missing, invalid, expired, or the user is gone. */
async function userFromAccessCookie(req: Request) {
  const token = readCookie(req, ACCESS_COOKIE);
  if (!token) return null;
  let sub: string | undefined;
  try {
    sub = (jwt.verify(token, secret()) as jwt.JwtPayload).sub;
  } catch {
    return null;
  }
  return sub ? prisma.user.findUnique({ where: { id: sub } }) : null;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  if (res.locals.user) return next();
  const user = await userFromAccessCookie(req);
  if (!user) throw new HttpError(401, "Log in to continue");
  res.locals.user = toAuthUser(user);
  next();
};

export const requireRole =
  (role: Role): RequestHandler =>
  (_req, res, next) => {
    if (currentUser(res)?.role !== role) throw new HttpError(403, `Only ${role.toLowerCase()} accounts can do this`);
    next();
  };

/** Attaches the user when a valid access cookie is sent; otherwise continues as a guest. */
export const optionalAuth: RequestHandler = async (req, res, next) => {
  const user = await userFromAccessCookie(req);
  if (user) res.locals.user = toAuthUser(user);
  next();
};

export const optionalUser = (res: Response) => res.locals.user as AuthUser | undefined;

/** Seller accounts can't buy or review. Guests and buyers pass; the resolved user is kept for later handlers. */
export const rejectSellers: RequestHandler = async (req, res, next) => {
  if (!res.locals.user) {
    const user = await userFromAccessCookie(req);
    if (user) res.locals.user = toAuthUser(user);
  }
  if (optionalUser(res)?.role === "SELLER") {
    throw new HttpError(403, "Seller accounts can't make purchases.", undefined, "SELLER_CANNOT_PURCHASE");
  }
  next();
};
