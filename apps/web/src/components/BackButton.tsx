import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

const AUTH_PAGES = ["/login", "/register"];

/** Where "Back" goes when there's no in-app history (direct link, new tab) to return to. */
export function parentPath(pathname: string): string {
  if (pathname.startsWith("/seller/products/")) return "/seller";
  if (/^\/seller\/orders\/[^/]+/.test(pathname)) return "/seller/orders";
  if (/^\/orders\/[^/]+/.test(pathname)) return "/orders";
  return "/";
}

/** Rendered once in the layout, under the header. Hidden on the homepage. */
export function BackButton() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const current = useRef(pathname);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (current.current === pathname) return;
    previous.current = current.current;
    current.current = pathname;
  }, [pathname]);

  if (pathname === "/") return null;

  const goBack = () => {
    // React Router stores the history index; 0 means this tab started on the current page.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    // Stepping back into /login or /register after signing in would be a dead end.
    const cameFromAuth = previous.current !== null && AUTH_PAGES.includes(previous.current);
    if (idx > 0 && !cameFromAuth) navigate(-1);
    else navigate(parentPath(pathname));
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Go back"
      className="-ml-2 mb-3 inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-lg px-2 text-sm font-medium text-muted hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <ChevronLeft className="size-5" aria-hidden />
      <span className="max-[479px]:hidden">Back</span>
    </button>
  );
}
