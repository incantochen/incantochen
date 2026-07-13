import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getImagePublicUrl } from "@/lib/storage/product-images";
import { OptionTypeDetail } from "./option-type-detail";

export default async function AdminOptionTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  // 非 uuid 的網址直接 404，不讓 uuid cast 錯誤變 500
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = createServiceRoleClient();

  // type＋值列表一次 embedded 查詢；sort_order 加 id 當第二排序鍵，順序完全確定
  const [
    { data: optionType, error: typeError },
    { count: usageCount, error: usageError },
  ] = await Promise.all([
    supabase
      .from("option_type")
      .select(
        `id, code, name, applies_to, input_type, is_active, updated_at,
           option_value(id, code, label, swatch_hex, image_path, is_active, sort_order)`,
      )
      .eq("id", id)
      .order("sort_order", { ascending: true, referencedTable: "option_value" })
      .order("id", { ascending: true, referencedTable: "option_value" })
      .maybeSingle(),
    supabase
      .from("product_option")
      .select("id", { count: "exact", head: true })
      .eq("option_type_id", id),
  ]);

  if (typeError) {
    throw new Error(`載入選項類型失敗：${typeError.message}`);
  }
  if (usageError) {
    throw new Error(`載入選項類型使用狀態失敗：${usageError.message}`);
  }
  if (!optionType) notFound();

  // 值層級的使用狀態（product_option_value RESTRICT）：使用中的值禁刪
  const valueIds = optionType.option_value.map((v) => v.id);
  let usedValueIds: string[] = [];
  if (valueIds.length > 0) {
    const { data: usedRows, error: usedError } = await supabase
      .from("product_option_value")
      .select("option_value_id")
      .in("option_value_id", valueIds);
    if (usedError) {
      throw new Error(`載入選項值使用狀態失敗：${usedError.message}`);
    }
    usedValueIds = [...new Set(usedRows.map((r) => r.option_value_id))];
  }

  // 公開 URL 在伺服器端組好再下傳（同 T11 圖片管理頁慣例）
  const values = optionType.option_value.map((v) => ({
    id: v.id,
    code: v.code,
    label: v.label,
    swatchHex: v.swatch_hex,
    imageUrl: v.image_path ? getImagePublicUrl(v.image_path) : null,
    isActive: v.is_active,
  }));

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/options"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 選項管理
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">
          {optionType.name}
        </h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">
          {optionType.code}
        </p>
      </div>

      <OptionTypeDetail
        // updated_at 變了就換 key 強制重新掛載（同商品編輯頁的並發顯示邏輯）
        key={optionType.updated_at}
        optionType={{
          id: optionType.id,
          name: optionType.name,
          applies_to: optionType.applies_to,
          input_type: optionType.input_type,
          isActive: optionType.is_active,
        }}
        values={values}
        usedValueIds={usedValueIds}
        typeInUse={(usageCount ?? 0) > 0}
      />
    </div>
  );
}
