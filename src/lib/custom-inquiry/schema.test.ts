import { describe, it, expect } from "vitest";
import { customInquiryFormSchema } from "./schema";

const base = {
  category: "ring" as const,
  budgetBand: "3-5" as const,
  idea: "想要一顆祖母綠、日常好戴的戒指",
  email: "  Alice@Example.com ",
};

describe("customInquiryFormSchema", () => {
  it("正常路徑：trim email 並保留選填欄位", () => {
    const r = customInquiryFormSchema.safeParse({
      ...base,
      phone: " 0912345678 ",
      preferredTime: " 平日晚上 ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // email 前後空白去除（大小寫在 action 層 toLowerCase）
      expect(r.data.email).toBe("Alice@Example.com");
      expect(r.data.phone).toBe("0912345678");
      expect(r.data.preferredTime).toBe("平日晚上");
    }
  });

  it("選填空字串 → undefined", () => {
    const r = customInquiryFormSchema.safeParse({
      ...base,
      phone: "   ",
      preferredTime: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBeUndefined();
      expect(r.data.preferredTime).toBeUndefined();
    }
  });

  it("非白名單品項 → 失敗", () => {
    const r = customInquiryFormSchema.safeParse({ ...base, category: "watch" });
    expect(r.success).toBe(false);
  });

  it("非白名單預算 → 失敗", () => {
    const r = customInquiryFormSchema.safeParse({ ...base, budgetBand: "99" });
    expect(r.success).toBe(false);
  });

  it("email 格式錯誤 → 失敗", () => {
    const r = customInquiryFormSchema.safeParse({ ...base, email: "not-email" });
    expect(r.success).toBe(false);
  });

  it("想法空白 → 失敗", () => {
    const r = customInquiryFormSchema.safeParse({ ...base, idea: "   " });
    expect(r.success).toBe(false);
  });

  it("想法超過 2000 字 → 失敗", () => {
    const r = customInquiryFormSchema.safeParse({
      ...base,
      idea: "字".repeat(2001),
    });
    expect(r.success).toBe(false);
  });
});
