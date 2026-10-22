import { Router, type Response } from "express";
import {
  CartQuoteRequestSchema,
  CheckoutRequestSchema,
  FitRequestSchema,
  SearchFiltersQuerySchema,
  SearchParseRequestSchema,
} from "@clearcart/shared";
import { parse } from "./middleware/validate";
import { prisma } from "./db";
import { notFound } from "./errors";
import { optionalAuth, optionalUser } from "./middleware/auth";
import { getProductEntry, listProducts } from "./services/catalogService";
import { checkout, quote } from "./services/checkoutService";
import { recommendSize } from "./services/fitService";
import { parseSearch } from "./services/searchService";

// Express 5 forwards rejected promises to the error handler, so handlers stay try/catch-free.
export const routes = Router();

routes.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/** A logged-in seller's seller id: they only see their own products. Undefined for buyers and guests. */
async function sellerScope(res: Response): Promise<string | undefined> {
  const user = optionalUser(res);
  if (user?.role !== "SELLER") return undefined;
  const seller = await prisma.seller.findUnique({ where: { userId: user.id }, select: { id: true } });
  // A seller account without a profile has no products, so it matches nothing.
  return seller?.id ?? "";
}

routes.get("/products", optionalAuth, async (req, res) => {
  res.json(await listProducts(parse(SearchFiltersQuerySchema, req.query), await sellerScope(res)));
});

routes.get("/products/:slug", optionalAuth, async (req, res) => {
  const sellerId = await sellerScope(res);
  const entry = await getProductEntry(String(req.params.slug));
  // Another seller's product looks missing to a seller.
  if (sellerId !== undefined && entry.record.sellerId !== sellerId) throw notFound("Product");
  res.json(entry.detail);
});

routes.post("/search/parse", async (req, res) => {
  const { query } = parse(SearchParseRequestSchema, req.body);
  res.json(await parseSearch(query));
});

routes.post("/fit/recommend", async (req, res) => {
  res.json(await recommendSize(parse(FitRequestSchema, req.body)));
});

routes.post("/cart/quote", async (req, res) => {
  const { items } = parse(CartQuoteRequestSchema, req.body);
  res.json(await quote(items));
});

// Guests can check out; a logged-in buyer's order is linked to their account.
routes.post("/checkout", optionalAuth, async (req, res) => {
  res.status(201).json(await checkout(parse(CheckoutRequestSchema, req.body), optionalUser(res)?.id));
});
