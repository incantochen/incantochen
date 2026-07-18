"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PG_UNIQUE_VIOLATION } from "@/lib/supabase/postgres-error-codes";
import type {
  AdminActionResult,
  AdminFormActionResult,
} from "@/lib/admin/action-result";
import { REFRESH_TO_RETRY_SUFFIX } from "@/lib/concurrency-message";
import { flattenFieldErrors } from "@/lib/zod/flatten-field-errors";
import {
  addProductOptionSchema,
  addProductOptionValueSchema,
  priceDeltaSchema,
  type AddProductOptionValues,
  type AddProductOptionValueValues,
} from "@/lib/product/product-option-schema";

type ServiceRole = ReturnType<typeof createServiceRoleClient>;

export type ProductOptionActionResult = AdminFormActionResult<
  keyof AddProductOptionValues
>;
export type ProductOptionValueActionResult = AdminFormActionResult<
  keyof AddProductOptionValueValues
>;

const RACE_MESSAGE = `此項目已被其他管理員異動${REFRESH_TO_RETRY_SUFFIX}`;

// 選項對應改動同時影響：後台設定頁、PDP 配置器、目錄卡片「起」價與 swatch。
// 需要商品的 slug/category 才能 revalidate 前台兩條路徑——這支查一次共用。
// §6：查詢失敗要跟查無資料分開——失敗時記錄後仍 revalidate admin 頁（至少
// 後台看得到最新），只是前台兩條路徑這次跳過（下次成功操作會補上），不靜默
// 假裝成功。
async function revalidateForProduct(
  supabase: ServiceRole,
  productId: string,
): Promise<void> {
  revalidatePath(`/admin/products/${productId}/options`);
  const { data: product, error } = await supabase
    .from("product")
    .select("slug, category")
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    console.error("revalidateForProduct 查詢商品失敗", error);
    return;
  }
  if (product) {
    revalidatePath(`/products/${product.slug}`);
    revalidatePath(`/collections/${product.category}`);
  }
}

// pov 層操作只拿得到 product_option_id：用一次 embedded 查詢同時取 product_id
// （組 admin 路徑）與 product.slug/category（組前台路徑），省掉「先查 product_id
// 再查 product」兩趟往返。error 明確檢查（§6）。
async function revalidateForProductOption(
  supabase: ServiceRole,
  productOptionId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("product_option")
    .select("product_id, product:product_id ( slug, category )")
    .eq("id", productOptionId)
    .maybeSingle();
  if (error) {
    console.error("revalidateForProductOption 查詢失敗", error);
    return;
  }
  if (!data) return;
  revalidatePath(`/admin/products/${data.product_id}/options`);
  if (data.product) {
    revalidatePath(`/products/${data.product.slug}`);
    revalidatePath(`/collections/${data.product.category}`);
  }
}

// =============================================================================
// ProductOption（層2：此款套用哪些選項類型）
// =============================================================================

