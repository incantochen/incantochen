"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOptionType } from "./actions";
import type { OptionTypeFormValues } from "@/lib/option/schema";
import {
  ALL_APPLIES_TO,
  ALL_INPUT_TYPES,
  APPLIES_TO_LABELS,
  OPTION_INPUT_TYPE_LABELS,
} from "@/lib/option/labels";

const INITIAL: OptionTypeFormValues = {
  code: "",
  name: "",
  applies_to: "all",
  input_type: "select",
};

export function CreateOptionTypeForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof OptionTypeFormValues, string>>
  >({});
  const [values, setValues] = useState<OptionTypeFormValues>(INITIAL);

  function update<K extends keyof OptionTypeFormValues>(
    key: K,
    value: OptionTypeFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createOptionType(values);
      if (!result.ok) {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      router.push(`/admin/options/${result.id}`);
    });
  }

  const inputClass =
    "border border-gray-300 rounded px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-1 focus:ring-gray-400";

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-gray-200 bg-white p-4"
    >
      <h2 className="text-sm font-medium text-gray-900">新增選項類型</h2>
      {error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-800 rounded text-sm">
          {error}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            代碼（建立後不可修改）
          </label>
          <input
            type="text"
            value={values.code}
            onChange={(e) => update("code", e.target.value)}
            placeholder="gem_color"
            className={`${inputClass} font-mono`}
          />
          {fieldErrors.code && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.code}</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">名稱</label>
          <input
            type="text"
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="寶石顏色"
            className={inputClass}
          />
          {fieldErrors.name && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">適用品類</label>
          <select
            value={values.applies_to}
            onChange={(e) =>
              update(
                "applies_to",
                e.target.value as OptionTypeFormValues["applies_to"],
              )
            }
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
            value={values.input_type}
            onChange={(e) =>
              update(
                "input_type",
                e.target.value as OptionTypeFormValues["input_type"],
              )
            }
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

      <button
        type="submit"
        disabled={isPending}
        className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
      >
        {isPending ? "建立中…" : "建立選項類型"}
      </button>
    </form>
  );
}
