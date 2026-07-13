"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminActionResult } from "@/lib/admin/action-result";
import { AdminNotifyBanner, useAdminNotify } from "@/components/admin-notify";
import { AdminPill } from "@/components/admin-pill";
import {
  ALL_APPLIES_TO,
  ALL_INPUT_TYPES,
  APPLIES_TO_LABELS,
  OPTION_INPUT_TYPE_LABELS,
  type OptionInputType,
  type OptionAppliesTo,
} from "@/lib/option/labels";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  validateImageFile,
} from "@/lib/storage/constants";
import {
  updateOptionType,
  setOptionTypeActive,
  deleteOptionType,
  createOptionValue,
  updateOptionValue,
  setOptionValueActive,
  moveOptionValue,
  deleteOptionValue,
  uploadOptionValueImage,
  removeOptionValueImage,
} from "../actions";

type ValueItem = {
  id: string;
  code: string;
  label: string;
  swatchHex: string | null;
  imageUrl: string | null;
  isActive: boolean;
};

type Props = {
  optionType: {
    id: string;
    name: string;
    applies_to: OptionAppliesTo;
    input_type: string;
    isActive: boolean;
  };
  values: ValueItem[];
  usedValueIds: string[];
  typeInUse: boolean;
};

const inputClass =
  "border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-gray-400";
const smallButtonClass =
  "rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40";

