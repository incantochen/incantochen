"use client";

import { useEffect, useRef } from "react";
import { trackBeginCheckout, type GaItem } from "@/lib/analytics/gtag";

// begin_checkout 漏斗事件（T60）：由結帳頁（server component）掛載，
// mount 時觸發一次。重進結帳頁重送屬正常（GA 對 begin_checkout 本就
// 允許多次），僅以 ref 防同一次 mount 的 effect 重跑（StrictMode）。
export function BeginCheckoutTracker({
  value,
  items,
}: {
  value: number;
  items: GaItem[];
}) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackBeginCheckout({ value, items });
  }, [value, items]);

  return null;
}
