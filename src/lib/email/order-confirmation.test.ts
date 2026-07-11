import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    RESEND_API_KEY: "test",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

const sendMock = vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendOrderConfirmation } from "./order-confirmation";

// 收件人姓名／地址為客人自由輸入，未跳脫直接插入信件 HTML 可被注入任意
// HTML／釣魚連結（T72／F-001）。驗證惡意輸入不會以原始 HTML 出現在寄給
// 客人的訂單確認信中。
function mockOrderRow(overrides: {
  recipientName: string;
  shippingAddress: string;
}) {
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: (table: string) => {
      if (table !== "orders") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  order_no: "ORD-TEST-001",
                  recipient_name: overrides.recipientName,
                  total_amount: 1000,
                  shipping_address: overrides.shippingAddress,
                  zip_code: "100",
                  member: { email: "customer@example.com" },
                  order_item: [
                    {
                      quantity: 1,
                      unit_price_snapshot: 1000,
                      config_snapshot: { selections: [] },
                      product_name_snapshot: "測試商品",
                      product: { name: "測試商品" },
                    },
                  ],
                },
                error: null,
              }),
          }),
        }),
      };
    },
  } as unknown as ReturnType<typeof createServiceRoleClient>);
}

describe("sendOrderConfirmation：HTML escape（T72／F-001）", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("收件人姓名含 <script> 標籤時，寄出的信件 html 不含未跳脫的原始標籤", async () => {
    mockOrderRow({
      recipientName: '<script>alert("xss")</script>',
      shippingAddress: "台北市中正區重慶南路一段1號",
    });

    await sendOrderConfirmation("order-1");

    const html = sendMock.mock.calls[0]?.[0]?.html as string;
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("地址含 HTML 屬性注入字元時同樣被跳脫", async () => {
    mockOrderRow({
      recipientName: "王小明",
      shippingAddress: '"><img src=x onerror=alert(1)>',
    });

    await sendOrderConfirmation("order-2");

    const html = sendMock.mock.calls[0]?.[0]?.html as string;
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});
