import "server-only";

type ServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: string;
  ECPAY_MERCHANT_ID: string;
  ECPAY_HASH_KEY: string;
  ECPAY_HASH_IV: string;
  ECPAY_PAYMENT_URL: string;
  // T42：電子發票是 ECPay 獨立帳號家族（einvoice.ecpay.com.tw），與上面的金流
  // MerchantID/HashKey/HashIV 不同組，不可混用
  ECPAY_INVOICE_MERCHANT_ID: string;
  ECPAY_INVOICE_HASH_KEY: string;
  ECPAY_INVOICE_HASH_IV: string;
  ECPAY_INVOICE_URL: string;
  NEXT_PUBLIC_SITE_URL: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  RESEND_API_KEY: string;
  ADMIN_EMAIL: string;
  CRON_SECRET: string;
  ORDER_ACCESS_TOKEN_SECRET: string;
};

function required(key: keyof ServerEnv): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export const serverEnv: ServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  ECPAY_MERCHANT_ID: required("ECPAY_MERCHANT_ID"),
  ECPAY_HASH_KEY: required("ECPAY_HASH_KEY"),
  ECPAY_HASH_IV: required("ECPAY_HASH_IV"),
  ECPAY_PAYMENT_URL: required("ECPAY_PAYMENT_URL"),
  ECPAY_INVOICE_MERCHANT_ID: required("ECPAY_INVOICE_MERCHANT_ID"),
  ECPAY_INVOICE_HASH_KEY: required("ECPAY_INVOICE_HASH_KEY"),
  ECPAY_INVOICE_HASH_IV: required("ECPAY_INVOICE_HASH_IV"),
  ECPAY_INVOICE_URL: required("ECPAY_INVOICE_URL"),
  NEXT_PUBLIC_SITE_URL: required("NEXT_PUBLIC_SITE_URL"),
  UPSTASH_REDIS_REST_URL: required("UPSTASH_REDIS_REST_URL"),
  UPSTASH_REDIS_REST_TOKEN: required("UPSTASH_REDIS_REST_TOKEN"),
  RESEND_API_KEY: required("RESEND_API_KEY"),
  ADMIN_EMAIL: required("ADMIN_EMAIL"),
  CRON_SECRET: required("CRON_SECRET"),
  ORDER_ACCESS_TOKEN_SECRET: required("ORDER_ACCESS_TOKEN_SECRET"),
};
