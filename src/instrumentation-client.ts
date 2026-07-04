import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
