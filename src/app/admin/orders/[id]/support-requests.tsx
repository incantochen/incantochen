"use client";

import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/utils";
import {
  REQUEST_TYPE_LABELS,
  SUPPORT_STATUS_LABELS,
  type SupportRequestStatus,
  type SupportRequestType,
} from "@/lib/support/support-request";
import {
  updateSupportRequestStatus,
  createSupportCaseByAdmin,
} from "./actions";

type SupportRequestRow = {
  id: string;
  request_type: string;
  description: string;
  status: string;
  created_at: string;
};

const STATUS_BUTTONS: SupportRequestStatus[] = [
  "in_progress",
  "completed",
  "rejected",
];

export function SupportRequests({
  orderId,
  requests,
}: {
  orderId: string;
  requests: SupportRequestRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newType, setNewType] = useState<SupportRequestType>("return_defect");
  const [newDescription, setNewDescription] = useState("");

  function handleStatusChange(requestId: string, status: SupportRequestStatus) {
    setError(null);
    startTransition(async () => {
      try {
        await updateSupportRequestStatus(requestId, status);
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失敗");
      }
    });
  }

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        await createSupportCaseByAdmin(orderId, {
          requestType: newType,
          description: newDescription,
        });
        setNewDescription("");
        setAddOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "建立失敗");
      }
    });
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
        售後申請
      </h2>

      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

      {requests.length === 0 ? (
        <p className="text-sm text-gray-400 mb-4">尚無售後申請</p>
      ) : (
        <ul className="space-y-3 mb-4">
          {requests.map((r) => (
            <li key={r.id} className="border border-gray-100 rounded p-3">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm font-medium text-gray-800">
                  {REQUEST_TYPE_LABELS[r.request_type as SupportRequestType]}
                </span>
                <span className="text-xs text-gray-400">
                  {formatDateTime(r.created_at)}
                </span>
              </div>
              <p className="text-sm text-gray-600 mb-3 whitespace-pre-wrap">
                {r.description}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-500 mr-1">
                  目前：
                  {SUPPORT_STATUS_LABELS[r.status as SupportRequestStatus]}
                </span>
                {STATUS_BUTTONS.map((status) => (
                  <button
                    key={status}
                    onClick={() => handleStatusChange(r.id, status)}
                    disabled={isPending}
                    className="px-2.5 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    {SUPPORT_STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border border-gray-200 rounded-lg">
        <button
          onClick={() => setAddOpen((o) => !o)}
          className="w-full px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg flex justify-between items-center"
        >
          手動新增售服案件
          <span>{addOpen ? "▲" : "▼"}</span>
        </button>

        {addOpen && (
          <div className="px-4 pb-4 space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">類型</label>
              <select
                value={newType}
                onChange={(e) =>
                  setNewType(e.target.value as SupportRequestType)
                }
                className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                <option value="return_defect">退貨/瑕疵</option>
                <option value="repair_maintenance">維修/保養</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">說明</label>
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={3}
                placeholder="登錄客人透過 email/電話提出的案件內容…"
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={isPending || newDescription.trim().length < 10}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
            >
              建立案件
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
