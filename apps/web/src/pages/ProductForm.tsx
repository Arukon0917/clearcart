import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, GripVertical, ImagePlus, RefreshCw, Star, Trash2 } from "lucide-react";
import {
  CATEGORIES,
  MAX_IMAGES,
  ProductInputSchema,
  SIZE_OPTIONS,
  TAGS,
  TAG_LABELS,
  priceBreakdown,
  type Category,
  type ProductInput,
  type ProductStatus,
  type SellerProduct,
} from "@clearcart/shared";
import { ApiError, api, money } from "../lib/api";
import { Toast } from "../components";
import { RequireSeller, StatusBadge } from "./SellerPage";

/** Alt text is kept as a plain string while editing; empty means "none". */
interface FormImage {
  url: string;
  isThumbnail: boolean;
  alt: string;
}

/** Form state keeps numbers as strings so inputs can be empty while typing. */
interface FormState {
  name: string;
  brand: string;
  description: string;
  category: Category;
  price: string;
  shipping: string;
  tags: string[];
  stock: Record<string, string>;
  images: FormImage[];
}

const EMPTY: FormState = { name: "", brand: "", description: "", category: "shoes", price: "", shipping: "0", tags: [], stock: {}, images: [] };

function fromProduct(p: ProductInput): FormState {
  return {
    name: p.name,
    brand: p.brand,
    description: p.description,
    category: p.category,
    price: String(p.price),
    shipping: String(p.shipping),
    tags: p.tags,
    stock: Object.fromEntries(p.sizes.map((s) => [s.size, String(s.stock)])),
    images: p.images.map((i) => ({ url: i.url, isThumbnail: i.isThumbnail, alt: i.alt ?? "" })),
  };
}

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

function toInput(s: FormState): ProductInput {
  return {
    name: s.name,
    brand: s.brand,
    description: s.description,
    category: s.category,
    price: num(s.price),
    shipping: num(s.shipping),
    tags: s.tags,
    sizes: (SIZE_OPTIONS[s.category] ?? [])
      .filter((size) => (s.stock[size] ?? "").trim() !== "")
      .map((size) => ({ size, stock: num(s.stock[size]!) })),
    images: s.images.map((i) => ({ url: i.url, isThumbnail: i.isThumbnail, alt: i.alt.trim() || null })),
  };
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;
const LEAVE_WARNING = "You have unsaved changes. Leave without saving?";

/** Shrinks a photo in the browser so uploads stay small; always re-encodes as JPEG. */
async function resizeToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // JPEG has no transparency: paint white so transparent PNGs don't turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

const uploadFile = async (file: File) => (await api.uploadImage(await resizeToDataUrl(file))).url;

/** Keeps the "exactly one thumbnail" rule: the first photo takes over when none is marked. */
const withThumbnail = (images: FormImage[]): FormImage[] =>
  images.length && !images.some((i) => i.isThumbnail) ? images.map((img, i) => ({ ...img, isThumbnail: i === 0 })) : images;

const firstSegment = (path: PropertyKey[] | string) => (Array.isArray(path) ? String(path[0]) : String(path).split(".")[0]);
const toErrors = (issues: { path: PropertyKey[] | string; message: string }[]) =>
  Object.fromEntries(issues.map((i) => [firstSegment(i.path), i.message]));
const without = (errors: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key));

const inputClass = (error?: string) => `mt-1 w-full rounded-lg border bg-surface px-3 py-2 ${error ? "border-bad" : "border-line-strong"}`;
const ErrorText = ({ error }: { error?: string }) => (error ? <span className="text-xs text-bad">{error}</span> : null);
const iconButton = "rounded-md bg-surface/90 p-1 shadow hover:bg-surface disabled:opacity-30";

/** Warns before a reload/close, and before following any in-app link, while there are unsaved edits. */
function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    // BrowserRouter has no navigation blocker, so intercept link clicks before React Router sees them.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (link && !window.confirm(LEAVE_WARNING)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

