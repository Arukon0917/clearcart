import type {
  AuthResponse,
  AuthUser,
  CartItem,
  AddCartItem,
  AddressInput,
  AddressView,
  NewPaymentMethod,
  PaymentMethodView,
  CanReviewResponse,
  CartView,
  GuestCartItem,
  UpdateCartItem,
  CartQuote,
  CheckoutRequest,
  DeleteProductResponse,
  ProductSave,
  SellerOrderListResponse,
  SellerProductListResponse,
  SellerShipmentDetail,
  ShipmentStatus,
  ShipmentUpdate,
  SellerProductQuery,
  FitRecommendation,
  FitRequest,
  LoginRequest,
  Order,
  OrderDetail,
  ProductDetail,
  ProductListResponse,
  RegisterRequest,
  ReviewInput,
  SellerProduct,
  SearchFilters,
  SearchParseResponse,
} from "@clearcart/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    /** Field-level validation issues (`error.fields` in the API response). */
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

// Session-establishing calls: a 401 from these is a real answer, not an expired access token.
const NO_REFRESH = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

let refreshing: Promise<boolean> | null = null;
let onSessionExpired: () => void = () => {};

/** AuthProvider registers what to do when the session can't be renewed. */
export const setSessionExpiredHandler = (handler: () => void) => {
  onSessionExpired = handler;
};

/** Single-flight: parallel 401s share one refresh, since a refresh token can be used only once. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Method = "PUT" | "PATCH" | "DELETE";

async function send(path: string, body: unknown, method?: Method): Promise<Response> {
  return fetch(`/api${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "include",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request<T>(path: string, body?: unknown, method?: Method): Promise<T> {
  let res = await send(path, body, method);
  if (res.status === 401 && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) res = await send(path, body, method);
    if (res.status === 401) onSessionExpired();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error?.message ?? "Request failed", res.status, json.error?.code, json.error?.fields);
  return json as T;
}

function toQuery(f: SearchFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    params.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const api = {
  products: (f: SearchFilters) => request<ProductListResponse>(`/products${toQuery(f)}`),
  product: (slug: string) => request<ProductDetail>(`/products/${slug}`),
  parseSearch: (query: string) => request<SearchParseResponse>("/search/parse", { query }),
  recommendFit: (req: FitRequest) => request<FitRecommendation>("/fit/recommend", req),
  quote: (items: CartItem[]) => request<CartQuote>("/cart/quote", { items }),
  cart: () => request<CartView>("/cart"),
  cartPreview: (items: GuestCartItem[]) => request<CartView>("/cart/preview", { items }),
  addToCart: (item: AddCartItem) => request<CartView>("/cart/items", item),
  updateCartItem: (id: string, change: UpdateCartItem) => request<CartView>(`/cart/items/${id}`, change, "PATCH"),
  selectCartItems: (ids: string[], selected: boolean) => request<CartView>("/cart/select", { ids, selected }),
  removeCartItems: (ids: string[]) => request<CartView>("/cart/items", { ids }, "DELETE"),
  mergeCart: (items: GuestCartItem[]) => request<CartView>("/cart/merge", { items }),
  updateProfile: (name: string) => request<AuthUser>("/account/profile", { name }, "PATCH"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ revokedSessions: number }>("/account/password", { currentPassword, newPassword }),
  addresses: () => request<AddressView[]>("/account/addresses"),
  addAddress: (input: AddressInput) => request<AddressView>("/account/addresses", input),
  updateAddress: (id: string, input: AddressInput) => request<AddressView>(`/account/addresses/${id}`, input, "PUT"),
  deleteAddress: (id: string) => request<void>(`/account/addresses/${id}`, undefined, "DELETE"),
  setDefaultAddress: (id: string) => request<AddressView[]>(`/account/addresses/${id}/default`, {}),
  paymentMethods: () => request<PaymentMethodView[]>("/account/payment-methods"),
  /** Never includes a CVV; callers strip it after validating in the browser. */
  addPaymentMethod: (input: NewPaymentMethod) => request<PaymentMethodView>("/account/payment-methods", input),
  deletePaymentMethod: (id: string) => request<void>(`/account/payment-methods/${id}`, undefined, "DELETE"),
  setDefaultPaymentMethod: (id: string) => request<PaymentMethodView[]>(`/account/payment-methods/${id}/default`, {}),
  checkout: (req: CheckoutRequest) => request<Order>("/checkout", req),
  register: (req: RegisterRequest) => request<AuthResponse>("/auth/register", req),
  login: (req: LoginRequest) => request<AuthResponse>("/auth/login", req),
  me: () => request<AuthUser>("/auth/me"),
  logout: () => request<void>("/auth/logout", {}),
  sellerProducts: (query: SellerProductQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
    return request<SellerProductListResponse>(`/seller/products?${params}`);
  },
  sellerProduct: (id: string) => request<SellerProduct>(`/seller/products/${id}`),
  createProduct: (save: ProductSave) => request<SellerProduct>("/seller/products", save),
  updateProduct: (id: string, save: ProductSave) => request<SellerProduct>(`/seller/products/${id}`, save, "PUT"),
  archiveProduct: (id: string) => request<SellerProduct>(`/seller/products/${id}/archive`, {}),
  deleteProduct: (id: string) => request<DeleteProductResponse>(`/seller/products/${id}`, undefined, "DELETE"),
  uploadImage: (dataUrl: string) => request<{ url: string }>("/seller/uploads", { dataUrl }),
  /** `url` is "/uploads/<file>"; only unattached uploads can be discarded. */
  discardUpload: (url: string) => request<void>(`/seller/uploads/${url.replace(/^\/uploads\//, "")}`, undefined, "DELETE"),
  orders: () => request<OrderDetail[]>("/orders"),
  order: (orderNo: string) => request<OrderDetail>(`/orders/${encodeURIComponent(orderNo)}`),
  track: (orderNo: string, email: string) => request<OrderDetail>(`/track?${new URLSearchParams({ orderNo, email })}`),
  sellerOrders: (status?: ShipmentStatus) =>
    request<SellerOrderListResponse>(`/seller/orders${status ? `?status=${status}` : ""}`),
  sellerOrder: (shipmentId: string) => request<SellerShipmentDetail>(`/seller/orders/${shipmentId}`),
  updateShipment: (shipmentId: string, change: ShipmentUpdate) =>
    request<SellerShipmentDetail>(`/seller/orders/${shipmentId}/status`, change),
  canReview: (productId: string) => request<CanReviewResponse>(`/products/${productId}/can-review`),
  createReview: (productId: string, input: ReviewInput) => request<{ id: string }>(`/products/${productId}/reviews`, input),
  updateReview: (id: string, input: ReviewInput) => request<{ id: string }>(`/reviews/${id}`, input, "PUT"),
};

/** Alias kept so existing imports work; the implementation lives in @clearcart/shared. */
export { formatMoney as money } from "@clearcart/shared";
