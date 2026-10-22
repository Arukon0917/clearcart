import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthUser, LoginRequest, RegisterRequest, Role } from "@clearcart/shared";
import { api, setSessionExpiredHandler } from "./api";
import { useGuestCart } from "./stores";

interface AuthState {
  user: AuthUser | null;
  /** True while the session cookie is being checked on first load. */
  loading: boolean;
  login: (req: LoginRequest) => Promise<AuthUser>;
  register: (req: RegisterRequest) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** After a profile edit, so the header shows the new name immediately. */
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const homeFor = (role: Role) => (role === "SELLER" ? "/seller" : "/");

/** Which role a path needs, if any. Used to vet `?next=` after login. */
export function roleForPath(path: string): Role | null {
  if (path === "/seller" || path.startsWith("/seller/")) return "SELLER";
  if (path === "/orders" || path.startsWith("/orders/")) return "BUYER";
  return null;
}

/** Only same-site paths the user's role may open; anything else falls back to their home. */
export function afterLogin(user: AuthUser, next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return homeFor(user.role);
  const needed = roleForPath(next);
  return needed && needed !== user.role ? homeFor(user.role) : next;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  /** Drops every cached per-account query (cart, orders…) so the next account never sees them. */
  const forgetClientState = () => {
    queryClient.clear();
    useGuestCart.getState().clear();
  };

  useEffect(() => {
    // Guests also land here (401 → refresh fails); they just stay logged out.
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));

    setSessionExpiredHandler(() => {
      if (!userRef.current) return;
      forgetClientState();
      setUser(null);
      const here = window.location.pathname + window.location.search;
      window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Moves the guest cart into the account. On failure it stays in localStorage for the next login. */
  const signedIn = async (u: AuthUser) => {
    // Products are scoped per role (sellers only see their own), so drop the guest's cached catalog.
    queryClient.removeQueries({ queryKey: ["products"] });
    queryClient.removeQueries({ queryKey: ["product"] });
    const guestLines = useGuestCart.getState().lines;
    if (u.role === "SELLER") {
      // Sellers can't buy: discard the guest cart instead of merging it.
      useGuestCart.getState().clear();
    } else if (guestLines.length) {
      try {
        queryClient.setQueryData(["cart", u.id], await api.mergeCart(guestLines));
        useGuestCart.getState().clear();
      } catch {
        // Keep the guest cart; the merge is retried on the next login.
      }
    }
    setUser(u);
    return u;
  };

  const value: AuthState = {
    user,
    loading,
    login: (req) => api.login(req).then((r) => signedIn(r.user)),
    register: (req) => api.register(req).then((r) => signedIn(r.user)),
    logout: async () => {
      // Clear first: the UI must not show this account's cart while the request is in flight.
      forgetClientState();
      setUser(null);
      await api.logout().catch(() => {});
    },
    updateUser: setUser,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
