import { useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Archive, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, type ProductStatus, type SellerProductRow } from "@clearcart/shared";
import { RequireAuth } from "../RequireAuth";
import { api, money } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ConfirmDialog, ProductImage, Toast } from "../components";

/** Seller-only pages: guests are sent to log in, buyers get a 403. */
export function RequireSeller({ children }: { children: ReactNode }) {
  return <RequireAuth role="SELLER">{children}</RequireAuth>;
}

const STATUS_TONE: Record<ProductStatus, string> = {
  DRAFT: "bg-raised text-muted",
  ACTIVE: "bg-brand-50 text-brand-700",
  ARCHIVED: "bg-warn-soft text-warn",
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>{PRODUCT_STATUS_LABELS[status]}</span>;
}

type PendingAction = { kind: "archive" | "delete"; product: SellerProductRow };

function SellerProducts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProductStatus | "">("");
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<PendingAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const query = { q: search.trim() || undefined, status: status || undefined, page };
  const products = useQuery({
    queryKey: ["seller-products", user?.id, query],
    queryFn: () => api.sellerProducts(query),
    placeholderData: keepPreviousData,
  });

  const act = useMutation({
    mutationFn: async ({ kind, product }: PendingAction) => {
      if (kind === "archive") {
        await api.archiveProduct(product.id);
        return `Archived “${product.name}”`;
      }
      const { result } = await api.deleteProduct(product.id);
      return result === "deleted" ? `Deleted “${product.name}”` : `“${product.name}” has orders, so it was archived instead`;
    },
    onSuccess: (message) => {
      setConfirming(null);
      setToast(message);
      queryClient.invalidateQueries({ queryKey: ["seller-products"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const data = products.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(query.q || query.status);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Your store</h1>
          <p className="text-muted">{user?.name}</p>
        </div>
        <Link to="/seller/products/new" className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-on-accent hover:bg-brand-700">
          <Plus className="size-4" /> Add product
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Search products</span>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name or brand"
            className="w-full rounded-lg border border-line-strong bg-surface py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as ProductStatus | ""); setPage(1); }}
          aria-label="Filter by status"
          className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{PRODUCT_STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {products.isPending && <div className="mt-6 h-40 animate-pulse rounded-card bg-line" />}
      {products.isError && <p className="mt-6 text-bad">{products.error.message}</p>}
      {data?.total === 0 && (
        <p className="mt-10 text-center text-muted">{filtered ? "No products match your filters." : "No products yet. Add your first one."}</p>
      )}
      {act.isError && <p className="mt-4 text-sm text-bad" role="alert">{act.error.message}</p>}

      {!!data?.total && (
        <>
          {/* Below md the table scrolls inside this box, never the page. From md up there's no overflow,
              so the header can stick to the page under the site header. */}
          <div className={`mt-4 rounded-card border border-line bg-surface max-md:overflow-x-auto ${products.isFetching ? "opacity-70" : ""}`}>
            <table className="w-full table-fixed border-collapse text-sm max-md:min-w-[760px]">
              <colgroup>
                <col className="w-16" />
                <col />
                <col className="w-[120px]" />
                <col className="w-20" />
                <col className="w-[110px]" />
                <col className="w-[130px]" />
                <col className="w-[140px]" />
              </colgroup>
              <thead className="text-left text-muted">
                <tr className="[&>th]:sticky [&>th]:top-16 [&>th]:z-10 [&>th]:border-b [&>th]:border-line [&>th]:bg-subtle [&>th]:p-3 [&>th]:font-medium">
                  <th scope="col"><span className="sr-only">Image</span></th>
                  <th scope="col">Name</th>
                  <th scope="col" className="text-right">Price</th>
                  <th scope="col" className="text-right">Stock</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Updated</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="border-t border-line-soft align-middle hover:bg-subtle [&>td]:p-3">
                    <td>
                      <div className="size-10 overflow-hidden rounded-lg">
                        <ProductImage hue={p.imageHue} category={p.category} src={p.thumbnailUrl} alt="" className="aspect-square size-full" />
                      </div>
                    </td>
                    <td className="min-w-0">
                      {p.status === "ACTIVE" ? (
                        <Link to={`/p/${p.slug}`} title={p.name} className="line-clamp-2 break-words font-medium hover:underline">{p.name}</Link>
                      ) : (
                        <span title={p.name} className="line-clamp-2 break-words font-medium">{p.name}</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{money(p.priceCents)}</td>
                    <td className={`text-right tabular-nums ${p.totalStock === 0 ? "font-semibold text-bad" : ""}`} title={p.totalStock === 0 ? "Out of stock" : undefined}>
                      {p.totalStock === null ? "—" : p.totalStock}
                    </td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-right tabular-nums text-muted">{new Date(p.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Link to={`/seller/products/${p.id}/edit`} title="Edit" aria-label={`Edit ${p.name}`} className="rounded-lg border border-line-strong p-2 hover:bg-surface">
                          <Pencil className="size-4" />
                        </Link>
                        {p.status !== "ARCHIVED" && (
                          <button type="button" title="Archive" aria-label={`Archive ${p.name}`} onClick={() => setConfirming({ kind: "archive", product: p })} className="rounded-lg border border-line-strong p-2 hover:bg-surface">
                            <Archive className="size-4" />
                          </button>
                        )}
                        <button type="button" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => setConfirming({ kind: "delete", product: p })} className="rounded-lg border border-bad/40 p-2 text-bad hover:bg-bad-soft">
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>{data.total} product{data.total === 1 ? "" : "s"}</span>
            <span className="flex items-center gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-line-strong px-3 py-1.5 disabled:opacity-40">Previous</button>
              Page {data.page} of {pages}
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-line-strong px-3 py-1.5 disabled:opacity-40">Next</button>
            </span>
          </div>
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.kind === "archive" ? "Archive this product?" : "Delete this product?"}
          message={
            confirming.kind === "archive"
              ? `“${confirming.product.name}” will be hidden from the shop. You can publish it again later.`
              : `“${confirming.product.name}” and its photos will be permanently deleted. If it has ever been ordered, it will be archived instead.`
          }
          confirmLabel={confirming.kind === "archive" ? "Archive" : "Delete"}
          pending={act.isPending}
          onConfirm={() => act.mutate(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

function SellerDashboard() {
  return (
    <div>
      <div className="mb-2 flex gap-6 border-b border-line">
        <span className="border-b-2 border-brand-600 px-1 pb-2 font-medium text-ink">Products</span>
        <Link to="/seller/orders" className="border-b-2 border-transparent px-1 pb-2 font-medium text-muted hover:text-ink">Orders</Link>
      </div>
      <SellerProducts />
    </div>
  );
}

export function SellerPage() {
  return (
    <RequireSeller>
      <SellerDashboard />
    </RequireSeller>
  );
}
