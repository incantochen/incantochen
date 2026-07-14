import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { formatDateTime } from "@/lib/utils";
import {
  APPLIES_TO_LABELS,
  OPTION_INPUT_TYPE_LABELS,
  activePillMeta,
  type OptionInputType,
} from "@/lib/option/labels";
import { AdminPill } from "@/components/admin-pill";
import { CreateOptionTypeForm } from "./create-option-type-form";

export default async function AdminOptionsPage() {
  await requireAdmin();

  const supabase = createServiceRoleClient();
  const { data: rows, error } = await supabase
    .from("option_type")
    .select(
      "id, code, name, applies_to, input_type, is_active, created_at, option_value(count)",
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`載入選項類型失敗：${error.message}`);
  }

  const types = rows.map((t) => ({
    ...t,
    valueCount: t.option_value[0]?.count ?? 0,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">選項管理</h1>

      <CreateOptionTypeForm />

      {types.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-400">
          尚無選項類型，請從上方新增
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">代碼</th>
                <th className="px-4 py-3 font-medium">名稱</th>
                <th className="px-4 py-3 font-medium">適用品類</th>
                <th className="px-4 py-3 font-medium">輸入形式</th>
                <th className="px-4 py-3 font-medium">顯示狀態</th>
                <th className="px-4 py-3 font-medium text-right">值數量</th>
                <th className="px-4 py-3 font-medium">建立時間</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/admin/options/${t.id}`}
                      className="text-gray-900 hover:underline"
                    >
                      {t.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/options/${t.id}`}
                      className="hover:underline"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {APPLIES_TO_LABELS[t.applies_to]}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {OPTION_INPUT_TYPE_LABELS[
                      t.input_type as OptionInputType
                    ] ?? t.input_type}
                  </td>
                  <td className="px-4 py-3">
                    <AdminPill {...activePillMeta(t.is_active)} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {t.valueCount}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDateTime(t.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