export async function addProductOption(
  productId: string,
  optionTypeId: string,
  required: boolean,
): Promise<ProductOptionActionResult> {
  await requireAdmin();

  const parsed = addProductOptionSchema.safeParse({
    productId,
    optionTypeId,
    required,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof AddProductOptionValues>(
        parsed.error,
      ),
    };
  }

  const supabase = createServiceRoleClient();

  // 層1 規則（data-model §4.1 三層控制，伺服器端強制，不信任 UI 過濾）：
  // 只能掛 applies_to in ('all', 商品品類) 的選項類型；且必須是啟用中的。
  // 一次查回商品品類與選項類型的 applies_to/啟用狀態做比對。
  const [{ data: product, error: productError }, { data: optionType, error: typeError }] =
    await Promise.all([
      supabase
        .from("product")
        .select("category")
        .eq("id", parsed.data.productId)
        .maybeSingle(),
      supabase
        .from("option_type")
        .select("applies_to, is_active")
        .eq("id", parsed.data.optionTypeId)
        .maybeSingle(),
    ]);
  if (productError || typeError) {
    return { ok: false, error: "查詢商品或選項類型失敗，請稍後再試" };
  }
  if (!product) {
    return { ok: false, error: "找不到商品" };
  }
  if (!optionType) {
    return {
      ok: false,
      error: "找不到選項類型",
      fieldErrors: { optionTypeId: "找不到選項類型" },
    };
  }
  if (!optionType.is_active) {
    return {
      ok: false,
      error: "此選項類型已隱藏，請先於選項管理恢復顯示再加入",
      fieldErrors: { optionTypeId: "此選項類型已隱藏" },
    };
  }
  if (
    optionType.applies_to !== "all" &&
    optionType.applies_to !== product.category
  ) {
    return {
      ok: false,
      error: "此選項類型不適用於本商品品類",
      fieldErrors: { optionTypeId: "不適用於本商品品類" },
    };
  }

  // 取號＋插入走 insert_product_option() RPC（migration 0015）：排序搶號在函式內
  // 重試，(product_id, option_type_id) 重複則原樣拋 23505 由這裡接
  const { data: newId, error } = await supabase.rpc("insert_product_option", {
    p_product_id: parsed.data.productId,
    p_option_type_id: parsed.data.optionTypeId,
    p_required: parsed.data.required,
  });

  if (error || !newId) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "此選項類型已加入過",
        fieldErrors: { optionTypeId: "此選項類型已加入過" },
      };
    }
    // 23503：option_type 剛被別的分頁刪掉（RESTRICT 方向相反，這裡是插入端
    // FK 找不到父列）
    if (error?.code === "23503") {
      return { ok: false, error: "找不到選項類型，可能已被刪除" };
    }
    return { ok: false, error: "加入選項類型失敗，請稍後再試" };
  }

  await revalidateForProduct(supabase, parsed.data.productId);
  return { ok: true, id: newId };
}

export async function updateProductOptionRequired(
  id: string,
  required: boolean,
  guard: { updatedAt: string },
): Promise<AdminActionResult> {
  await requireAdmin();

  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    return { ok: false, error: "識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();
  // 條件式 UPDATE 樂觀鎖（CLAUDE.md §6；比照 products/options 的 CAS）
  const { data: updated, error } = await supabase
    .from("product_option")
    .update({ required })
    .eq("id", idParsed.data)
    .eq("updated_at", guard.updatedAt)
    .select("product_id");

  if (error) {
    return { ok: false, error: "更新必選設定失敗，請稍後再試" };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: RACE_MESSAGE };
  }

  await revalidateForProduct(supabase, updated[0]!.product_id);
  return { ok: true };
}

export async function moveProductOption(
  id: string,
  productId: string,
  direction: "up" | "down",
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z
    .object({
      id: z.string().uuid(),
      productId: z.string().uuid(),
      direction: z.enum(["up", "down"]),
    })
    .safeParse({ id, productId, direction });
  if (!parsed.success) {
    return { ok: false, error: "參數格式不正確" };
  }

  const supabase = createServiceRoleClient();

  // 鄰居選取＋交換收進 move_product_option() RPC（migration 0015）：
  // 單一交易＋row lock，並發交錯與部分成功都在 DB 層消滅
  const { data: moveResult, error: moveError } = await supabase.rpc(
    "move_product_option",
    { p_product_option_id: parsed.data.id, p_direction: parsed.data.direction },
  );

  if (moveError) {
    return { ok: false, error: "調整排序失敗，請重新整理後再試" };
  }
  if (moveResult === "not_found") {
    return { ok: false, error: "找不到選項，可能已被移除" };
  }
  // revalidate 用呼叫端傳入的 productId（比照 T11/T12 修正後模式，省一趟查詢、
  // 不因補查失敗靜默漏 revalidate）；'edge' 也 revalidate（畫面可能是舊的）
  await revalidateForProduct(supabase, parsed.data.productId);
  return { ok: true };
}

