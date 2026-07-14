import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CATEGORY_LABELS } from "@/lib/product/category-labels";
import { ProductOptionsManager } from "./product-options-manager";

export default async function AdminProductOptionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  // 非 uuid 的網址直接 404，不讓 uuid cast 錯誤變 500
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = createServiceRoleClient();

  // 商品＋已掛選項＋各選項白名單值一次 embedded 查詢；
  // product_option 依 sort_order+id、白名單值依 option_value.sort_order+id
  // 排序（順序完全確定）。option_type / option_value 不加 !inner——後台要能
  // 看到「已隱藏」的型別/值並標示（跟前台 PDP 的 !inner 過濾刻意不同）。
  const { data: product, error: productError } = await supabase
    .from("product")
    .select(
      `id, name, slug, category,
       product_option (
         id, required, sort_order, updated_at,
         option_type:option_type_id ( id, code, name, applies_to, is_active ),
         product_option_value (
           id, price_delta, is_default, updated_at,
           option_value:option_value_id ( id, code, label, swatch_hex, is_active, sort_order )
         )
       )`,
    )
    .eq("id", id)
    .order("sort_order", { ascending: true, referencedTable: "product_option" })
    .order("id", { ascending: true, referencedTable: "product_option" })
    .maybeSingle();

  if (productError) {
    throw new Error(`載入商品選項失敗：${productError.message}`);
  }
  if (!product) notFound();

  // 可加入的選項類型：applies_to in ('all', category) 且啟用中、且尚未掛到本商品
  const usedTypeIds = new Set(
    product.product_option.map((po) => po.option_type.id),
  );
  const { data: candidateTypes, error: typesError } = await supabase
    .from("option_type")
    .select("id, code, name, applies_to, is_active")
    .in("applies_to", ["all", product.category])
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (typesError) {
    throw new Error(`載入可用選項類型失敗：${typesError.message}`);
  }
  const availableTypes = (candidateTypes ?? [])
    .filter((t) => !usedTypeIds.has(t.id))
    .map((t) => ({ id: t.id, code: t.code, name: t.name }));

  // 各選項類型底下「尚可加入白名單」的值（該型別全部值 減去 已加入的）。
  // 一次撈出所有相關 option_type 的值，再依 product_option 分組扣除。
  const typeIds = product.product_option.map((po) => po.option_type.id);
  const valuesByType = new Map<
    string,
    { id: string; code: string; label: string; isActive: boolean }[]
  >();
  if (typeIds.length > 0) {
    const { data: allValues, error: valuesError } = await supabase
      .from("option_value")
      .select("id, code, label, is_active, option_type_id, sort_order")
      .in("option_type_id", typeIds)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (valuesError) {
      throw new Error(`載入選項值失敗：${valuesError.message}`);
    }
    for (const v of allValues ?? []) {
      const list = valuesByType.get(v.option_type_id) ?? [];
      list.push({
        id: v.id,
        code: v.code,
        label: v.label,
        isActive: v.is_active,
      });
      valuesByType.set(v.option_type_id, list);
    }
  }

  // 攤平成 client 元件要的形狀（伺服器端組好，client 不碰查詢形狀）
  const options = product.product_option.map((po) => {
    const whitelistedValueIds = new Set(
      po.product_option_value.map((pov) => pov.option_value.id),
    );
    const availableValues = (valuesByType.get(po.option_type.id) ?? []).filter(
      (v) => !whitelistedValueIds.has(v.id),
    );
    return {
      id: po.id,
      required: po.required,
      updatedAt: po.updated_at,
      optionType: {
        id: po.option_type.id,
        code: po.option_type.code,
        name: po.option_type.name,
        isActive: po.option_type.is_active,
      },
      values: po.product_option_value
        .slice()
        .sort(
          (a, b) => a.option_value.sort_order - b.option_value.sort_order,
        )
        .map((pov) => ({
          id: pov.id,
          priceDelta: Number(pov.price_delta),
          isDefault: pov.is_default,
          updatedAt: pov.updated_at,
          optionValue: {
            code: pov.option_value.code,
            label: pov.option_value.label,
            swatchHex: pov.option_value.swatch_hex,
            isActive: pov.option_value.is_active,
          },
        })),
      availableValues,
    };
  });

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/products"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 商品管理
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">
          {product.name} — 選項設定
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          <span className="font-mono">{product.slug}</span>
          <span className="mx-2 text-gray-300">·</span>
          {CATEGORY_LABELS[product.category]}
        </p>
      </div>

      <ProductOptionsManager
        productId={product.id}
        options={options}
        availableTypes={availableTypes}
      />
    </div>
  );
}
