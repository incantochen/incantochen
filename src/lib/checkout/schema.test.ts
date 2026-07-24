import { describe, it, expect } from "vitest";
import { checkoutFormSchema } from "./schema";

const validBase = {
  email: "test@example.com",
  recipientPhone: "0912345678",
  zipCode: "100",
  customConsent: true as const,
  recipientName: "王小明",
  shippingAddress: "台北市中正區重慶南路一段1號",
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

  it("Email 超過 254 字元被拒絕", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      email: `${"a".repeat(247)}@example.com`, // 259 字元
    });
    expect(result.success).toBe(false);
  });

  it("Email 254 字元以內通過", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      email: `${"a".repeat(242)}@example.com`, // 254 字元
    });
    expect(result.success).toBe(true);
  });
});

describe("checkoutFormSchema：配送方式與條件式地址驗證（T137）", () => {
  it("缺省 deliveryMethod → 視同宅配（delivery）", () => {
    const result = checkoutFormSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.deliveryMethod).toBe("delivery");
  });

  it("宅配缺郵遞區號被拒絕", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      deliveryMethod: "delivery",
      zipCode: "",
    });
    expect(result.success).toBe(false);
  });

  it("宅配空地址被拒絕", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      deliveryMethod: "delivery",
      shippingAddress: "",
    });
    expect(result.success).toBe(false);
  });

  it("面交（pickup）空地址＋空郵遞區號通過", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      deliveryMethod: "pickup",
      zipCode: "",
      shippingAddress: "",
    });
    expect(result.success).toBe(true);
  });

  it("面交仍必填姓名與電話", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      deliveryMethod: "pickup",
      zipCode: "",
      shippingAddress: "",
      recipientName: "",
      recipientPhone: "",
    });
    expect(result.success).toBe(false);
  });

  it("不合法的 deliveryMethod 被拒絕", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      deliveryMethod: "carrier_pigeon",
    });
    expect(result.success).toBe(false);
  });

  it("面交帶了地址／郵遞區號被拒絕（髒資料不得搭 pickup 順風車）", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      deliveryMethod: "pickup",
      zipCode: "100",
      shippingAddress: "台北市中正區重慶南路一段1號",
    });
    expect(result.success).toBe(false);
  });

  it("超過 5 碼的郵遞區號被拒絕（信任邊界長度上限）", () => {
    const result = checkoutFormSchema.safeParse({
      ...validBase,
      deliveryMethod: "delivery",
      zipCode: "1006411",
    });
    expect(result.success).toBe(false);
  });
});
