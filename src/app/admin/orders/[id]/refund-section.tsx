"use client";

import { useState, useTransition } from "react";
import { AdminNotifyBanner, useAdminNotify } from "@/components/admin-notify";
import { AdminPill } from "@/components/admin-pill";
import {
  ADMIN_STATUS_COLORS,
  STATUS_LABELS,
  type InvoiceStatus,
  type OrderStatus,
} from "@/lib/order/order-status";
import { refundOrderAction } from "./actions";

// T47 記錄式退款：實際刷退由管理者先在綠界廠商後台人工完成，這裡只登記
// 結果（翻 payment/orders＋寄退款通知信）。不用 useAdminAction.run——它的
// result 處理不讀 warning，會吞掉「退款成功但通知信寄失敗」的提示；比照
// order-actions.tsx handleShip 用 useAdminNotify＋useTransition 手動處理。

const REFUNDABLE_STATUSES: OrderStatus[] = [
  "paid",
  "in_production",
  "shipped",
  "completed",
];

export function RefundSection({
  orderId,
  orderStatus,
  hasPaidPayment,
  invoiceStatus,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  hasPaidPayment: boolean;
  invoiceStatus: InvoiceStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const { message, notify } = useAdminNotify();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const isRefunded = orderStatus === "refunded";
  const canRefund = hasPaidPayment && REFUNDABLE_STATUSES.includes(orderStatus);

  function handleRefund() {
    startTransition(async () => {
      try {
        const result = await refundOrderAction(orderId, reason.trim());
        if (!result.ok) {
          notify(result.error, true);
          return;
        }
        notify(result.warning ?? "退款已登記", Boolean(result.warning));
        setReason("");
        setConfirmed(false);
      } catch (e) {
        notify(e instanceof Error ? e.message : "操作失敗", true);
      }
    });
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
        退款
      </h2>
      <AdminNotifyBanner message={message} />

      {isRefunded && (
        <div className="mt-2 flex items-center gap-2">
          <AdminPill
            label={STATUS_LABELS.refunded}
            color={ADMIN_STATUS_COLORS.refunded}
          />
          <span className="text-sm text-gray-500">此訂單已完成退款登記。</span>
        </div>
      )}

      {!isRefunded && !canRefund && (
        <p className="mt-2 text-sm text-gray-400">
          {hasPaidPayment
            ? "目前訂單狀態不可退款。"
            : "此訂單無已收款記錄，無法退款。"}
        </p>
      )}

      {!isRefunded && canRefund && (
        <div className="mt-2 space-y-3">
          <p className="text-xs text-gray-500">
            請先於綠界廠商後台完成實際退刷，此處僅登記結果（不可逆）：系統將把
            付款與訂單標記為已退款，並寄送退款通知信給客人。
          </p>
          {invoiceStatus === "issued" && (
            <p className="text-xs text-red-600">
              本訂單已開立發票，退款後須另行處理折讓/作廢（會計流程）。
            </p>
          )}
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              退款原因（必填，僅入內部稽核記錄，不會出現在客人信件）
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="說明退款原因（瑕疵內容／協議退款緣由／綠界退刷單據或日期）…"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <label className="flex items-start gap-2 text-sm cursor-pointer text-gray-700">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            我已於綠界廠商後台完成實際退刷
          </label>
          <button
            onClick={handleRefund}
            disabled={isPending || !confirmed || !reason.trim()}
            className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "登記中…" : "登記退款"}
          </button>
        </div>
      )}
    </section>
  );
}
