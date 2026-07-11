import { describe, it, expect } from "vitest";
import { checkoutFormSchema } from "./schema";

const validBase = {
  email: "test@example.com",
  recipientPhone: "0912345678",
  zipCode: "100",
  customConsent: true as const,
};

describe("checkoutFormSchema：長度上限（T72）", () => {
  it("收件人姓名超過 50 字元被拒絕", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      recipientName: "王".repeat(51),
      shippingAddress: "台北市中正區重慶南路一段1號",
    });
    expect(result.success).toBe(false);
  });

  it("收件人姓名 50 字元以內通過", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      recipientName: "王".repeat(50),
      shippingAddress: "台北市中正區重慶南路一段1號",
    });
    expect(result.success).toBe(true);
  });

  it("地址超過 200 字元被拒絕", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      recipientName: "王小明",
      shippingAddress: "台".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("地址 200 字元以內通過", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      recipientName: "王小明",
      shippingAddress: "台".repeat(200),
    });
    expect(result.success).toBe(true);
  });
});
