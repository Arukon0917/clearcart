import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MAX_QTY, type ProductSummary } from "@clearcart/shared";

/** Logged-in carts live only on the server; this is the guest cart, kept until login merges it. */
export const GUEST_CART_KEY = "cc_cart_guest";
/** The old cart key was shared by every account on the device. */
const LEGACY_CART_KEYS = ["clearcart-cart"];

export function removeLegacyCartKeys(): void {
  for (const key of LEGACY_CART_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage blocked: nothing to remove.
    }
  }
}

export interface GuestLine {
  productId: string;
  size: string | null;
  qty: number;
  selected: boolean;
  /** Unit price seen when added, so the cart can flag price changes. */
  priceCents?: number;
}

/** Same id the server's /cart/preview gives the line. */
export const guestLineId = (l: { productId: string; size: string | null }) => `${l.productId}|${l.size ?? ""}`;

interface GuestCartState {
  lines: GuestLine[];
  add: (line: Omit<GuestLine, "selected">) => void;
  setQty: (id: string, qty: number) => void;
  setSelected: (ids: string[], selected: boolean) => void;
  remove: (ids: string[]) => void;
  clear: () => void;
}

export const useGuestCart = create<GuestCartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (line) =>
        set((s) => {
          const id = guestLineId(line);
          const existing = s.lines.find((l) => guestLineId(l) === id);
          if (!existing) return { lines: [{ ...line, selected: true }, ...s.lines] };
          return {
            lines: s.lines.map((l) =>
              l === existing ? { ...l, qty: Math.min(MAX_QTY, l.qty + line.qty), selected: true, priceCents: line.priceCents } : l,
            ),
          };
        }),
      setQty: (id, qty) => set((s) => ({ lines: s.lines.map((l) => (guestLineId(l) === id ? { ...l, qty } : l)) })),
      setSelected: (ids, selected) =>
        set((s) => ({ lines: s.lines.map((l) => (ids.includes(guestLineId(l)) ? { ...l, selected } : l)) })),
      remove: (ids) => set((s) => ({ lines: s.lines.filter((l) => !ids.includes(guestLineId(l))) })),
      clear: () => set({ lines: [] }),
    }),
    { name: GUEST_CART_KEY },
  ),
);

/** One app-wide toast, e.g. when a background cart sync is rejected and rolled back. */
export const useToast = create<{ message: string | null; show: (m: string) => void; hide: () => void }>()((set) => ({
  message: null,
  show: (message) => set({ message }),
  hide: () => set({ message: null }),
}));

export const MAX_COMPARE = 4;

interface CompareState {
  items: ProductSummary[];
  toggle: (p: ProductSummary) => void;
  clear: () => void;
}

export const useCompare = create<CompareState>()(
  persist(
    (set) => ({
      items: [],
      toggle: (p) =>
        set((s) =>
          s.items.some((i) => i.id === p.id)
            ? { items: s.items.filter((i) => i.id !== p.id) }
            : { items: [...s.items, p].slice(-MAX_COMPARE) },
        ),
      clear: () => set({ items: [] }),
    }),
    { name: "clearcart-compare" },
  ),
);
