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
import { sendSupportRequestNotification } from "./support-request-notification";

// 客人自由輸入的「說明」與姓名未跳脫直接插入信件 HTML 可被注入任意
// HTML／釣魚連結（F-001／T84）。這裡驗證惡意輸入不會以原始 HTML 出現在
// 送給店家的信件內容中。
function mockRequestRow(overrides: {
  description: string;
  recipientName: string;
}) {
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: (table: string) => {
      if (table !== "support_request") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  request_type: "return_defect",
                  description: overrides.description,
                  orders: { order_no: "ORD-TEST-001", recipient_name: overrides.recipientName },
                  member: { email: "customer@example.com" },
                },
                error: null,
              }),
          }),
        }),
      };
    },
  } as unknown as ReturnType<typeof createServiceRoleClient>);
}

describe("sendSupportRequestNotification：HTML escape（T84／F-001）", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("客人「說明」欄含 <script> 標籤時，寄出的信件 html 不含未跳脫的原始標籤", async () => {
    mockRequestRow({
      description: '瑕疵商品 <script>alert("xss")</script> 請協助處理',
      recipientName: "王小明",
    });

    await sendSupportRequestNotification("req-1");

    const html = sendMock.mock.calls[0]?.[0]?.html as string;
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("客人姓名含 HTML 屬性注入字元時同樣被跳脫", async () => {
    mockRequestRow({
      description: "正常說明內容，長度需超過十個字",
      recipientName: '"><img src=x onerror=alert(1)>',
    });

    await sendSupportRequestNotification("req-2");

    const html = sendMock.mock.calls[0]?.[0]?.html as string;
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });
});
