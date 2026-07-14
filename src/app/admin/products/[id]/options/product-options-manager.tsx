"use client";

import { useState } from "react";
import { AdminNotifyBanner, useAdminAction } from "@/components/admin-notify";
import { AdminPill } from "@/components/admin-pill";
import { activePillMeta } from "@/lib/option/labels";
import { SWATCH_HEX_FORMAT } from "@/lib/option/schema";
import {
  addProductOption,
  updateProductOptionRequired,
  moveProductOption,
  removeProductOption,
  addProductOptionValue,
  updateProductOptionValuePrice,
  setDefaultProductOptionValue,
  clearDefaultProductOptionValue,
  removeProductOptionValue,
} from "./actions";

type ValueRow = {
  id: string;
  priceDelta: number;
  isDefault: boolean;
  updatedAt: string;
  optionValue: {
    code: string;
    label: string;
    swatchHex: string | null;
    isActive: boolean;
  };
};

type OptionRow = {
  id: string;
  required: boolean;
  updatedAt: string;
  optionType: { id: string; code: string; name: string; isActive: boolean };
  values: ValueRow[];
  availableValues: { id: string; code: string; label: string; isActive: boolean }[];
};

type Props = {
  productId: string;
  options: OptionRow[];
  availableTypes: { id: string; code: string; name: string }[];
};

const inputClass =
  "border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400";
const smallButtonClass =
  "rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40";

export function ProductOptionsManager({
  productId,
  options,
  availableTypes,
}: Props) {
  const { isPending, message, run: runAction } = useAdminAction();

  // 加入選項類型表單
  const [newTypeId, setNewTypeId] = useState("");
  const [newRequired, setNewRequired] = useState(true);

  function handleAddOption() {
    if (!newTypeId) return;
    runAction(() => addProductOption(productId, newTypeId, newRequired), {
      successMsg: "已加入選項類型",
      fallbackError: "加入失敗",
      onSuccess: () => setNewTypeId(""),
    });
  }

  return (
    <div className="space-y-6">
      <AdminNotifyBanner message={message} />

      {/* 加入選項類型 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-medium text-gray-900">加入選項類型</h2>
        {availableTypes.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">
            沒有可加入的選項類型（適用本品類的選項都已加入，或尚未於「選項管理」建立）。
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={newTypeId}
              onChange={(e) => setNewTypeId(e.target.value)}
              disabled={isPending}
              className={inputClass}
            >
              <option value="">選擇選項類型…</option>
              {availableTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}（{t.code}）
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={newRequired}
                onChange={(e) => setNewRequired(e.target.checked)}
                disabled={isPending}
              />
              必選
            </label>
            <button
              type="button"
              onClick={handleAddOption}
              disabled={isPending || !newTypeId}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
            >
              加入
            </button>
          </div>
        )}
      </section>

      {/* 已掛選項列表 */}
      {options.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-400">
          尚未設定任何選項，請從上方加入
        </div>
      ) : (
        options.map((option, index) => (
          <OptionSection
            key={option.id}
            productId={productId}
            option={option}
            index={index}
            total={options.length}
            isPending={isPending}
            runAction={runAction}
          />
        ))
      )}
    </div>
  );
}

