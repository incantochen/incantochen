import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    RESEND_API_KEY: "test",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  },
}));

const sendMock = vi
  .fn()
  .mockResolvedValue({ data: { id: "email-1" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendOrderRefundedNotification } from "./order-refunded-notification";

type OrderRow = {
  order_no: string;
  recipient_name: string;
  total_amount: number | string;
  member: { email: string } | null;
};

function mockOrderQuery(result: {
  data: OrderRow | null;
  error: { code?: string; message: string } | null;
}) {
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: (table: string) => {
      if (table !== "orders") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve(result),
          }),
        }),
      };
    },
  } as unknown as ReturnType<typeof createServiceRoleClient>);
}

const BASE_ORDER: OrderRow = {
  order_no: "ORD-TEST-001",
  recipient_name: "王小明",
  total_amount: 25800,
  member: { email: "customer@example.com" },
};

beforeEach(() => {
  sendMock.mockClear();
  sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

describe("sendOrderRefundedNotification", () => {
  it("happy path：寄到會員 email，內容含訂單號與千分位退款金額，退款原因不進信件", async () => {
    mockOrderQuery({ data: BASE_ORDER, error: null });

    await sendOrderRefundedNotification("order-1");

    const call = sendMock.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(call.to).toBe("customer@example.com");
    expect(call.subject).toContain("ORD-TEST-001");
    expect(call.html).toContain("NT$25,800");
  });

  it("numeric 欄位回字串（PostgREST）→ 先 Number() 再排版，千分位不錯排", async () => {
    mockOrderQuery({
      data: { ...BASE_ORDER, total_amount: "25800" },
      error: null,
    });

    await sendOrderRefundedNotification("order-1");

    const html = sendMock.mock.calls[0]?.[0]?.html as string;
    expect(html).toContain("NT$25,800");
  });

  it("收件人姓名含 HTML 時被跳脫，不以原始標籤出現在信件中（T72/T84）", async () => {
    mockOrderQuery({
      data: { ...BASE_ORDER, recipient_name: '<script>alert("xss")</script>' },
      error: null,
    });

    await sendOrderRefundedNotification("order-1");

    const html = sendMock.mock.calls[0]?.[0]?.html as string;
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("查詢 PGRST116（查無此列）→ 安靜跳過不寄信、不 throw", async () => {
    mockOrderQuery({
      data: null,
      error: { code: "PGRST116", message: "0 rows" },
    });

    await expect(
      sendOrderRefundedNotification("order-1"),
    ).resolves.toBeUndefined();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("查詢其他 error（DB 暫時性故障）→ throw 讓 sendOnce 標 failed 以利重試，不得誤判成訂單不存在", async () => {
    mockOrderQuery({
      data: null,
      error: { code: "57014", message: "connection timeout" },
    });

    await expect(sendOrderRefundedNotification("order-1")).rejects.toThrow(
      "sendOrderRefundedNotification query failed",
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("會員 email 缺失 → 安靜跳過不寄信", async () => {
    mockOrderQuery({ data: { ...BASE_ORDER, member: null }, error: null });

    await sendOrderRefundedNotification("order-1");

    expect(sendMock).not.toHaveBeenCalled();
  });

  it("Resend 回 {error}（API 層級失敗不 throw）→ 明確轉 throw", async () => {
    mockOrderQuery({ data: BASE_ORDER, error: null });
    sendMock.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "bad from", statusCode: 422 },
    });

    await expect(sendOrderRefundedNotification("order-1")).rejects.toThrow(
      "Resend error",
    );
  });
});
