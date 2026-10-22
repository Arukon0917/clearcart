import { z } from "zod";
import { CategorySchema, type Category } from "./product";
import { isTag } from "./tags";

/** Standard sizes per sized category; other categories have no sizes. */
export const SIZE_OPTIONS: Partial<Record<Category, readonly string[]>> = {
  shoes: ["6", "7", "8", "9", "10", "11", "12"],
  apparel: ["XS", "S", "M", "L", "XL"],
};

export const MAX_IMAGES = 8;
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const SELLER_PAGE_SIZE = 20;

export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const ProductStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;
export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = { DRAFT: "Draft", ACTIVE: "Active", ARCHIVED: "Archived" };
/** Only files our own upload endpoint (or the seed scripts' generated art) produced; no external URLs. */
const UPLOAD_URL = /^\/uploads\/([a-f0-9-]+\.(jpg|png|webp)|seed\/[A-Za-z0-9-]+\.svg)$/;

/** What a seller submits to create or edit a product. Prices are in ringgit. */
export const ProductInputSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a product name").max(80, "Use at most 80 characters"),
    brand: z.string().trim().min(1, "Enter a brand").max(40, "Use at most 40 characters"),
    description: z
      .string()
      .trim()
      .min(10, "Describe the product in a sentence or two")
      .max(1000, "Use at most 1000 characters"),
    category: CategorySchema,
    price: z.number({ error: "Enter a price" }).positive("Price must be more than RM 0").max(100_000, "Price is too high"),
    shipping: z.number({ error: "Enter shipping (0 for free)" }).min(0, "Shipping can't be negative").max(1000, "Shipping is too high"),
    // Explicit boolean: a type-predicate callback would narrow the inferred type to Tag[].
    tags: z.array(z.string()).refine((tags): boolean => tags.every(isTag), "Unknown tag"),
    sizes: z.array(
      z.object({
        size: z.string(),
        stock: z.number({ error: "Enter stock" }).int("Stock must be a whole number").min(0, "Stock can't be negative"),
      }),
    ),
    images: z
      .array(
        z.object({
          url: z.string().regex(UPLOAD_URL, "Upload the photo again"),
          isThumbnail: z.boolean(),
          alt: z.string().trim().max(150, "Keep alt text under 150 characters").nullable().optional(),
        }),
      )
      .min(1, "Add at least one photo")
      .max(MAX_IMAGES, `Use at most ${MAX_IMAGES} photos`)
      .refine((imgs): boolean => imgs.filter((i) => i.isThumbnail).length === 1, "Mark exactly one photo as the thumbnail"),
  })
  .superRefine((p, ctx) => {
    const options = SIZE_OPTIONS[p.category];
    if (options && p.sizes.length === 0) {
      ctx.addIssue({ code: "custom", path: ["sizes"], message: "Add stock for at least one size" });
    }
    if (!options && p.sizes.length > 0) {
      ctx.addIssue({ code: "custom", path: ["sizes"], message: "This category doesn't use sizes" });
    }
    if (options && p.sizes.some((s) => !options.includes(s.size))) {
      ctx.addIssue({ code: "custom", path: ["sizes"], message: "Use the standard sizes" });
    }
  });
export type ProductInput = z.infer<typeof ProductInputSchema>;

/** Create/update body: the product plus whether to save it as a draft or publish it. */
export const ProductSaveSchema = z.object({
  product: ProductInputSchema,
  status: z.enum(["DRAFT", "ACTIVE"]),
});
export type ProductSave = z.infer<typeof ProductSaveSchema>;

export type SellerProduct = ProductInput & { id: string; slug: string; status: ProductStatus; updatedAt: string };

export const SellerProductQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: ProductStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type SellerProductQuery = z.input<typeof SellerProductQuerySchema>;

export interface SellerProductRow {
  id: string;
  slug: string;
  name: string;
  category: Category;
  imageHue: number;
  thumbnailUrl: string | null;
  priceCents: number;
  /** null when the product has no sizes (stock isn't tracked). */
  totalStock: number | null;
  status: ProductStatus;
  updatedAt: string;
}

export interface SellerProductListResponse {
  items: SellerProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** DELETE result: products that were ever ordered are archived instead, to keep order history. */
export interface DeleteProductResponse {
  result: "deleted" | "archived";
}
