import "server-only"

type ServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: string
  ECPAY_MERCHANT_ID: string
  ECPAY_HASH_KEY: string
  ECPAY_HASH_IV: string
  ECPAY_PAYMENT_URL: string
  NEXT_PUBLIC_SITE_URL: string
}

function required(key: keyof ServerEnv): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`)
  }
  return value
}

export const serverEnv: ServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  ECPAY_MERCHANT_ID: required("ECPAY_MERCHANT_ID"),
  ECPAY_HASH_KEY: required("ECPAY_HASH_KEY"),
  ECPAY_HASH_IV: required("ECPAY_HASH_IV"),
  ECPAY_PAYMENT_URL: required("ECPAY_PAYMENT_URL"),
  NEXT_PUBLIC_SITE_URL: required("NEXT_PUBLIC_SITE_URL"),
}
