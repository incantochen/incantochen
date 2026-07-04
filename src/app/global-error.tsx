"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="zh-TW">
      <body>
        <div style={{ padding: "4rem 1.5rem", textAlign: "center" }}>
          <p>發生未預期的錯誤，請重新整理頁面。</p>
        </div>
      </body>
    </html>
  );
}
