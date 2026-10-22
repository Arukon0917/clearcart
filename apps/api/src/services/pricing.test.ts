import { describe, expect, it } from "vitest";
import { priceBreakdown, quoteCart } from "./pricing";

describe("pricing", () => {
  it("includes shipping and tax in the all-in price", () => {
    expect(priceBreakdown(8399, 599)).toEqual({
      itemCents: 8399,
      shippingCents: 599,
      taxCents: 672,
      allInCents: 9670,
    });
  });

  it("a one-item cart costs exactly the card's all-in price", () => {
    const card = priceBreakdown(7899, 599);
    const cart = quoteCart([
      { productId: "p1", name: "Shoe", size: "9", quantity: 1, unitCents: 7899, shippingCents: 599 },
    ]);
    expect(cart.totalCents).toBe(card.allInCents);
  });

  it("charges shipping per line, not per unit", () => {
    const cart = quoteCart([
      { productId: "p1", name: "Tee", size: "M", quantity: 3, unitCents: 1999, shippingCents: 499 },
      { productId: "p2", name: "Bag", size: null, quantity: 1, unitCents: 5999, shippingCents: 0 },
    ]);
    expect(cart.subtotalCents).toBe(1999 * 3 + 5999);
    expect(cart.shippingCents).toBe(499);
    expect(cart.totalCents).toBe(cart.subtotalCents + cart.shippingCents + cart.taxCents);
  });
});