export function OptionTypeDetail({
  optionType,
  values,
  usedValueIds,
  typeInUse,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { message, notify } = useAdminNotify();

  // type 基本資料表單（mount 當下快照；並發異動由 key={updated_at} 換掉 instance）
  const [typeName, setTypeName] = useState(optionType.name);
  const [typeAppliesTo, setTypeAppliesTo] = useState<OptionAppliesTo>(
    optionType.applies_to,
  );
  const [typeInputType, setTypeInputType] = useState(optionType.input_type);

  // 值的行內編輯草稿（沿用 image-manager 的 altDrafts 模式）
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [swatchDrafts, setSwatchDrafts] = useState<Record<string, string>>({});

  // 新增值表單
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const usedSet = new Set(usedValueIds);

  function runAction(
    action: () => Promise<AdminActionResult | { ok: true; id: string }>,
    options: {
      successMsg?: string;
      fallbackError: string;
      onSuccess?: () => void;
    },
  ) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          notify(result.error, true);
          return;
        }
        if (options.successMsg) notify(options.successMsg);
        options.onSuccess?.();
      } catch (e) {
        notify(e instanceof Error ? e.message : options.fallbackError, true);
      }
    });
  }

  function handleSaveType() {
    runAction(
      () =>
        updateOptionType(optionType.id, {
          name: typeName,
          applies_to: typeAppliesTo,
          input_type: typeInputType as OptionInputType,
        }),
      { successMsg: "選項類型已更新", fallbackError: "更新失敗" },
    );
  }

  function handleDeleteType() {
    if (
      !confirm("確定要刪除這個選項類型嗎？其下所有選項值將一併刪除，無法復原。")
    )
      return;
    runAction(() => deleteOptionType(optionType.id), {
      fallbackError: "刪除失敗",
      onSuccess: () => router.push("/admin/options"),
    });
  }

  function handleCreateValue(e: React.FormEvent) {
    e.preventDefault();
    runAction(
      () =>
        createOptionValue(optionType.id, {
          code: newCode,
          label: newLabel,
          swatch_hex: null,
        }),
      {
        successMsg: "選項值已新增",
        fallbackError: "新增失敗",
        onSuccess: () => {
          setNewCode("");
          setNewLabel("");
        },
      },
    );
  }

  function handleSaveValue(value: ValueItem) {
    const label = labelDrafts[value.id] ?? value.label;
    const swatchRaw = swatchDrafts[value.id] ?? value.swatchHex ?? "";
    runAction(
      () =>
        updateOptionValue(value.id, {
          label,
          swatch_hex: swatchRaw.trim() === "" ? null : swatchRaw,
        }),
      {
        successMsg: "選項值已更新",
        fallbackError: "更新失敗",
        onSuccess: () => {
          setLabelDrafts((prev) => {
            const next = { ...prev };
            delete next[value.id];
            return next;
          });
          setSwatchDrafts((prev) => {
            const next = { ...prev };
            delete next[value.id];
            return next;
          });
        },
      },
    );
  }

  function handleDeleteValue(valueId: string) {
    if (!confirm("確定要刪除這個選項值嗎？此操作無法復原。")) return;
    runAction(() => deleteOptionValue(valueId), {
      successMsg: "選項值已刪除",
      fallbackError: "刪除失敗",
    });
  }

  function handleUploadImage(valueId: string, file: File) {
    // client 端先驗給即時回饋；server 端仍會再驗
    const validation = validateImageFile(file.type, file.size);
    if (!validation.ok) {
      notify(validation.error, true);
      return;
    }
    const formData = new FormData();
    formData.set("optionValueId", valueId);
    formData.set("file", file);
    runAction(() => uploadOptionValueImage(formData), {
      successMsg: "選項圖已上傳",
      fallbackError: "上傳失敗",
    });
  }

  return (
    <div className="space-y-6">
      <AdminNotifyBanner message={message} />

      {/* ── 基本資料 ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-900">基本資料</h2>
          <AdminPill
            label={optionType.isActive ? "顯示中" : "已隱藏"}
            color={
              optionType.isActive
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-700"
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">名稱</label>
            <input
              type="text"
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              disabled={isPending}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">適用品類</label>
            <select
              value={typeAppliesTo}
              onChange={(e) =>
                setTypeAppliesTo(e.target.value as OptionAppliesTo)
              }
              disabled={isPending}
              className={inputClass}
            >
              {ALL_APPLIES_TO.map((a) => (
                <option key={a} value={a}>
                  {APPLIES_TO_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">輸入形式</label>
            <select
              value={typeInputType}
              onChange={(e) => setTypeInputType(e.target.value)}
              disabled={isPending}
              className={inputClass}
            >
              {ALL_INPUT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {OPTION_INPUT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveType}
            disabled={isPending}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
          >
            {isPending ? "儲存中…" : "儲存變更"}
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(
                () => setOptionTypeActive(optionType.id, !optionType.isActive),
                {
                  successMsg: optionType.isActive
                    ? "已隱藏（前台不再顯示此選項）"
                    : "已恢復顯示",
                  fallbackError: "切換失敗",
                },
              )
            }
            disabled={isPending}
            className={smallButtonClass}
          >
            {optionType.isActive ? "隱藏" : "顯示"}
          </button>
          <button
            type="button"
            onClick={handleDeleteType}
            disabled={isPending || typeInUse}
            className="ml-auto rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            刪除選項類型
          </button>
        </div>
        {typeInUse && (
          <p className="mt-2 text-right text-xs text-gray-400">
            已有商品使用此選項類型，無法刪除；不需要時請改為隱藏。
          </p>
        )}
      </section>

      {/* ── 選項值 ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-900">選項值</h2>

        <form
          onSubmit={handleCreateValue}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <div className="w-40">
            <label className="block text-xs text-gray-600 mb-1">
              代碼（建立後不可修改）
            </label>
            <input
              type="text"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="emerald"
              disabled={isPending}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="w-48">
            <label className="block text-xs text-gray-600 mb-1">顯示名稱</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="祖母綠"
              disabled={isPending}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
          >
            新增
          </button>
        </form>

        {values.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
            尚無選項值，請從上方新增
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {values.map((value, index) => {
              const inUse = usedSet.has(value.id);
              const swatchDraft =
                swatchDrafts[value.id] ?? value.swatchHex ?? "";
              return (
                <li
                  key={value.id}
                  className="rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-32 font-mono text-xs text-gray-500">
                      {value.code}
                    </span>

                    <input
                      type="text"
                      value={labelDrafts[value.id] ?? value.label}
                      onChange={(e) =>
                        setLabelDrafts((prev) => ({
                          ...prev,
                          [value.id]: e.target.value,
                        }))
                      }
                      maxLength={100}
                      disabled={isPending}
                      className={`${inputClass} w-40 flex-none`}
                    />

                    <div className="flex items-center gap-1.5">
                      {/* 色票預覽圓點：格式正確才上色 */}
                      <span
                        className="inline-block size-5 rounded-full border border-gray-300"
                        style={
                          /^#[0-9A-Fa-f]{6}$/.test(swatchDraft)
                            ? { backgroundColor: swatchDraft }
                            : undefined
                        }
                      />
                      <input
                        type="text"
                        value={swatchDraft}
                        onChange={(e) =>
                          setSwatchDrafts((prev) => ({
                            ...prev,
                            [value.id]: e.target.value,
                          }))
                        }
                        placeholder="#1A6B54"
                        maxLength={7}
                        disabled={isPending}
                        className={`${inputClass} w-24 flex-none font-mono`}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSaveValue(value)}
                      disabled={
                        isPending ||
                        (labelDrafts[value.id] === undefined &&
                          swatchDrafts[value.id] === undefined)
                      }
                      className={smallButtonClass}
                    >
                      儲存
                    </button>

                    <div className="ml-auto flex items-center gap-1">
                      <AdminPill
                        label={value.isActive ? "顯示中" : "已隱藏"}
                        color={
                          value.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-700"
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            () =>
                              setOptionValueActive(value.id, !value.isActive),
                            {
                              successMsg: value.isActive
                                ? "已隱藏（前台不再顯示此值）"
                                : "已恢復顯示",
                              fallbackError: "切換失敗",
                            },
                          )
                        }
                        disabled={isPending}
                        className={smallButtonClass}
                      >
                        {value.isActive ? "隱藏" : "顯示"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            () =>
                              moveOptionValue(value.id, optionType.id, "up"),
                            { fallbackError: "調整排序失敗" },
                          )
                        }
                        disabled={isPending || index === 0}
                        className={smallButtonClass}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            () =>
                              moveOptionValue(value.id, optionType.id, "down"),
                            { fallbackError: "調整排序失敗" },
                          )
                        }
                        disabled={isPending || index === values.length - 1}
                        className={smallButtonClass}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteValue(value.id)}
                        disabled={isPending || inUse}
                        title={inUse ? "已有商品使用，請改為隱藏" : undefined}
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >
                        刪除
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    {value.imageUrl ? (
                      <>
                        <div className="relative size-12 overflow-hidden rounded border border-gray-200 bg-gray-100">
                          <Image
                            src={value.imageUrl}
                            alt={value.label}
                            fill
                            sizes="48px"
                            className="object-cover"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            runAction(() => removeOptionValueImage(value.id), {
                              successMsg: "選項圖已移除",
                              fallbackError: "移除失敗",
                            })
                          }
                          disabled={isPending}
                          className={smallButtonClass}
                        >
                          移除圖片
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">尚無選項圖</span>
                    )}
                    <label className={`${smallButtonClass} cursor-pointer`}>
                      {value.imageUrl ? "更換圖片" : "上傳圖片"}
                      <input
                        type="file"
                        accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
                        disabled={isPending}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          // 立即清空 value：失敗後重選同一個檔案才會再觸發 change
                          e.target.value = "";
                          if (file) handleUploadImage(value.id, file);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {inUse && (
                    <p className="mt-2 text-xs text-gray-400">
                      已有商品使用此選項值，無法刪除；不需要時請改為隱藏。
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
