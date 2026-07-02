"use client";

import { useState, useTransition } from "react";
import { revealOrderPii } from "./actions";

type FullPii = {
  recipientName: string;
  recipientPhone: string;
  email: string | null;
  shippingAddress: string;
};

export function CustomerInfo({
  orderId,
  maskedName,
  maskedPhone,
  maskedEmail,
  maskedAddress,
  zipCode,
}: {
  orderId: string;
  maskedName: string;
  maskedPhone: string;
  maskedEmail: string;
  maskedAddress: string;
  zipCode: string | null;
}) {
  const [full, setFull] = useState<FullPii | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    setError(null);
    if (revealed) {
      setRevealed(false);
      return;
    }
    if (full) {
      // 已取回過的完整個資只在本頁狀態暫存；重新揭示不再重複記稽核
      setRevealed(true);
      return;
    }
    startTransition(async () => {
      try {
        const data = await revealOrderPii(orderId);
        setFull(data);
        setRevealed(true);
      } catch {
        setError("無法取得完整個資，請稍後再試");
      }
    });
  }

  const show = revealed && full;

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
          客人資訊
        </h2>
        <button
          type="button"
          onClick={handleToggle}
          disabled={isPending}
          className="text-xs px-2.5 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {isPending ? "讀取中…" : revealed ? "隱藏完整個資" : "顯示完整個資"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-gray-500">姓名</dt>
          <dd>{show ? full.recipientName : maskedName}</dd>
        </div>
        <div>
          <dt className="text-gray-500">電話</dt>
          <dd>{show ? full.recipientPhone : maskedPhone}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-gray-500">Email</dt>
          <dd>{show ? (full.email ?? "—") : maskedEmail}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-gray-500">收件地址</dt>
          <dd>
            {zipCode ? `${zipCode} ` : ""}
            {show ? full.shippingAddress : maskedAddress}
          </dd>
        </div>
      </dl>
    </section>
  );
}
