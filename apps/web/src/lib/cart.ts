import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isSelectable, type CartView } from "@clearcart/shared";
import { api } from "./api";
import { useAuth } from "./auth";
import { guestLineId, useGuestCart, useToast, type GuestLine } from "./stores";

export const cartKey = (userId: string | undefined) => ["cart", userId] as const;
const CART_MUTATION = ["cart-mutation"];

const recount = (items: CartView["items"]): CartView => ({ items, count: items.reduce((n, l) => n + l.qty, 0) });

/** Overlays the guest store on the last server preview, so guest edits show instantly. */
function guestView(preview: CartView | undefined, lines: GuestLine[]): CartView | undefined {
  if (lines.length === 0) return { items: [], count: 0 };
  if (!preview) return undefined;
  const byId = new Map(lines.map((l) => [guestLineId(l), l]));
  return recount(
    preview.items
      .filter((i) => byId.has(i.id))
      .map((i) => {
        const l = byId.get(i.id)!;
        return { ...i, qty: l.qty, selected: l.selected && isSelectable(i.status) };
      }),
  );
}

/**
 * The current account's cart. Logged in: server only, with optimistic updates that roll back
 * (plus a toast) when the server says no. Guest: the localStorage cart, priced by /cart/preview.
 */
export function useCart() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast((s) => s.show);
  const guest = useGuestCart();
  const key = cartKey(user?.id);

  const server = useQuery({ queryKey: key, queryFn: api.cart, enabled: user?.role === "BUYER", staleTime: 0 });
  const payload = guest.lines.map(({ productId, size, qty, priceCents }) => ({ productId, size, qty, priceCents }));
  // Keyed without qty/selected: those are overlaid locally, so stepping a quantity doesn't refetch.
  const previewKey = payload.map((l) => `${guestLineId(l)}@${l.priceCents ?? ""}`);
  const preview = useQuery({
    queryKey: ["cart-preview", previewKey],
    queryFn: () => api.cartPreview(payload),
    enabled: !user && !loading && payload.length > 0,
    placeholderData: keepPreviousData,
  });

  function useOptimistic<V>(call: (v: V) => Promise<CartView>, patch: (view: CartView, v: V) => CartView) {
    return useMutation({
      mutationKey: CART_MUTATION,
      mutationFn: call,
      onMutate: async (v: V) => {
        await queryClient.cancelQueries({ queryKey: key });
        const prev = queryClient.getQueryData<CartView>(key);
        if (prev) queryClient.setQueryData(key, patch(prev, v));
        return { prev };
      },
      onError: (err, _v, ctx) => {
        if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
        toast(err.message);
      },
      onSuccess: (view) => {
        // With several changes in flight, only the last response is the latest state.
        if (queryClient.isMutating({ mutationKey: CART_MUTATION }) <= 1) queryClient.setQueryData(key, view);
      },
    });
  }

  const qtyMutation = useOptimistic(
    ({ id, qty }: { id: string; qty: number }) => api.updateCartItem(id, { qty }),
    (view, { id, qty }) => recount(view.items.map((l) => (l.id === id ? { ...l, qty } : l))),
  );
  const selectMutation = useOptimistic(
    ({ ids, selected }: { ids: string[]; selected: boolean }) => api.selectCartItems(ids, selected),
    (view, { ids, selected }) => recount(view.items.map((l) => (ids.includes(l.id) && isSelectable(l.status) ? { ...l, selected } : l))),
  );
  const removeMutation = useOptimistic(
    (ids: string[]) => api.removeCartItems(ids),
    (view, ids) => recount(view.items.filter((l) => !ids.includes(l.id))),
  );

  const view = user ? server.data : guestView(preview.data, guest.lines);
  const query = user ? server : preview;

  return {
    view,
    isGuest: !user,
    isPending: loading || (!view && query.isPending),
    error: query.error,
    refetch: () => queryClient.invalidateQueries({ queryKey: user ? key : ["cart-preview"] }),
    setQty: (id: string, qty: number) => (user ? qtyMutation.mutate({ id, qty }) : guest.setQty(id, qty)),
    setSelected: (ids: string[], selected: boolean) =>
      ids.length && (user ? selectMutation.mutate({ ids, selected }) : guest.setSelected(ids, selected)),
    remove: (ids: string[]) => ids.length && (user ? removeMutation.mutate(ids) : guest.remove(ids)),
    /** Resolves true when the item made it into the cart. */
    add: async (item: { productId: string; size: string | null; qty: number; priceCents: number }): Promise<boolean> => {
      if (!user) {
        guest.add(item);
        return true;
      }
      try {
        queryClient.setQueryData(key, await api.addToCart({ productId: item.productId, size: item.size, qty: item.qty }));
        return true;
      } catch (err) {
        toast((err as Error).message);
        return false;
      }
    },
  };
}

/** Header badge: total quantity for the current account only. */
export function useCartCount(): number {
  const { user } = useAuth();
  const guestCount = useGuestCart((s) => s.lines.reduce((n, l) => n + l.qty, 0));
  const server = useQuery({ queryKey: cartKey(user?.id), queryFn: api.cart, enabled: user?.role === "BUYER", staleTime: 0 });
  return user ? (server.data?.count ?? 0) : guestCount;
}

/** The guest's ticked lines, kept across the login a guest checkout needs. */
const CHECKOUT_PICK_KEY = "cc_checkout_pick";

export function saveCheckoutPick(lines: { productId: string; size: string | null }[]): void {
  try {
    localStorage.setItem(CHECKOUT_PICK_KEY, JSON.stringify(lines.map(guestLineId)));
  } catch {
    // Storage blocked: the merged cart keeps its own selection instead.
  }
}

function takeCheckoutPick(): string[] {
  try {
    const raw = localStorage.getItem(CHECKOUT_PICK_KEY);
    localStorage.removeItem(CHECKOUT_PICK_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * After the guest cart has been merged: select exactly the lines the guest ticked (and unselect the
 * rest), so checkout shows the same items. False when none of them made it into the account cart.
 */
export async function applyCheckoutPick(queryClient: QueryClient, userId: string): Promise<boolean> {
  const pick = new Set(takeCheckoutPick());
  const key = cartKey(userId);
  const view = queryClient.getQueryData<CartView>(key) ?? (await api.cart());
  const wanted = view.items.filter((l) => pick.has(guestLineId(l)) && isSelectable(l.status)).map((l) => l.id);
  if (wanted.length === 0) return false;
  const others = view.items.filter((l) => l.selected && !wanted.includes(l.id)).map((l) => l.id);
  if (others.length) await api.selectCartItems(others, false);
  queryClient.setQueryData(key, await api.selectCartItems(wanted, true));
  return true;
}
