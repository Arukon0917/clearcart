import type { Request, RequestHandler } from "express";
import { tooManyRequests } from "../errors";

interface Bucket {
  count: number;
  resetAt: number;
}

const SWEEP_MS = 60_000;

/**
 * Fixed-window, in-memory limiter. Fine for a single API process; behind several instances
 * this would need a shared store (Redis) instead.
 */
export function rateLimit(opts: { max: number; windowMs: number; key: (req: Request) => string }) {
  const buckets = new Map<string, Bucket>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, SWEEP_MS).unref();

  const middleware: RequestHandler = (req, _res, next) => {
    const key = opts.key(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= opts.max) throw tooManyRequests(Math.ceil((bucket.resetAt - now) / 1000));
    bucket.count++;
    next();
  };

  return { middleware, reset: (req: Request) => buckets.delete(opts.key(req)) };
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "unknown";
