import { createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import type { User } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../errors";
import { REFRESH_TTL_MS } from "../middleware/auth";
import { clientIp } from "../middleware/rateLimit";

/** Only the hash is stored, so a leaked Session table can't be replayed as cookies. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const expired = () => new HttpError(401, "Your session has expired. Log in again.");

/** Creates a session and returns the raw refresh token (it exists only in the cookie). */
export async function startSession(userId: string, req: Request): Promise<string> {
  const token = randomBytes(64).toString("base64url");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: req.get("user-agent")?.slice(0, 255) ?? null,
      ip: clientIp(req),
    },
  });
  return token;
}

/**
 * Rotation: each refresh token works exactly once. Presenting a revoked one means it was copied,
 * so every session of that user is revoked and they must log in again everywhere.
 */
export async function rotateSession(token: string, req: Request): Promise<{ user: User; token: string }> {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) throw expired();
  if (session.revokedAt) {
    await prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    throw expired();
  }
  if (session.expiresAt <= new Date()) throw expired();

  // Conditional update: of two concurrent refreshes with the same token, only one wins.
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) throw expired();
  return { user: session.user, token: await startSession(session.userId, req) };
}

/**
 * After a password change: every session except the one making the request is revoked.
 * Other devices' access tokens stay valid until they expire (≤ 15 min), then refresh fails.
 */
export async function revokeOtherSessions(userId: string, currentToken: string | undefined): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(currentToken && { tokenHash: { not: hashToken(currentToken) } }) },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function endSession(token: string): Promise<void> {
  await prisma.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}
