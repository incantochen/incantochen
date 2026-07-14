"use client";

import { useState, useTransition } from "react";
import { AdminNotifyBanner, useAdminNotify } from "@/components/admin-notify";
import {
  VALID_TRANSITIONS,
  STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order/order-status";
import {
  changeStatus,
  shipOrder,
  overrideStatus,
  saveTrackingNo,
} from "./actions";

const ALL_STATUSES: OrderStatus[] = [
  "pending_payment", "paid", "in_production",
  "shipped", "completed", "cancelled", "refunded",
];

export function OrderActions({
  orderId,
  currentStatus,
  currentTrackingNo,
}: {
  orderId: string;
  currentStatus: OrderStatus;
  currentTrackingNo: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const { message, notify } = useAdminNotify();

  // 出貨表單狀態
  const [shipMethod, setShipMethod] = useState<"delivery" | "pickup">("delivery");
  const [trackingInput, setTrackingInput] = useState("");
  const [pickupNote, setPickupNote] = useState("");

  // 修正物流單號
  const [editTracking, setEditTracking] = useState(currentTrackingNo ?? "");

  // Admin Override：目標狀態排除目前狀態——覆寫成同一個狀態不是有意義的操作，
  // 且 adminOverrideStatus 的 CAS 守衛在 to===from 時無法防併發重複寫入稽核
  // 記錄（T92／F-007），列表先排除掉比讓管理者選到再被伺服器擋下更好。
  const overridableStatuses = ALL_STATUSES.filter((s) => s !== currentStatus);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTo, setOverrideTo] = useState<OrderStatus>(
    overridableStatuses[0] ?? currentStatus,
  );
  // overrideTo 只在使用者選取時更新；但 currentStatus 會在成功轉換後（含正常
  // 狀態轉換與上一次 override）隨 revalidatePath 變動，同一個元件實例不會重新
  // mount，overrideTo 不會自動同步。若不改成即時衍生，選單顯示的選項會跟實際
  // 送出的值悄悄不一致（value 指向已被 overridableStatuses 排除掉的舊值）。
  const effectiveOverrideTo = overridableStatuses.includes(overrideTo)
    ? overrideTo
    : (overridableStatuses[0] ?? currentStatus);
  const [overrideReason, setOverrideReason] = useState("");

  const nextStatuses = VALID_TRANSITIONS[currentStatus].filter((s) => s !== "shipped");
  const canShip = VALID_TRANSITIONS[currentStatus].includes("shipped");

  function handleChangeStatus(to: OrderStatus) {
    startTransition(async () => {
      try {
        const result = await changeStatus(orderId, to);
        if (!result.ok) {
          notify(result.error, true);
          return;
        }
        notify(`狀態已更新為「${STATUS_LABELS[to]}」`);
      } catch (e) {
        notify(e instanceof Error ? e.message : "操作失敗", true);
      }
    });
  }

  function handleShip() {
    const tracking =
      shipMethod === "pickup"
        ? `面交${pickupNote ? ` ${pickupNote}` : ""}`
        : trackingInput.trim();

    if (!tracking) {
      notify("請填入物流單號", true);
      return;
    }

    startTransition(async () => {
      try {
        const result = await shipOrder(orderId, tracking);
        if (!result.ok) {
          notify(result.error, true);
          return;
        }
        notify(result.warning ?? "已標記出貨", Boolean(result.warning));
      } catch (e) {
        notify(e instanceof Error ? e.message : "操作失敗", true);
      }
    });
  }

  function handleSaveTracking() {
    startTransition(async () => {
      try {
        await saveTrackingNo(orderId, editTracking.trim());
        notify("物流單號已更新");
      } catch (e) {
        notify(e instanceof Error ? e.message : "操作失敗", true);
      }
    });
  }

  function handleOverride() {
    if (!overrideReason.trim()) {
      notify("請填寫強制改狀態的原因", true);
      return;
    }
    startTransition(async () => {
      try {
        const result = await overrideStatus(
          orderId,
          effectiveOverrideTo,
          overrideReason.trim(),
        );
        if (!result.ok) {
          notify(result.error, true);
          return;
        }
        notify(`已強制改狀態為「${STATUS_LABELS[effectiveOverrideTo]}」`);
        setOverrideReason("");
        setOverrideOpen(false);
      } catch (e) {
        notify(e instanceof Error ? e.message : "操作失敗", true);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* 訊息 */}
      <AdminNotifyBanner message={message} />

      {/* 正常狀態轉換 */}
      {nextStatuses.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">更新狀態</h3>
          <div className="flex flex-wrap gap-2">
            {nextStatuses.map((to) => (
              <button
                key={to}
                onClick={() => handleChangeStatus(to)}
                disabled={isPending}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
              >
                → {STATUS_LABELS[to]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 出貨 */}
      {canShip && (
        <div className="border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">出貨</h3>
          <div className="flex gap-4 mb-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="shipMethod"
                value="delivery"
                checked={shipMethod === "delivery"}
                onChange={() => setShipMethod("delivery")}
              />
              宅配（黑貓）
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="shipMethod"
                value="pickup"
                checked={shipMethod === "pickup"}
                onChange={() => setShipMethod("pickup")}
              />
              面交
            </label>
          </div>

          {shipMethod === "delivery" && (
            <input
              type="text"
              placeholder="黑貓物流單號（12碼）"
              value={trackingInput}
              onChange={(e) => setTrackingInput(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-gray-400 mb-3 block"
            />
          )}
          {shipMethod === "pickup" && (
            <input
              type="text"
              placeholder="備註（選填，如：面交 2026-07-05）"
              value={pickupNote}
              onChange={(e) => setPickupNote(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-gray-400 mb-3 block"
            />
          )}

          <button
            onClick={handleShip}
            disabled={isPending}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            確認出貨
          </button>
        </div>
      )}

      {/* 修正物流單號（已出貨後） */}
      {currentStatus === "shipped" && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">修正物流單號</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={editTracking}
              onChange={(e) => setEditTracking(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
            <button
              onClick={handleSaveTracking}
              disabled={isPending}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              儲存
            </button>
          </div>
        </div>
      )}

      {/* Admin Override */}
      <div className="border border-red-200 rounded-lg">
        <button
          onClick={() => setOverrideOpen((o) => !o)}
          className="w-full px-4 py-3 text-left text-sm font-medium text-red-700 hover:bg-red-50 rounded-lg flex justify-between items-center"
        >
          強制改狀態（Admin Override）
          <span>{overrideOpen ? "▲" : "▼"}</span>
        </button>

        {overrideOpen && (
          <div className="px-4 pb-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">目標狀態</label>
              <select
                value={effectiveOverrideTo}
                onChange={(e) => setOverrideTo(e.target.value as OrderStatus)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {overridableStatuses.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">原因（必填）</label>
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={2}
                placeholder="說明強制改狀態的原因…"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <button
              onClick={handleOverride}
              disabled={isPending || !overrideReason.trim()}
              className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50"
            >
              強制更新
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
