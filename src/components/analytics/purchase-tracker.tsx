"use client";

import { useEffect, useRef } from "react";
import { trackPurchase, type GaItem } from "@/lib/analytics/gtag";

// purchase 轉換事件（T60）：僅在成功頁 order.status === "paid" 分支渲染。
// once-only：以 localStorage 依 orderNo 去重——防手動重整、back-nav、
// 付款輪詢翻 paid 後重掛造成重複計數（GA 的 transaction_id 去重僅
// best-effort，不足以依賴）。localStorage 不可用（隱私模式）時退回
// ref 防護，同一頁面生命週期內仍只送一次。
export function PurchaseTracker({
  orderNo,
  value,
  items,
}: {
  orderNo: string;
  value: number;
  items: GaItem[];
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const key = `ga_purchase:${orderNo}`;
    try {
      if (window.localStorage.getItem(key) !== null) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // localStorage 不可用：仍送事件（漏記比重複計嚴重），靠 ref 擋重跑
    }
    trackPurchase({ transactionId: orderNo, value, items });
  }, [orderNo, value, items]);

  return null;
}
