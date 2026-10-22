import cors from "cors";
import express from "express";
import { errorHandler } from "./middleware/errorHandler";
import { rejectSellers, requireAuth, requireRole } from "./middleware/auth";
import { routes } from "./routes";
import { authRoutes } from "./authRoutes";
import { accountRoutes } from "./accountRoutes";
import { cartRoutes } from "./cartRoutes";
import { orderRoutes } from "./orderRoutes";
import { reviewRoutes } from "./reviewRoutes";
import { sellerProductRoutes } from "./sellerProductRoutes";
import { UPLOAD_DIR, uploadRoutes } from "./uploadRoutes";

const WEB_ORIGIN = "http://localhost:5173";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    next();
  });
  // The web app normally goes through the Vite proxy (same origin); this only covers direct calls.
  app.use(cors({ origin: WEB_ORIGIN, credentials: true }));
  app.use(
    "/uploads",
    express.static(UPLOAD_DIR, {
      index: false,
      maxAge: "7d",
      setHeaders: (res, path) => {
        // Seeded product art is SVG: serve it as an image and forbid any script if opened directly.
        if (path.endsWith(".svg")) {
          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
        }
      },
    }),
  );
  // Sellers can't shop: every cart endpoint (guest preview/quote included) and checkout.
  app.use(["/api/cart", "/api/checkout"], rejectSellers);
  // Every seller endpoint, whichever router defines it, is seller-only.
  app.use("/api/seller", requireAuth, requireRole("SELLER"));
  // Before the global JSON parser: the upload route has its own 5 MB limit.
  app.use("/api", uploadRoutes);
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", authRoutes);
  app.use("/api", accountRoutes);
  app.use("/api", sellerProductRoutes);
  app.use("/api", orderRoutes);
  app.use("/api", reviewRoutes);
  app.use("/api", routes);
  // After `routes`: the public POST /cart/quote lives there, and cartRoutes guards /cart with requireAuth.
  app.use("/api", cartRoutes);
  app.use(errorHandler);
  return app;
}
