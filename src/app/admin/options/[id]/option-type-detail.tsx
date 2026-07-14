"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminNotifyBanner, useAdminAction } from "@/components/admin-notify";
import { AdminPill } from "@/components/admin-pill";
import {
  ALL_APPLIES_TO,
  ALL_INPUT_TYPES,
  APPLIES_TO_LABELS,
  OPTION_INPUT_TYPE_LABELS,
  activePillMeta,
  type OptionInputType,
  type OptionAppliesTo,
} from "@/lib/option/labels";
import { SWATCH_HEX_FORMAT } from "@/lib/option/schema";
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
  updatedAt: string;
};

type Props = {
  optionType: {
    id: string;
    name: string;
    applies_to: OptionAppliesTo;
    input_type: string;
    isActive: boolean;
  };
  updatedAt: string;
  values: ValueItem[];
  usedValueIds: string[];
  typeInUse: boolean;
  typeRequiredByAnyProduct: boolean;
};

const inputClass =
  "border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-gray-400";
const smallButtonClass =
  "rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40";
const fieldErrorClass = "mt-1 text-xs text-red-600";

type ActionRunner = ReturnType<typeof useAdminAction>;
type ValueDraft = { label?: string; swatchHex?: string };

// 外殼：notify 訊息、pending 狀態、以及所有「跨欄位/跨列」的可變狀態
// （選項值行內編輯草稿、新增選項值表單）都放在這一層、不被重掛沖掉。
// 只有「型別自身欄位」的表單（TypeBasicInfoSection）用 updatedAt 當 key
// 重掛，範圍窄化到真正需要偵測並發覆蓋的那三個欄位，其餘操作不受影響
// （T12 code-review 修正：舊版整個子樹共用一個 key，儲存型別名稱會連帶
// 清空使用者正在填的新增選項值表單與其他列的未存草稿）。
export function OptionTypeDetail(props: Props) {
  const runner = useAdminAction();
  const { isPending, notify, run: runAction } = runner;

  const [valueDrafts, setValueDrafts] = useState<Record<string, ValueDraft>>(
    {},
  );
  const [valueFieldErrors, setValueFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newCodeError, setNewCodeError] = useState<string | undefined>();

  const usedSet = new Set(props.usedValueIds);
  const activeValueCount = props.values.filter((v) => v.isActive).length;

  function handleCreateValue(e: React.FormEvent) {
    e.preventDefault();
    setNewCodeError(undefined);
    runAction(
      async () => {
        const result = await createOptionValue(props.optionType.id, {
          code: newCode,
          label: newLabel,
          swatch_hex: null,
        });
        if (!result.ok) {
          setNewCodeError(result.fieldErrors?.code);
        }
        return result;
      },
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
    const draft = valueDrafts[value.id];
    const label = draft?.label ?? value.label;
    const swatchRaw = draft?.swatchHex ?? value.swatchHex ?? "";
    setValueFieldErrors((prev) => ({ ...prev, [value.id]: undefined }));
    runAction(
      async () => {
        const result = await updateOptionValue(
          value.id,
          {
            label,
            swatch_hex: swatchRaw.trim() === "" ? null : swatchRaw,
          },
          { updatedAt: value.updatedAt },
        );
        if (!result.ok) {
          setValueFieldErrors((prev) => ({
            ...prev,
            [value.id]: result.fieldErrors?.label ?? result.fieldErrors?.swatch_hex,
          }));
        }
        return result;
      },
      {
        successMsg: "選項值已更新",
        fallbackError: "更新失敗",
        onSuccess: () => {
          setValueDrafts((prev) => {
            const next = { ...prev };
            delete next[value.id];
            return next;
          });
        },
      },
    );
  }

  function handleToggleValueActive(value: ValueItem) {
    const wouldEmptyRequiredGroup =
      value.isActive &&
      activeValueCount <= 1 &&
      props.typeRequiredByAnyProduct;
    if (
      value.isActive &&
      usedSet.has(value.id) &&
      !confirm(
        wouldEmptyRequiredGroup
          ? `「${value.label}」是此必選選項類型目前唯一顯示中的值。隱藏後：` +
              "此選項類型將沒有任何可選擇的值，凡把它列為必選的商品都會永久無法加入購物車，直到重新顯示某個值為止。確定要隱藏嗎？"
          : `「${value.label}」已有商品使用。隱藏後：前台將不再提供此選項值、` +
              "已含此值的購物車將無法結帳。確定要隱藏嗎？",
      )
    ) {
      return;
    }
    runAction(() => setOptionValueActive(value.id, !value.isActive), {
      successMsg: value.isActive ? "已隱藏（前台不再顯示此值）" : "已恢復顯示",
      fallbackError: "切換失敗",
    });
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
      <AdminNotifyBanner message={runner.message} />

      <TypeBasicInfoSection
        key={props.updatedAt}
        optionType={props.optionType}
        updatedAt={props.updatedAt}
        typeInUse={props.typeInUse}
        runner={runner}
      />

      {/* ── 選項值 ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-900">選項值</h2>

        <form
          onSubmit={handleCreateValue}
          className="mt-3 flex flex-wrap items-start gap-2"
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
            {newCodeError && <p className={fieldErrorClass}>{newCodeError}</p>}
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
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50 mt-5"
          >
            新增
          </button>
        </form>

        {props.values.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
            尚無選項值，請從上方新增
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {props.values.map((value, index) => {
              const inUse = usedSet.has(value.id);
              const draft = valueDrafts[value.id];
              const swatchDraft = draft?.swatchHex ?? value.swatchHex ?? "";
              const valuePill = activePillMeta(value.isActive);
              return (
                <li
                  key={value.id}
                  className="rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-32 font-mono text-xs text-gray-500">
                      {value.code}
                    </span>

                    <div>
                      <input
                        type="text"
                        value={draft?.label ?? value.label}
                        onChange={(e) =>
                          setValueDrafts((prev) => ({
                            ...prev,
                            [value.id]: {
                              ...prev[value.id],
                              label: e.target.value,
                            },
                          }))
                        }
                        maxLength={100}
                        disabled={isPending}
                        className={`${inputClass} w-40 flex-none`}
                      />
                      {valueFieldErrors[value.id] && (
                        <p className={fieldErrorClass}>
                          {valueFieldErrors[value.id]}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* 色票預覽圓點：格式正確才上色（格式與 zod/DB 同一出處） */}
                      <span
                        className="inline-block size-5 rounded-full border border-gray-300"
                        style={
                          SWATCH_HEX_FORMAT.test(swatchDraft)
                            ? { backgroundColor: swatchDraft }
                            : undefined
                        }
                      />
                      <input
                        type="text"
                        value={swatchDraft}
                        onChange={(e) =>
                          setValueDrafts((prev) => ({
                            ...prev,
                            [value.id]: {
                              ...prev[value.id],
                              swatchHex: e.target.value,
                            },
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
                      disabled={isPending || valueDrafts[value.id] === undefined}
                      className={smallButtonClass}
                    >
                      儲存
                    </button>

                    <div className="ml-auto flex items-center gap-1">
                      <AdminPill
                        label={valuePill.label}
                        color={valuePill.color}
                      />
                      <button
                        type="button"
                        onClick={() => handleToggleValueActive(value)}
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
                              moveOptionValue(
                                value.id,
                                props.optionType.id,
                                "up",
                              ),
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
                              moveOptionValue(
                                value.id,
                                props.optionType.id,
                                "down",
                              ),
                            { fallbackError: "調整排序失敗" },
                          )
                        }
                        disabled={isPending || index === props.values.length - 1}
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

// 型別自身欄位（名稱／適用品類／輸入形式／顯示狀態／刪除）的獨立區塊，用
// updatedAt 當 key：別的管理員改動此型別任一欄位時，這裡（且只有這裡）會
// 重掛成最新資料，避免顯示已經送出失敗、實際上是舊快照的表單值。
function TypeBasicInfoSection({
  optionType,
  updatedAt,
  typeInUse,
  runner,
}: {
  optionType: Props["optionType"];
  updatedAt: string;
  typeInUse: boolean;
  runner: ActionRunner;
}) {
  const router = useRouter();
  const { isPending, run: runAction } = runner;

  const [typeName, setTypeName] = useState(optionType.name);
  const [typeAppliesTo, setTypeAppliesTo] = useState<OptionAppliesTo>(
    optionType.applies_to,
  );
  const [typeInputType, setTypeInputType] = useState(optionType.input_type);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    applies_to?: string;
    input_type?: string;
  }>({});

  function handleSaveType() {
    setFieldErrors({});
    runAction(
      async () => {
        const result = await updateOptionType(
          optionType.id,
          {
            name: typeName,
            applies_to: typeAppliesTo,
            input_type: typeInputType as OptionInputType,
          },
          { updatedAt },
        );
        if (!result.ok) {
          setFieldErrors(result.fieldErrors ?? {});
        }
        return result;
      },
      { successMsg: "選項類型已更新", fallbackError: "更新失敗" },
    );
  }

  function handleToggleTypeActive() {
    // 隱藏使用中的類別會讓前台配置器整組消失：必選項目沒得選、含此選項的
    // 購物車結帳被拒——不擋（隱藏是刪除的唯一替代），但要求二次確認
    if (
      optionType.isActive &&
      typeInUse &&
      !confirm(
        "此選項類型已有商品使用。隱藏後：前台配置器將不再顯示此選項、" +
          "已含此選項的購物車將無法結帳（必選項目缺少選擇也會擋單）。確定要隱藏嗎？",
      )
    ) {
      return;
    }
    runAction(() => setOptionTypeActive(optionType.id, !optionType.isActive), {
      successMsg: optionType.isActive
        ? "已隱藏（前台不再顯示此選項）"
        : "已恢復顯示",
      fallbackError: "切換失敗",
    });
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

  const typePill = activePillMeta(optionType.isActive);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-900">基本資料</h2>
        <AdminPill label={typePill.label} color={typePill.color} />
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
          {fieldErrors.name && (
            <p className={fieldErrorClass}>{fieldErrors.name}</p>
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">適用品類</label>
          <select
            value={typeAppliesTo}
            onChange={(e) => setTypeAppliesTo(e.target.value as OptionAppliesTo)}
            disabled={isPending}
            className={inputClass}
          >
            {ALL_APPLIES_TO.map((a) => (
              <option key={a} value={a}>
                {APPLIES_TO_LABELS[a]}
              </option>
            ))}
          </select>
          {fieldErrors.applies_to && (
            <p className={fieldErrorClass}>{fieldErrors.applies_to}</p>
          )}
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
          {fieldErrors.input_type && (
            <p className={fieldErrorClass}>{fieldErrors.input_type}</p>
          )}
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
          onClick={handleToggleTypeActive}
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
  );
}
