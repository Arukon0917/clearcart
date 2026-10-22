import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

// No database: the session lookup returns a fake user with whatever role the token names.
vi.mock("./db", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        email: `${where.id}@test`,
        name: where.id,
        role: where.id.startsWith("seller") ? "SELLER" : "BUYER",
        createdAt: new Date(0),
      }),
    },
  },
}));

const { createApp } = await import("./app");
const app = createApp();

let sellerCookie = "";
let buyerCookie = "";
beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  sellerCookie = `cc_at=${jwt.sign({ role: "SELLER" }, "test-secret", { subject: "seller-1", expiresIn: 60 })}`;
  buyerCookie = `cc_at=${jwt.sign({ role: "BUYER" }, "test-secret", { subject: "buyer-1", expiresIn: 60 })}`;
});

const expectSellerBlocked = (res: request.Response) => {
  expect(res.status).toBe(403);
  expect(res.body.error).toMatchObject({ code: "SELLER_CANNOT_PURCHASE", message: "Seller accounts can't make purchases." });
};

describe("checkout and cart access by role", () => {
  it.each([
    ["get", "/api/cart"],
    ["post", "/api/cart/items"],
    ["post", "/api/cart/merge"],
    ["post", "/api/cart/preview"],
    ["post", "/api/cart/quote"],
    ["post", "/api/checkout"],
    ["post", "/api/products/p1/reviews"],
    ["put", "/api/reviews/r1"],
  ] as const)("%s %s → 403", async (method, path) => {
    expectSellerBlocked(await request(app)[method](path).set("Cookie", sellerCookie).send({}));
  });

  it("guests can't check out", async () => {
    const res = await request(app).post("/api/checkout").send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("LOGIN_REQUIRED");
  });

  it("buyers reach checkout validation, which needs cart item ids", async () => {
    const res = await request(app)
      .post("/api/checkout")
      .set("Cookie", buyerCookie)
      .send({ items: [{ productId: "p1", size: null, quantity: 1 }], shipping: {}, payment: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(expect.arrayContaining([expect.objectContaining({ path: "cartItemIds" })]));
  });
});
