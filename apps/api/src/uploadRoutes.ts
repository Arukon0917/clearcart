import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router } from "express";
import { z } from "zod";
import { MAX_UPLOAD_BYTES } from "@clearcart/shared";
import { prisma } from "./db";
import { HttpError, notFound } from "./errors";
import { parse } from "./middleware/validate";

export const UPLOAD_DIR = fileURLToPath(new URL("../uploads/", import.meta.url));

const FILE_NAME = /^[a-f0-9-]+\.(jpg|png|webp)$/;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** The declared type must match the file's real signature bytes, not just the data-URL prefix. */
const TYPES = {
  jpeg: { ext: "jpg", matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { ext: "png", matches: (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  webp: { ext: "webp", matches: (b: Buffer) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
} as const;

const UploadRequestSchema = z.object({ dataUrl: z.string().min(1, "Choose an image") });

const fileNameOf = (url: string) => {
  const name = url.replace(/^\/uploads\//, "");
  return FILE_NAME.test(name) ? name : null;
};

/** Deletes upload files by URL; anything that isn't one of our file names is ignored. */
export async function removeUploads(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map((url) => {
      const name = fileNameOf(url);
      return name ? rm(join(UPLOAD_DIR, name), { force: true }) : undefined;
    }),
  );
}

/** Run at startup: uploads never attached to a product within 24h are abandoned form sessions. */
export async function cleanOrphanUploads(): Promise<number> {
  let files: string[];
  try {
    files = await readdir(UPLOAD_DIR);
  } catch {
    return 0;
  }
  const attached = new Set((await prisma.productImage.findMany({ select: { url: true } })).map((i) => i.url));
  const cutoff = Date.now() - ORPHAN_AGE_MS;
  let removed = 0;
  for (const file of files) {
    if (!FILE_NAME.test(file) || attached.has(`/uploads/${file}`)) continue;
    const path = join(UPLOAD_DIR, file);
    if ((await stat(path)).mtimeMs < cutoff) {
      await rm(path, { force: true });
      removed++;
    }
  }
  return removed;
}

export const uploadRoutes = Router();

// Mounted before the global 100 KB JSON parser. Seller auth runs at the app level (/api/seller),
// so it happens before this larger body is parsed. Base64 inflates 3 MB to ~4 MB.
uploadRoutes.post("/seller/uploads", express.json({ limit: "4.5mb" }), async (req, res) => {
  const { dataUrl } = parse(UploadRequestSchema, req.body);
  const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new HttpError(400, "Upload a JPEG, PNG or WebP image");

  const type = TYPES[match[1] as keyof typeof TYPES];
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "Images must be 3 MB or smaller");
  if (!type.matches(bytes)) throw new HttpError(400, "That file isn't a valid image");

  const file = `${randomUUID()}.${type.ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, file), bytes);
  res.status(201).json({ url: `/uploads/${file}` });
});

/** Discards an upload the form no longer uses. Files attached to a product are removed only via product saves. */
uploadRoutes.delete("/seller/uploads/:file", async (req, res) => {
  const url = `/uploads/${String(req.params.file)}`;
  if (!fileNameOf(url)) throw notFound("Upload");
  if (await prisma.productImage.findFirst({ where: { url }, select: { id: true } })) {
    throw new HttpError(409, "That photo belongs to a saved product; remove it from the product and save");
  }
  await removeUploads([url]);
  res.status(204).end();
});