function OptionSection({
  productId,
  option,
  index,
  total,
  isPending,
  runAction,
}: {
  productId: string;
  option: OptionRow;
  index: number;
  total: number;
  isPending: boolean;
  runAction: ReturnType<typeof useAdminAction>["run"];
}) {
  // 加入選項值表單（此組內）
  const [newValueId, setNewValueId] = useState("");
  const [newPrice, setNewPrice] = useState("0");
  const [newIsDefault, setNewIsDefault] = useState(false);
  // 加價行內編輯草稿（keyed by pov id；沿用 T12 的 draft 模式，放在本組 state）
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});

  const activeValueCount = option.values.filter(
    (v) => v.optionValue.isActive,
  ).length;
  // 必選 + 沒有任何啟用中的白名單值 → 商品無法加入購物車，醒目警告
  const emptyRequiredWarning = option.required && activeValueCount === 0;

  const typePill = activePillMeta(option.optionType.isActive);

  function handleAddValue() {
    if (!newValueId) return;
    runAction(
      () =>
        addProductOptionValue(option.id, newValueId, newPrice, newIsDefault),
      {
        successMsg: "已加入選項值",
        fallbackError: "加入失敗",
        onSuccess: () => {
          setNewValueId("");
          setNewPrice("0");
          setNewIsDefault(false);
        },
      },
    );
  }

  function handleSavePrice(value: ValueRow) {
    const draft = priceDrafts[value.id];
    if (draft === undefined) return;
    runAction(
      () =>
        updateProductOptionValuePrice(value.id, draft, {
          updatedAt: value.updatedAt,
        }),
      {
        successMsg: "已更新加價",
        fallbackError: "更新失敗",
        onSuccess: () =>
          setPriceDrafts((prev) => {
            const next = { ...prev };
            delete next[value.id];
            return next;
          }),
      },
    );
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      {/* 選項類型標頭 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-900">
          {option.optionType.name}
        </span>
        <span className="font-mono text-xs text-gray-400">
          {option.optionType.code}
        </span>
        {!option.optionType.isActive && (
          <AdminPill {...typePill} />
        )}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={option.required}
            onChange={(e) =>
              runAction(
                () =>
                  updateProductOptionRequired(option.id, e.target.checked, {
                    updatedAt: option.updatedAt,
                  }),
                { fallbackError: "更新必選設定失敗" },
              )
            }
            disabled={isPending}
          />
          必選
        </label>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              runAction(() => moveProductOption(option.id, productId, "up"), {
                fallbackError: "調整排序失敗",
              })
            }
            disabled={isPending || index === 0}
            className={smallButtonClass}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() =>
              runAction(() => moveProductOption(option.id, productId, "down"), {
                fallbackError: "調整排序失敗",
              })
            }
            disabled={isPending || index === total - 1}
            className={smallButtonClass}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                !confirm(
                  `確定要移除選項「${option.optionType.name}」嗎？\n` +
                    "其下所有白名單值設定會一併移除；已把此選項加入購物車的客人結帳時將被要求重新選擇。",
                )
              )
                return;
              runAction(() => removeProductOption(option.id), {
                successMsg: "已移除選項",
                fallbackError: "移除失敗",
              });
            }}
            disabled={isPending}
            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            移除選項
          </button>
        </div>
      </div>

      {option.optionType.isActive === false && (
        <p className="mt-2 text-xs text-amber-700">
          此選項類型已於「選項管理」隱藏，前台配置器不會顯示；恢復顯示後才會生效。
        </p>
      )}

      {emptyRequiredWarning && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠️ 此為必選選項但目前沒有任何「顯示中」的白名單值——商品將無法加入購物車。請加入可選值或改為非必選。
        </p>
      )}

      {/* 白名單值列表 */}
      {option.values.length === 0 ? (
        <p className="mt-3 text-sm text-gray-400">尚未加入任何可選值</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {option.values.map((value) => {
            const priceDraft =
              priceDrafts[value.id] ?? String(value.priceDelta);
            const valuePill = activePillMeta(value.optionValue.isActive);
            return (
              <li
                key={value.id}
                className="flex flex-wrap items-center gap-3 rounded border border-gray-100 bg-gray-50 px-3 py-2"
              >
                {/* 色票圓點（有色碼才顯示） */}
                {value.optionValue.swatchHex &&
                  SWATCH_HEX_FORMAT.test(value.optionValue.swatchHex) && (
                    <span
                      className="inline-block size-4 rounded-full border border-gray-300"
                      style={{ backgroundColor: value.optionValue.swatchHex }}
                    />
                  )}
                <span className="text-sm text-gray-900">
                  {value.optionValue.label}
                </span>
                <span className="font-mono text-xs text-gray-400">
                  {value.optionValue.code}
                </span>
                {!value.optionValue.isActive && <AdminPill {...valuePill} />}

                {/* 加價行內編輯 */}
                <div className="ml-2 flex items-center gap-1">
                  <span className="text-xs text-gray-500">加價 NT$</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={priceDraft}
                    onChange={(e) =>
                      setPriceDrafts((prev) => ({
                        ...prev,
                        [value.id]: e.target.value,
                      }))
                    }
                    disabled={isPending}
                    className={`${inputClass} w-24`}
                  />
                  <button
                    type="button"
                    onClick={() => handleSavePrice(value)}
                    disabled={isPending || priceDrafts[value.id] === undefined}
                    className={smallButtonClass}
                  >
                    儲存
                  </button>
                </div>

                <div className="ml-auto flex items-center gap-1">
                  {value.isDefault ? (
                    <>
                      <span className="rounded bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">
                        預設
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          runAction(
                            () => clearDefaultProductOptionValue(value.id),
                            { fallbackError: "清除預設失敗" },
                          )
                        }
                        disabled={isPending}
                        className={smallButtonClass}
                      >
                        取消預設
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          () => setDefaultProductOptionValue(value.id),
                          { fallbackError: "設定預設失敗" },
                        )
                      }
                      disabled={isPending}
                      className={smallButtonClass}
                    >
                      設為預設
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !confirm(
                          `確定要移除可選值「${value.optionValue.label}」嗎？\n` +
                            "已選此值的購物車結帳時將被要求重新選擇。",
                        )
                      )
                        return;
                      runAction(() => removeProductOptionValue(value.id), {
                        successMsg: "已移除選項值",
                        fallbackError: "移除失敗",
                      });
                    }}
                    disabled={isPending}
                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                  >
                    移除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 加入可選值 */}
      {option.availableValues.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <select
            value={newValueId}
            onChange={(e) => setNewValueId(e.target.value)}
            disabled={isPending}
            className={inputClass}
          >
            <option value="">加入可選值…</option>
            {option.availableValues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
                {v.isActive ? "" : "（已隱藏）"}（{v.code}）
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">加價 NT$</span>
          <input
            type="number"
            min={0}
            step={1}
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            disabled={isPending}
            className={`${inputClass} w-24`}
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={newIsDefault}
              onChange={(e) => setNewIsDefault(e.target.checked)}
              disabled={isPending}
            />
            設為預設
          </label>
          <button
            type="button"
            onClick={handleAddValue}
            disabled={isPending || !newValueId}
            className={smallButtonClass}
          >
            加入
          </button>
        </div>
      )}
    </section>
  );
}