export async function removeProductOption(
  id: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();
  // product_option 對 product 是 CASCADE 端、對 option_type 是 RESTRICT 端——
  // 刪 product_option 本身一律可行（連帶 CASCADE 清掉其 product_option_value），
  // 不會被 RESTRICT 擋。delete ... returning product_id 供 revalidate。
  const { data: deleted, error } = await supabase
    .from("product_option")
    .delete()
    .eq("id", parsed.data)
    .select("product_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "移除選項失敗，請稍後再試" };
  }
  if (!deleted) {
    return { ok: false, error: "找不到選項，可能已被移除" };
  }

  await revalidateForProduct(supabase, deleted.product_id);
  return { ok: true };
}

// =============================================================================
// ProductOptionValue（層3：此款此值的白名單＋加價＋預設）
// =============================================================================

export async function addProductOptionValue(
  productOptionId: string,
  optionValueId: string,
  priceDelta: unknown,
  isDefault: boolean,
): Promise<ProductOptionValueActionResult> {
  await requireAdmin();

  const parsed = addProductOptionValueSchema.safeParse({
    productOptionId,
    optionValueId,
    priceDelta,
    isDefault,
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof AddProductOptionValueValues>(
        parsed.error,
      ),
    };
  }

  const supabase = createServiceRoleClient();

  // 防跨型別塞值：option_value 必須屬於此 product_option 綁定的 option_type。
  // 一次查回 product_option 的 option_type_id 與 option_value 的 option_type_id
  // 做比對。
  const [{ data: po, error: poError }, { data: ov, error: ovError }] =
    await Promise.all([
      supabase
        .from("product_option")
        .select("option_type_id, product_id")
        .eq("id", parsed.data.productOptionId)
        .maybeSingle(),
      supabase
        .from("option_value")
        .select("option_type_id, is_active")
        .eq("id", parsed.data.optionValueId)
        .maybeSingle(),
    ]);
  if (poError || ovError) {
    return { ok: false, error: "查詢選項資料失敗，請稍後再試" };
  }
  if (!po) {
    return { ok: false, error: "找不到選項，可能已被移除" };
  }
  if (!ov) {
    return {
      ok: false,
      error: "找不到選項值",
      fieldErrors: { optionValueId: "找不到選項值" },
    };
  }
  if (ov.option_type_id !== po.option_type_id) {
    return {
      ok: false,
      error: "此選項值不屬於這個選項類型",
      fieldErrors: { optionValueId: "不屬於這個選項類型" },
    };
  }
  // 隱藏的值不能同時設為預設（同 setDefault 的理由：前台 !inner 濾掉隱藏值會
  // fallback，導致預設與前台呈現分歧）。允許加入白名單（可預先設定），但擋預設。
  if (parsed.data.isDefault && !ov.is_active) {
    return {
      ok: false,
      error: "已隱藏的選項值不能設為預設，請先恢復顯示或改加入後再設定",
      fieldErrors: { optionValueId: "已隱藏的值不能設為預設" },
    };
  }

  // 先以 is_default=false 插入（預設切換一律走 set_default RPC 單一出口，
  // 避免兩條路徑各自維護「同組至多一個預設」）
  const { data: inserted, error } = await supabase
    .from("product_option_value")
    .insert({
      product_option_id: parsed.data.productOptionId,
      option_value_id: parsed.data.optionValueId,
      price_delta: parsed.data.priceDelta,
      is_default: false,
    })
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        error: "此選項值已加入白名單",
        fieldErrors: { optionValueId: "此選項值已加入白名單" },
      };
    }
    return { ok: false, error: "加入選項值失敗，請稍後再試" };
  }

  if (parsed.data.isDefault) {
    const { error: defaultError } = await supabase.rpc(
      "set_default_product_option_value",
      { p_pov_id: inserted.id },
    );
    // 設預設失敗不致命：值已加入，只是沒設成預設；記在錯誤訊息讓管理員重試
    if (defaultError) {
      await revalidateForProduct(supabase, po.product_id);
      return {
        ok: false,
        error: "選項值已加入，但設為預設失敗，請於列表重新設定預設",
      };
    }
  }

  await revalidateForProduct(supabase, po.product_id);
  return { ok: true, id: inserted.id };
}

