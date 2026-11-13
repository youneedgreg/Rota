import { describe, expect, it } from "vitest";
import { RECEIPT_CHECKS } from "./index";

describe("RECEIPT_CHECKS", () => {
  it("lists the four checks in the order Verify runs them", () => {
    expect(RECEIPT_CHECKS).toEqual(["paid", "address", "issuer", "amount"]);
  });
});
