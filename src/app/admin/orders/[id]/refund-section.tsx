"use client";

import { useState, useTransition } from "react";
import { AdminNotifyBanner, useAdminNotify } from "@/components/admin-notify";
import { AdminPill } from "@/components/admin-pill";
import {
  ADMIN_STATUS_COLORS,
  STATUS_LABELS,
  VALID_TRANSITIONS,
  type InvoiceStatus,
  type OrderStatus,
} from "@/lib/order/order-status";
import { refundOrderAction } from "./actions";

// T47 記錄式退款：實際刷退由管理者先在綠界廠商後台人工完成，這裡只登記
// 結果（翻 payment/orders＋寄退款通知信）。不用 useAdminAction.run——它的
// result 處理不讀 warning，會吞掉「退款成功但通知信寄失敗」的提示；比照
// order-actions.tsx handleShip 用 useAdminNotify＋useTransition 手動處理。

export function RefundSection({
  orderId,
  orderStatus,
  hasPaidPayment,
  paymentQueryFailed,
  invoiceStatus,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  // 嚴格語意：findPaidPayment 查到 status='paid' 的 payment（已退款訂單的
  // payment 已翻 refunded，此值為 false——除非 Admin Override 改了狀態而
  // payment 沒翻，見 needsPaymentRepair）。
  hasPaidPayment: boolean;
  // page.tsx 的 findPaidPayment 查詢失敗（DB 暫時性故障）：只降級退款區塊
  // （fail-closed 隱藏表單），不 500 整頁。與 hasPaidPayment=false 區分——後者
  // 是「確定沒有 paid」，前者是「查不到、狀態不明」，不可誤當可退款或已退款。
  paymentQueryFailed: boolean;
  invoiceStatus: InvoiceStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const { message, notify } = useAdminNotify();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const isRefunded = orderStatus === "refunded";
  // 「可退款狀態」直接由狀態機推導（比照 order-actions 的 canShip），不另抄
  // 清單——VALID_TRANSITIONS 改動時這裡自動跟上。
  const canRefund =
    hasPaidPayment && VALID_TRANSITIONS[orderStatus].includes("refunded");
  // 訂單已 refunded 但 payment 還掛 paid＝Admin Override 逃生口留下的半套
  // 狀態（Override 不翻 payment、不寄信）。提供補登記入口：refundOrder 對
  // 已 refunded 訂單冪等重入，只補翻 payment＋補寄通知信。
  const needsPaymentRepair = isRefunded && hasPaidPayment;
  // 查詢失敗時只降級退款區塊：既不顯示表單（無法確認可退款）、也不誤顯示
  // 「查無收款」，明確提示重整。優先於下方所有分支。
  const paymentUnknown = paymentQueryFailed;

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

  const showForm = canRefund || needsPaymentRepair;

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
        退款
      </h2>
      <AdminNotifyBanner message={message} />

      {/* 查詢失敗優先：不誤顯示「查無收款」或「已完成退款」，明確提示重整。 */}
      {paymentUnknown && (
        <p className="mt-2 text-sm text-red-600">
          付款記錄查詢失敗（資料庫暫時性故障），無法在此登記退款。請重新整理頁面再試；訂單其餘操作不受影響。
        </p>
      )}

      {isRefunded && (
        <div className="mt-2 flex items-center gap-2">
          <AdminPill
            label={STATUS_LABELS.refunded}
            color={ADMIN_STATUS_COLORS.refunded}
          />
          {!paymentUnknown && (
            <span className="text-sm text-gray-500">
              {needsPaymentRepair
                ? "訂單已標記退款，但付款記錄尚未同步。"
                : "此訂單已完成退款登記。"}
            </span>
          )}
        </div>
      )}

      {!isRefunded && !showForm && !paymentUnknown && (
        <p className="mt-2 text-sm text-gray-400">
          {hasPaidPayment
            ? "目前訂單狀態不可退款。"
            : "查無已收款的付款記錄，無法在此登記退款（若訂單顯示已付款，可能是對帳同步中，請隔日再試或查 ops-runbook §1.1）。"}
        </p>
      )}

      {showForm && (
        <div className="mt-2 space-y-3">
          {needsPaymentRepair ? (
            <p className="text-xs text-red-600">
              此訂單狀態為已退款（可能經 Admin
              Override），但付款記錄仍為已付款、退款通知信可能未寄出。請確認已於綠界後台完成退刷後補登記，系統將同步付款記錄並補寄通知信。
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              請先於綠界廠商後台完成實際退刷，此處僅登記結果（不可逆）：系統將把
              付款與訂單標記為已退款，並寄送退款通知信給客人。
            </p>
          )}
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
            {isPending
              ? "登記中…"
              : needsPaymentRepair
                ? "補登記退款"
                : "登記退款"}
          </button>
        </div>
      )}
    </section>
  );
}
