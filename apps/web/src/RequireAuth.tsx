import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Loader2, ShieldX } from "lucide-react";
import type { Role } from "@clearcart/shared";
import { homeFor, useAuth } from "./lib/auth";

export function NotAuthorized() {
  const { user } = useAuth();
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <ShieldX className="mx-auto size-10 text-bad" />
      <h1 className="mt-3 text-2xl font-bold">Not authorized</h1>
      <p className="mt-1 text-muted">Your account can't open this page.</p>
      <Link to={user ? homeFor(user.role) : "/"} className="mt-5 inline-block rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-on-accent">
        Go to your home page
      </Link>
    </div>
  );
}

/**
 * Guards a route: spinner while the session loads, /login?next= for guests, 403 for the wrong role.
 * With `allowGuest` (shopping pages like the cart) guests pass and the wrong role is sent to its home page.
 */
export function RequireAuth({ role, allowGuest = false, children }: { role?: Role; allowGuest?: boolean; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid h-60 place-items-center" role="status" aria-label="Loading">
        <Loader2 className="size-8 animate-spin text-muted" />
      </div>
    );
  }
  if (!user) {
    if (allowGuest) return <>{children}</>;
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (role && user.role !== role) return allowGuest ? <Navigate to={homeFor(user.role)} replace /> : <NotAuthorized />;
  return <>{children}</>;
}
