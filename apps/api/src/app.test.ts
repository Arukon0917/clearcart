import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

const app = createApp();

describe("API", () => {
  it("GET /api/health", async () => {
    await request(app).get("/api/health").expect(200, { ok: true });
  });

  it("POST /api/search/parse returns structured filters", async () => {
    const res = await request(app)
      .post("/api/search/parse")
      .send({ query: "cheapest waterproof backpack" })
      .expect(200);
    expect(res.body.filters).toMatchObject({ category: "bags", tags: ["waterproof"], sort: "price-asc" });
  });

  it("checkout without login is a 401 LOGIN_REQUIRED", async () => {
    const res = await request(app).post("/api/checkout").send({ items: [], contact: { email: "a@b.co" } }).expect(401);
    expect(res.body.error).toMatchObject({ code: "LOGIN_REQUIRED", message: "Please log in to check out." });
  });
});
