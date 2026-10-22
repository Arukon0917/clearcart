import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

const productInclude = {
  seller: true,
  variants: { orderBy: { position: "asc" } },
  reviews: { orderBy: { createdAt: "desc" } },
  fitFeedback: true,
  digest: true,
  images: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.ProductInclude;

export type ProductRecord = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** The catalog is small and read-only, so it's loaded once and scored in memory. Drafts and archived products never enter it. */
export function findAllProducts(): Promise<ProductRecord[]> {
  return prisma.product.findMany({ where: { status: "ACTIVE" }, include: productInclude });
}

export function createOrder(data: Prisma.OrderCreateInput) {
  return prisma.order.create({ data });
}
