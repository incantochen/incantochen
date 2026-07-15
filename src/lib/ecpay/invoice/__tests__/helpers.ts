// 發票測試共用 fixture（T42 code review 收斂：原本三份測試各自複製
// ~20 行 serverEnv mock 與各自分岔的 encryptedResponse helper）。
// 用法：vi.mock("@/lib/env.server", async () => ({
//   serverEnv: (await import("./helpers")).TEST_SERVER_ENV,
// }));
import { encryptEcpayPayload } from "@/lib/ecpay/aes-payload";

export const INVOICE_HASH_KEY = "ejCk326UnaZWKisg";
export const INVOICE_HASH_IV = "q9jcZX8Ib9LM8wYk";

// 完整 serverEnv 形狀：新增必填 env 時只需改這一處，所有發票測試同步
export const TEST_SERVER_ENV = {
  ECPAY_MERCHANT_ID: "3002607",
  ECPAY_HASH_KEY: "test-hash-key",
  ECPAY_HASH_IV: "test-hash-iv",
  ECPAY_PAYMENT_URL: "https://payment-stage.example/Cashier/AioCheckOut/V5",
  ECPAY_INVOICE_MERCHANT_ID: "2000132",
  ECPAY_INVOICE_HASH_KEY: INVOICE_HASH_KEY,
  ECPAY_INVOICE_HASH_IV: INVOICE_HASH_IV,
  ECPAY_INVOICE_URL: "https://einvoice-stage.example",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  SUPABASE_SERVICE_ROLE_KEY: "test",
  UPSTASH_REDIS_REST_URL: "http://localhost",
  UPSTASH_REDIS_REST_TOKEN: "test",
  RESEND_API_KEY: "test",
  ADMIN_EMAIL: "admin@example.com",
  CRON_SECRET: "test-cron-secret",
  ORDER_ACCESS_TOKEN_SECRET: "test-order-access-secret",
};

// ECPay AES-JSON 外層封包（單一出處；transCode 預設 1）
export function encryptedResponse(innerData: unknown, transCode = 1) {
  return {
    MerchantID: "2000132",
    RpHeader: { Timestamp: Math.floor(Date.now() / 1000) },
    TransCode: transCode,
    TransMsg: transCode === 1 ? "" : "傳輸失敗",
    Data:
      transCode === 1
        ? encryptEcpayPayload(innerData, INVOICE_HASH_KEY, INVOICE_HASH_IV)
        : "",
  };
}
