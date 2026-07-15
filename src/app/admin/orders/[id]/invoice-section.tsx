"use client";

import { AdminNotifyBanner, useAdminAction } from "@/components/admin-notify";
import { AdminPill } from "@/components/admin-pill";
import {
  INVOICE_STATUS_META,
  type InvoiceStatus,
} from "@/lib/order/order-status";
import { issueInvoiceAction } from "./actions";

export function InvoiceSection({
  orderId,
  orderStatus,
  invoiceStatus,
  invoiceNo,
  randomNumber,
  invoiceDate,
}: {
  orderId: string;
  orderStatus: string;
  invoiceStatus: InvoiceStatus;
  invoiceNo: string | null;
  randomNumber: string | null;
  invoiceDate: string | null;
}) {
  const { isPending, message, run: runAction } = useAdminAction();

  function handleIssue() {
    runAction(() => issueInvoiceAction(orderId), {
      successMsg: "發票已開立",
      fallbackError: "開立失敗",
    });
  }

  const pill = INVOICE_STATUS_META[invoiceStatus];
  // 未付款訂單開立必失敗（issueInvoiceForOrder 會擋），按鈕先在前端隱藏
  // 避免管理員白按一次；付款後 webhook 會自動開立，這裡是失敗補開入口
  const canIssue = invoiceStatus === "none" && orderStatus === "paid";

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
        電子發票
      </h2>
      <AdminNotifyBanner message={message} />
      <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-gray-500">狀態</dt>
          <dd className="mt-0.5">
            <AdminPill label={pill.label} color={pill.color} />
          </dd>
        </div>
        {invoiceNo && (
          <div>
            <dt className="text-gray-500">發票號碼</dt>
            <dd className="font-mono">{invoiceNo}</dd>
          </div>
        )}
        {randomNumber && (
          <div>
            <dt className="text-gray-500">隨機碼</dt>
            <dd className="font-mono">{randomNumber}</dd>
          </div>
        )}
        {invoiceDate && (
          <div>
            <dt className="text-gray-500">開立時間</dt>
            {/* ECPay 回傳的 InvoiceDate 已是台北時間的人類可讀字串
                （yyyy-MM-dd HH:mm:ss），直接顯示——經 new Date() 解析會在
                UTC 主機上被當成 UTC 再轉台北，錯 8 小時（且 hydration 不一致） */}
            <dd>{invoiceDate}</dd>
          </div>
        )}
      </dl>
      {canIssue && (
        <button
          type="button"
          onClick={handleIssue}
          disabled={isPending}
          className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
        >
          {isPending ? "開立中…" : "開立發票"}
        </button>
      )}
      {invoiceStatus === "none" && orderStatus !== "paid" && (
        <p className="mt-3 text-xs text-gray-400">
          訂單尚未付款，付款成功後將自動開立發票。
        </p>
      )}
    </section>
  );
}
