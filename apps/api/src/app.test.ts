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

  it("rejects invalid checkout with field-level issues", async () => {
    const res = await request(app)
      .post("/api/checkout")
      .send({ items: [], contact: { email: "nope" } })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "contact.email" })]),
    );
  });
});
