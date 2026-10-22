import { Router } from "express";
import { ReviewInputSchema, type CanReviewResponse } from "@clearcart/shared";
import { prisma } from "./db";
import { HttpError, notFound } from "./errors";
import { currentUser, optionalAuth, optionalUser, rejectSellers, requireAuth, requireRole } from "./middleware/auth";
import { parse } from "./middleware/validate";
import { getProductEntry, invalidateCatalog } from "./services/catalogService";
import { heuristicDigest } from "./services/reviewDigest";
import { detectSuspicious } from "./services/reviewSignals";

/** Only buyers who actually received the product may review it: its seller's shipment must be DELIVERED. */
async function hasDeliveredOrder(buyerId: string, product: { id: string; sellerId: string }): Promise<boolean> {
  const shipment = await prisma.shipment.findFirst({
    where: { sellerId: product.sellerId, status: "DELIVERED", order: { buyerId, items: { some: { productId: product.id } } } },
    select: { id: true },
  });
  return !!shipment;
}

/**
 * Suspicion flags depend on sibling reviews (duplicate text), so every write re-flags the whole
 * product, rebuilds its digest, and re-scores the catalog so Clarity picks the review up.
 */
async function refreshProductReviews(productId: string): Promise<void> {
  const reviews = await prisma.review.findMany({ where: { productId } });
  const flags = detectSuspicious(reviews);
  const flagged = reviews.map((r, i) => ({ ...r, isSuspicious: flags[i]!.isSuspicious, suspicionReason: flags[i]!.reason }));
  const digest = heuristicDigest(flagged);
  const digestData = { ...digest, pros: JSON.stringify(digest.pros), cons: JSON.stringify(digest.cons) };
  await prisma.$transaction([
    ...flagged.map((r) =>
      prisma.review.update({ where: { id: r.id }, data: { isSuspicious: r.isSuspicious, suspicionReason: r.suspicionReason } }),
    ),
    prisma.reviewDigest.upsert({ where: { productId }, create: { productId, ...digestData }, update: digestData }),
  ]);
  invalidateCatalog();
}

export const reviewRoutes = Router();

reviewRoutes.get("/products/:id/can-review", optionalAuth, async (req, res) => {
  const user = optionalUser(res);
  const { record } = await getProductEntry(String(req.params.id));
  const productId = record.id;
  const body: CanReviewResponse = { canReview: false, review: null };
  if (user?.role === "BUYER") {
    const existing = await prisma.review.findFirst({ where: { productId, buyerId: user.id } });
    body.review = existing && { id: existing.id, rating: existing.rating, body: existing.body };
    body.canReview = !!existing || (await hasDeliveredOrder(user.id, record));
  }
  res.json(body);
});

reviewRoutes.post("/products/:id/reviews", rejectSellers, requireAuth, requireRole("BUYER"), async (req, res) => {
  const user = currentUser(res);
  const input = parse(ReviewInputSchema, req.body);
  const { record } = await getProductEntry(String(req.params.id));
  const productId = record.id;
  if (!(await hasDeliveredOrder(user.id, record))) {
    throw new HttpError(403, "You can review this once an order containing it has been delivered");
  }
  if (await prisma.review.findFirst({ where: { productId, buyerId: user.id } })) {
    throw new HttpError(409, "You've already reviewed this product. Edit your review instead.");
  }
  const review = await prisma.review.create({
    data: {
      productId,
      buyerId: user.id,
      author: user.name,
      rating: input.rating,
      title: "",
      body: input.body,
      verified: true,
      isSuspicious: false,
      createdAt: new Date(),
    },
  });
  await refreshProductReviews(productId);
  res.status(201).json({ id: review.id });
});

reviewRoutes.put("/reviews/:id", rejectSellers, requireAuth, async (req, res) => {
  const input = parse(ReviewInputSchema, req.body);
  const review = await prisma.review.findUnique({ where: { id: String(req.params.id) } });
  // Someone else's review looks exactly like a missing one.
  if (!review || review.buyerId !== currentUser(res).id) throw notFound("Review");
  await prisma.review.update({ where: { id: review.id }, data: { rating: input.rating, body: input.body } });
  await refreshProductReviews(review.productId);
  res.json({ id: review.id });
});
