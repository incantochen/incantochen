"use client";

import { useEffect, useRef, useState } from "react";

// admin 端操作結果訊息的單一出處（T11 code review 抽出，原本 order-actions 與
// image-manager 各養一份且已飄移）：error/success 互斥收成單一狀態、4 秒自動
// 消失、新訊息重置計時、unmount 清掉計時器。

export type AdminNotifyMessage = { text: string; isError: boolean };

export function useAdminNotify() {
  const [message, setMessage] = useState<AdminNotifyMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function notify(text: string, isError = false) {
    setMessage({ text, isError });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(null), 4000);
  }

  return { message, notify };
}

export function AdminNotifyBanner({
  message,
}: {
  message: AdminNotifyMessage | null;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={
        message.isError
          ? "rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
          : "rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700"
      }
    >
      {message.text}
    </div>
  );
}
