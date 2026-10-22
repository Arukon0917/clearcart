import { createApp } from "./app";
import { assertAuthConfig } from "./middleware/auth";
import { aiEnabled } from "./services/ai";
import { cleanOrphanUploads } from "./uploadRoutes";
import { backfillShipments } from "./services/fulfilment";

// apps/api/.env is loaded by `tsx --env-file` in the npm scripts.
assertAuthConfig();

const port = Number(process.env.PORT ?? 4000);

createApp().listen(port, () => {
  console.log(`ClearCart API on http://localhost:${port}/api (AI ${aiEnabled() ? "on" : "off"})`);
});

backfillShipments()
  .then((n) => n > 0 && console.log(`Created shipments for ${n} older order${n === 1 ? "" : "s"}`))
  .catch((err) => console.error("Shipment backfill failed:", err));

cleanOrphanUploads()
  .then((n) => n > 0 && console.log(`Removed ${n} orphaned upload${n === 1 ? "" : "s"}`))
  .catch((err) => console.error("Orphaned upload cleanup failed:", err));