export async function updateProductOptionValuePrice(
  id: string,
  priceDelta: unknown,
  guard: { updatedAt: string },
): Promise<AdminActionResult> {
  await requireAdmin();

  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    return { ok: false, error: "識別碼格式不正確" };
  }
  const priceParsed = priceDeltaSchema.safeParse(priceDelta);
  if (!priceParsed.success) {
    return {
      ok: false,
      error: priceParsed.error.issues[0]?.message ?? "加價金額格式不正確",
    };
  }

  const supabase = createServiceRoleClient();
  const { data: updated, error } = await supabase
    .from("product_option_value")
    .update({ price_delta: priceParsed.data })
    .eq("id", idParsed.data)
    .eq("updated_at", guard.updatedAt)
    .select("product_option_id");

  if (error) {
    return { ok: false, error: "更新加價失敗，請稍後再試" };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: RACE_MESSAGE };
  }

  await revalidateForProductOption(supabase, updated[0]!.product_option_id);
  return { ok: true };
}

export async function setDefaultProductOptionValue(
  id: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();

  // 先取 product_option_id＋所指 option_value 的 is_active：既確認 pov 存在，
  // 也擋「把已隱藏的值設為預設」——前台 PDP/目錄用 !inner 濾掉隱藏值，會 fallback
  // 到第一個顯示中的值，導致後台設定的預設與前台實際呈現不一致（無聲分歧）。
  const { data: pov, error: povError } = await supabase
    .from("product_option_value")
    .select("product_option_id, option_value:option_value_id ( is_active )")
    .eq("id", parsed.data)
    .maybeSingle();
  if (povError) {
    return { ok: false, error: "查詢選項值失敗，請稍後再試" };
  }
  if (!pov) {
    return { ok: false, error: "找不到選項值，可能已被移除" };
  }
  if (!pov.option_value.is_active) {
    return {
      ok: false,
      error:
        "此選項值目前為隱藏狀態，設為預設也不會顯示於前台；請先於「選項管理」恢復顯示再設為預設",
    };
  }

  // 原子切換：set_default_product_option_value RPC 把整組 is_default 一次算成
  // (id = 目標)，回傳受影響列數（0＝pov 剛被刪，與上面查詢間的 race window）
  const { data: affected, error } = await supabase.rpc(
    "set_default_product_option_value",
    { p_pov_id: parsed.data },
  );
  if (error) {
    return { ok: false, error: "設定預設失敗，請稍後再試" };
  }
  if (!affected || affected === 0) {
    return { ok: false, error: "找不到選項值，可能已被移除" };
  }

  await revalidateForProductOption(supabase, pov.product_option_id);
  return { ok: true };
}

export async function clearDefaultProductOptionValue(
  id: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();
  // 清除單一列的預設（單列 update，非原子切換範疇——只影響自己）
  const { data: updated, error } = await supabase
    .from("product_option_value")
    .update({ is_default: false })
    .eq("id", parsed.data)
    .select("product_option_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "清除預設失敗，請稍後再試" };
  }
  if (!updated) {
    return { ok: false, error: "找不到選項值，可能已被移除" };
  }

  await revalidateForProductOption(supabase, updated.product_option_id);
  return { ok: true };
}

export async function removeProductOptionValue(
  id: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();
  // product_option_value 對 product_option 是 CASCADE 端、對 option_value 是
  // RESTRICT 端——刪 pov 本身一律可行（RESTRICT 保護的是 option_value 那端）。
  const { data: deleted, error } = await supabase
    .from("product_option_value")
    .delete()
    .eq("id", parsed.data)
    .select("product_option_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "移除選項值失敗，請稍後再試" };
  }
  if (!deleted) {
    return { ok: false, error: "找不到選項值，可能已被移除" };
  }

  await revalidateForProductOption(supabase, deleted.product_option_id);
  return { ok: true };
}
