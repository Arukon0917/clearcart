import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { removeLegacyCartKeys, useToast } from "./lib/stores";
import { useCartCount } from "./lib/cart";
import { BackButton } from "./components/BackButton";
import { AccountPage } from "./pages/AccountPage";
import { Toast } from "./components";

// The old cart key was shared by every account on this device; carts are per account now.
removeLegacyCartKeys();

function GlobalToast() {
  const { message, hide } = useToast();
  return message ? <Toast message={message} onDone={hide} /> : null;
}
import { AuthProvider, useAuth } from "./lib/auth";
import { CompareDrawer } from "./CompareDrawer";
import { RequireAuth } from "./RequireAuth";
import { ThemeToggle } from "./components/ThemeToggle";
import { CatalogPage } from "./pages/CatalogPage";
import { ProductPage } from "./pages/ProductPage";
import { CartPage } from "./pages/CartPage";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import { SellerPage } from "./pages/SellerPage";
import { ProductFormPage } from "./pages/ProductForm";
import { OrderDetailPage, OrdersPage, TrackPage } from "./pages/OrderPages";
import { SellerOrderDetailPage, SellerOrdersPage } from "./pages/SellerOrderPages";
import "./index.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } });

function AccountLinks() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  if (loading) return null;
  if (!user) {
    return (
      <Link to="/login" className="text-sm font-medium hover:text-brand-700">
        Login / Register
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <Link to="/account" title="Account settings" className="rounded-lg px-1 hover:text-brand-700">
        {user.name}{" "}
        <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold text-muted">
          {user.role === "SELLER" ? "Seller" : "Buyer"}
        </span>
      </Link>
      {/* Seller links are only rendered for sellers; buyers and guests never see them. */}
      {user.role === "SELLER" ? (
        <Link to="/seller" className="font-medium hover:text-brand-700">My store</Link>
      ) : (
        <Link to="/orders" className="font-medium hover:text-brand-700">My orders</Link>
      )}
      <span className="text-muted">·</span>
      <button type="button" onClick={() => { void logout().then(() => navigate("/")); }} className="text-muted hover:text-ink">
        Logout
      </button>
    </span>
  );
}

function CartLink() {
  const count = useCartCount();
  return (
    <NavLink to="/cart" className="relative rounded-full p-2 hover:bg-raised" aria-label={`Cart, ${count} items`}>
      <ShoppingCart className="size-6" />
      {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full bg-brand-600 text-xs font-bold text-on-accent">{count}</span>}
    </NavLink>
  );
}

function Header() {
  const { user, loading } = useAuth();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="logo text-xl font-extrabold tracking-tight">Clear<span className="text-brand-600">Cart</span></Link>
        <div className="flex items-center gap-3">
          <AccountLinks />
          <ThemeToggle />
          {/* Sellers can't buy, so they get no cart at all. */}
          {!loading && user?.role !== "SELLER" && <CartLink />}
        </div>
      </div>
    </header>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Header />
          <main className="mx-auto max-w-6xl px-4 pb-32 pt-6">
            <BackButton />
            <Routes>
              <Route path="/" element={<CatalogPage />} />
              <Route path="/p/:slug" element={<ProductPage />} />
              {/* Checkout is a step inside the cart page, so this one guard covers both. */}
              <Route path="/cart" element={<RequireAuth role="BUYER" allowGuest><CartPage /></RequireAuth>} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:orderNo" element={<OrderDetailPage />} />
              <Route path="/track" element={<TrackPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/seller" element={<SellerPage />} />
              <Route path="/seller/orders" element={<SellerOrdersPage />} />
              <Route path="/seller/orders/:shipmentId" element={<SellerOrderDetailPage />} />
              <Route path="/seller/products/new" element={<ProductFormPage />} />
              <Route path="/seller/products/:id/edit" element={<ProductFormPage />} />
            </Routes>
          </main>
          <CompareDrawer />
          <GlobalToast />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