function ProductForm({ product }: { product?: SellerProduct }) {
  const initial = product ? fromProduct(product) : EMPTY;
  const [state, setState] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [status, setStatus] = useState<ProductStatus | null>(product?.status ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(0);
  const [toast, setToast] = useState<string | null>((useLocation().state as { toast?: string } | null)?.toast ?? null);
  const dragFrom = useRef<number | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = product?.id;

  const dirty = JSON.stringify(state) !== JSON.stringify(baseline);
  useLeaveWarning(dirty);
  const clearToast = useCallback(() => setToast(null), []);

  // Photos the server already has attached; anything else is a fresh upload we may discard right away.
  const attached = new Set(baseline.images.map((i) => i.url));
  const discard = (url: string) => {
    if (!attached.has(url)) api.discardUpload(url).catch(() => {}); // Leftovers are swept at server start.
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));
  const setImages = (update: (images: FormImage[]) => FormImage[]) =>
    setState((s) => ({ ...s, images: withThumbnail(update(s.images)) }));

  const save = useMutation({
    mutationFn: ({ input, status }: { input: ProductInput; status: "DRAFT" | "ACTIVE" }) =>
      id ? api.updateProduct(id, { product: input, status }) : api.createProduct({ product: input, status }),
    onSuccess: (saved) => {
      const message = saved.status === "ACTIVE" ? "Published. It's live in the shop." : "Saved as a draft.";
      queryClient.invalidateQueries({ queryKey: ["seller-products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product"] });
      queryClient.setQueryData(["seller-product", saved.id], saved);
      const next = fromProduct(saved);
      setState(next);
      setBaseline(next);
      setStatus(saved.status);
      if (!id) navigate(`/seller/products/${saved.id}/edit`, { replace: true, state: { toast: message } });
      else setToast(message);
    },
    onError: (err) => setErrors(err instanceof ApiError && err.details?.length ? toErrors(err.details) : { form: err.message }),
  });
  const busy = save.isPending || uploading > 0;

  const withUpload = async (work: () => Promise<void>) => {
    setUploading((n) => n + 1);
    try {
      await work();
    } catch (err) {
      setErrors((er) => ({ ...er, images: (err as Error).message }));
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    const room = MAX_IMAGES - state.images.length;
    if (files.length > room) setErrors((er) => ({ ...er, images: `Only ${MAX_IMAGES} photos allowed; extra files were skipped` }));
    else setErrors((er) => without(er, "images"));
    // One at a time, appending as each finishes, so a failure keeps the earlier uploads.
    void withUpload(async () => {
      for (const file of files.slice(0, Math.max(0, room))) {
        const url = await uploadFile(file);
        setImages((imgs) => [...imgs, { url, isThumbnail: false, alt: "" }]);
      }
    });
  };

  const replace = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const old = state.images[index]!.url;
    void withUpload(async () => {
      const url = await uploadFile(file);
      setImages((imgs) => imgs.map((img) => (img.url === old ? { ...img, url } : img)));
      discard(old);
    });
  };

  const remove = (index: number) => {
    const url = state.images[index]!.url;
    setImages((imgs) => imgs.filter((_, j) => j !== index));
    discard(url);
  };

  const move = (from: number, to: number) =>
    setImages((imgs) => {
      if (from === to || to < 0 || to >= imgs.length) return imgs;
      const next = [...imgs];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      return next;
    });

  const submit = (target: "DRAFT" | "ACTIVE") => {
    const result = ProductInputSchema.safeParse(toInput(state));
    if (!result.success) return setErrors(toErrors(result.error.issues));
    setErrors({});
    save.mutate({ input: result.data, status: target });
  };

  const price = num(state.price);
  const shipping = num(state.shipping);
  const preview = price > 0 && shipping >= 0 ? priceBreakdown(Math.round(price * 100), Math.round(shipping * 100)) : null;
  const sizeOptions = SIZE_OPTIONS[state.category];

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit("ACTIVE"); }} noValidate className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4 rounded-card border border-line bg-surface p-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{id ? "Edit product" : "Add product"}</h1>
          {status && <StatusBadge status={status} />}
          {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
        </div>

        <fieldset>
          <legend className="text-sm font-medium">
            Photos <span className="font-normal text-muted">(1–{MAX_IMAGES}; drag to reorder, ★ marks the thumbnail)</span>
          </legend>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {state.images.map((img, i) => (
              <div
                key={img.url}
                draggable
                onDragStart={() => (dragFrom.current = i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom.current !== null) move(dragFrom.current, i);
                  dragFrom.current = null;
                }}
                className="space-y-1"
              >
                <div className={`relative cursor-grab overflow-hidden rounded-xl border-2 ${img.isThumbnail ? "border-brand-600" : "border-line"}`}>
                  <img src={img.url} alt={img.alt || `Photo ${i + 1}`} className="aspect-square w-full object-cover" draggable={false} />
                  <div className="absolute inset-x-1 top-1 flex justify-between">
                    <button type="button" onClick={() => setImages((imgs) => imgs.map((x, j) => ({ ...x, isThumbnail: j === i })))}
                      aria-label="Set as thumbnail" aria-pressed={img.isThumbnail} className={iconButton}>
                      <Star className={`size-4 ${img.isThumbnail ? "fill-star text-star" : ""}`} />
                    </button>
                    <span className="flex gap-1">
                      <label className={`${iconButton} cursor-pointer`} aria-label="Replace photo" title="Replace photo">
                        <RefreshCw className="size-4" />
                        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => replace(i, e)} className="sr-only" />
                      </label>
                      <button type="button" onClick={() => remove(i)} disabled={busy} aria-label="Remove photo" className={iconButton}>
                        <Trash2 className="size-4 text-bad" />
                      </button>
                    </span>
                  </div>
                  <div className="absolute inset-x-1 bottom-1 flex items-center justify-between">
                    <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label="Move left" className={iconButton}><ChevronLeft className="size-4" /></button>
                    <GripVertical className="size-4 text-white drop-shadow" aria-hidden />
                    <button type="button" disabled={i === state.images.length - 1} onClick={() => move(i, i + 1)} aria-label="Move right" className={iconButton}><ChevronRight className="size-4" /></button>
                  </div>
                </div>
                <input
                  value={img.alt}
                  onChange={(e) => setImages((imgs) => imgs.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                  maxLength={150}
                  placeholder="Alt text (optional)"
                  aria-label={`Alt text for photo ${i + 1}`}
                  className="w-full rounded-md border border-line-strong px-2 py-1 text-xs"
                />
              </div>
            ))}
            {state.images.length < MAX_IMAGES && (
              <label className={`grid aspect-square cursor-pointer place-items-center rounded-xl border-2 border-dashed text-center text-xs text-muted hover:border-brand-600 ${errors.images ? "border-bad" : "border-line-strong"}`}>
                <span><ImagePlus className="mx-auto mb-1 size-6" />{uploading ? "Uploading…" : "Add photos"}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={addFiles} className="sr-only" />
              </label>
            )}
          </div>
          <ErrorText error={errors.images} />
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Name<input value={state.name} onChange={(e) => set("name", e.target.value)} className={inputClass(errors.name)} /><ErrorText error={errors.name} /></label>
          <label className="text-sm">Brand<input value={state.brand} onChange={(e) => set("brand", e.target.value)} className={inputClass(errors.brand)} /><ErrorText error={errors.brand} /></label>
        </div>
        <label className="block text-sm">Description
          <textarea rows={4} value={state.description} onChange={(e) => set("description", e.target.value)} className={inputClass(errors.description)} />
          <ErrorText error={errors.description} />
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="text-sm">Category
            <select value={state.category} onChange={(e) => setState((s) => ({ ...s, category: e.target.value as Category, stock: {} }))} className={inputClass(errors.category)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <ErrorText error={errors.category} />
          </label>
          <label className="text-sm">Price (RM)<input type="number" min="0" step="0.01" inputMode="decimal" value={state.price} onChange={(e) => set("price", e.target.value)} className={inputClass(errors.price)} /><ErrorText error={errors.price} /></label>
          <label className="text-sm">Shipping (RM)<input type="number" min="0" step="0.01" inputMode="decimal" value={state.shipping} onChange={(e) => set("shipping", e.target.value)} className={inputClass(errors.shipping)} /><ErrorText error={errors.shipping} /></label>
        </div>

        {sizeOptions && (
          <fieldset>
            <legend className="text-sm font-medium">Stock per size <span className="font-normal text-muted">(blank = not sold in that size, 0 = out of stock)</span></legend>
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {sizeOptions.map((size) => (
                <label key={size} className="text-center text-xs">
                  {size}
                  <input type="number" min="0" step="1" value={state.stock[size] ?? ""} onChange={(e) => set("stock", { ...state.stock, [size]: e.target.value })} className={inputClass(errors.sizes)} />
                  {state.stock[size]?.trim() === "0" && <span className="text-[10px] text-bad">Out of stock</span>}
                </label>
              ))}
            </div>
            <ErrorText error={errors.sizes} />
          </fieldset>
        )}

        <fieldset>
          <legend className="text-sm font-medium">Tags</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TAGS.map((t) => {
              const on = state.tags.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => set("tags", on ? state.tags.filter((x) => x !== t) : [...state.tags, t])}
                  className={`rounded-full border px-3 py-1 text-sm ${on ? "border-brand-600 bg-brand-600 text-on-accent" : "border-line-strong bg-surface text-muted"}`}>
                  {TAG_LABELS[t]}
                </button>
              );
            })}
          </div>
          <ErrorText error={errors.tags} />
        </fieldset>
      </div>

      <aside className="h-fit space-y-4 rounded-card border border-line bg-surface p-5 lg:sticky lg:top-20">
        <h2 className="font-semibold">Shoppers will see</h2>
        {preview ? (
          <div>
            <p className="text-3xl font-bold">{money(preview.allInCents)}</p>
            <p className="text-sm text-muted">Price you pay, incl. shipping & tax</p>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><dt>Item</dt><dd>{money(preview.itemCents)}</dd></div>
              <div className="flex justify-between"><dt>Shipping</dt><dd>{preview.shippingCents ? money(preview.shippingCents) : "Free"}</dd></div>
              <div className="flex justify-between"><dt>Tax (est.)</dt><dd>{money(preview.taxCents)}</dd></div>
            </dl>
          </div>
        ) : (
          <p className="text-sm text-muted">Enter a price to preview the all-in price.</p>
        )}
        {status === "ARCHIVED" && <p className="text-sm text-muted">Archived products are hidden from the shop. Publish to relist it.</p>}
        {errors.form && <p className="text-sm text-bad" role="alert">{errors.form}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-on-accent hover:bg-brand-700 disabled:opacity-60">
          {save.isPending && save.variables?.status === "ACTIVE" ? "Publishing…" : uploading ? "Uploading photos…" : status === "ACTIVE" ? "Update listing" : "Publish"}
        </button>
        <button type="button" onClick={() => submit("DRAFT")} disabled={busy} className="w-full rounded-xl border border-line-strong py-3 font-semibold hover:bg-subtle disabled:opacity-60">
          {save.isPending && save.variables?.status === "DRAFT" ? "Saving…" : status === "ACTIVE" ? "Unpublish & save draft" : "Save draft"}
        </button>
        <Link to="/seller" className="block text-center text-sm text-muted underline">Back to your store</Link>
      </aside>
      {toast && <Toast message={toast} onDone={clearToast} />}
    </form>
  );
}

function ProductFormLoader() {
  const { id } = useParams();
  const existing = useQuery({ queryKey: ["seller-product", id], queryFn: () => api.sellerProduct(id!), enabled: Boolean(id) });
  if (id && existing.isPending) return <div className="h-96 animate-pulse rounded-card bg-line" />;
  if (id && existing.isError) {
    return <p className="py-20 text-center text-muted">Product not found. <Link to="/seller" className="text-brand-700 underline">Back to your store</Link></p>;
  }
  // Keyed so switching from one product to another resets the form.
  return <ProductForm key={id ?? "new"} product={existing.data} />;
}

export function ProductFormPage() {
  return (
    <RequireSeller>
      <ProductFormLoader />
    </RequireSeller>
  );
}
