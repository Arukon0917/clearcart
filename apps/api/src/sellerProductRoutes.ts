import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import type { Prisma } from "@prisma/client";
import {
  ProductSaveSchema,
  SELLER_PAGE_SIZE,
  SellerProductQuerySchema,
  type DeleteProductResponse,
  type ProductInput,
  type ProductStatus,
  type SellerProduct,
  type SellerProductListResponse,
} from "@clearcart/shared";
import { prisma } from "./db";
import { notFound } from "./errors";
import { currentUser } from "./middleware/auth";
import { parse } from "./middleware/validate";
import { invalidateCatalog } from "./services/catalogService";
import { removeUploads } from "./uploadRoutes";

// requireAuth + requireRole("SELLER") are applied to all of /api/seller in app.ts.
export const sellerProductRoutes = Router();

const slugify = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const toCents = (ringgit: number) => Math.round(ringgit * 100);

const editInclude = {
  variants: { orderBy: { position: "asc" } },
  images: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.ProductInclude;

async function sellerIdFor(res: Response): Promise<string> {
  const seller = await prisma.seller.findUnique({ where: { userId: currentUser(res).id } });
  if (!seller) throw notFound("Seller profile");
  return seller.id;
}

/** Missing and not-yours look identical, so other sellers' products stay invisible. */
async function findOwned(id: string, sellerId: string) {
  const product = await prisma.product.findFirst({ where: { id, sellerId }, include: editInclude });
  if (!product) throw notFound("Product");
  return product;
}

function toSellerProduct(p: Awaited<ReturnType<typeof findOwned>>): SellerProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    description: p.description,
    category: p.category as SellerProduct["category"],
    price: p.priceCents / 100,
    shipping: p.shippingCents / 100,
    tags: p.tags.split(",").filter(Boolean),
    sizes: p.variants.map((v) => ({ size: v.size, stock: v.stock })),
    images: p.images.map((i) => ({ url: i.url, isThumbnail: i.isThumbnail, alt: i.alt })),
    status: p.status as ProductStatus,
    updatedAt: p.updatedAt.toISOString(),
  };
}

const productFields = (data: ProductInput) => ({
  name: data.name,
  brand: data.brand,
  description: data.description,
  category: data.category,
  priceCents: toCents(data.price),
  shippingCents: toCents(data.shipping),
  tags: data.tags.join(","),
});

const variantRows = (data: ProductInput) => data.sizes.map((s, position) => ({ ...s, position }));
const imageRows = (data: ProductInput) =>
  data.images.map((img, sortOrder) => ({ url: img.url, isThumbnail: img.isThumbnail, alt: img.alt || null, sortOrder }));

sellerProductRoutes.get("/seller/products", async (req, res) => {
  const { q, status, page } = parse(SellerProductQuerySchema, req.query);
  const sellerId = await sellerIdFor(res);
  const where: Prisma.ProductWhereInput = {
    sellerId,
    ...(status && { status }),
    ...(q && { OR: [{ name: { contains: q } }, { brand: { contains: q } }] }),
  };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { variants: { select: { stock: true } }, images: { where: { isThumbnail: true }, take: 1 } },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * SELLER_PAGE_SIZE,
      take: SELLER_PAGE_SIZE,
    }),
  ]);
  const body: SellerProductListResponse = {
    items: rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      category: p.category as SellerProduct["category"],
      imageHue: p.imageHue,
      thumbnailUrl: p.images[0]?.url ?? null,
      priceCents: p.priceCents,
      totalStock: p.variants.length ? p.variants.reduce((s, v) => s + v.stock, 0) : null,
      status: p.status as ProductStatus,
      updatedAt: p.updatedAt.toISOString(),
    })),
    total,
    page,
    pageSize: SELLER_PAGE_SIZE,
  };
  res.json(body);
});

sellerProductRoutes.post("/seller/products", async (req, res) => {
  const { product: data, status } = parse(ProductSaveSchema, req.body);
  const sellerId = await sellerIdFor(res);
  const id = randomUUID();
  const created = await prisma.product.create({
    data: {
      id,
      // Suffix keeps slugs unique when two sellers use the same name.
      slug: `${slugify(data.name)}-${id.slice(0, 6)}`,
      imageHue: Math.floor(Math.random() * 360),
      sellerId,
      status,
      ...productFields(data),
      variants: { create: variantRows(data) },
      images: { create: imageRows(data) },
    },
    include: editInclude,
  });
  invalidateCatalog();
  res.status(201).json(toSellerProduct(created));
});

sellerProductRoutes.get("/seller/products/:id", async (req, res) => {
  res.json(toSellerProduct(await findOwned(String(req.params.id), await sellerIdFor(res))));
});

sellerProductRoutes.put("/seller/products/:id", async (req, res) => {
  const { product: data, status } = parse(ProductSaveSchema, req.body);
  const existing = await findOwned(String(req.params.id), await sellerIdFor(res));
  const updated = await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...productFields(data),
      status,
      // Slug stays the same so shared links keep working.
      variants: { deleteMany: {}, create: variantRows(data) },
      images: { deleteMany: {}, create: imageRows(data) },
    },
    include: editInclude,
  });
  // Files are removed only after the DB no longer references them.
  const kept = new Set(data.images.map((i) => i.url));
  await removeUploads(existing.images.map((i) => i.url).filter((url) => !kept.has(url)));
  invalidateCatalog();
  res.json(toSellerProduct(updated));
});

sellerProductRoutes.post("/seller/products/:id/archive", async (req, res) => {
  const existing = await findOwned(String(req.params.id), await sellerIdFor(res));
  const updated = await prisma.product.update({ where: { id: existing.id }, data: { status: "ARCHIVED" }, include: editInclude });
  invalidateCatalog();
  res.json(toSellerProduct(updated));
});

sellerProductRoutes.delete("/seller/products/:id", async (req, res) => {
  const existing = await findOwned(String(req.params.id), await sellerIdFor(res));
  let body: DeleteProductResponse;
  if (await prisma.orderItem.findFirst({ where: { productId: existing.id }, select: { id: true } })) {
    // Ordered at least once: keep the row so order history and reviews stay intact.
    await prisma.product.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
    body = { result: "archived" };
  } else {
    // Variants, images, reviews, fit feedback and digest cascade.
    await prisma.product.delete({ where: { id: existing.id } });
    await removeUploads(existing.images.map((i) => i.url));
    body = { result: "deleted" };
  }
  invalidateCatalog();
  res.json(body);
});
