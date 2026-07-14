"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  AdminActionResult,
  AdminFormActionResult,
} from "@/lib/admin/action-result";
import { REFRESH_TO_RETRY_SUFFIX } from "@/lib/concurrency-message";
import { flattenFieldErrors } from "@/lib/zod/flatten-field-errors";
import {
  optionTypeFormSchema,
  optionTypeUpdateSchema,
  optionValueFormSchema,
  optionValueUpdateSchema,
  type OptionTypeFormValues,
  type OptionTypeUpdateValues,
  type OptionValueFormValues,
  type OptionValueUpdateValues,
} from "@/lib/option/schema";
import {
  uploadOptionValueImage as uploadOptionValueImageFile,
  bestEffortDeleteImages,
} from "@/lib/storage/product-images";

export type OptionTypeActionResult = AdminFormActionResult<
  keyof OptionTypeFormValues
>;
export type OptionValueActionResult = AdminFormActionResult<
  keyof OptionValueFormValues
>;

const RACE_MESSAGE = `此項目已被其他管理員異動${REFRESH_TO_RETRY_SUFFIX}`;
// 兩處各自命中（預查、以及預查與刪除之間的 race window 被 DB RESTRICT 擋下）
// 都要回同一句，比照 RACE_MESSAGE 抽成常數避免手改一處另一處沒跟上
const TYPE_IN_USE_MESSAGE = "此選項類型已有商品使用，無法刪除；請改為隱藏";
const VALUE_IN_USE_MESSAGE = "此選項值已有商品使用，無法刪除；請改為隱藏";

function revalidateOptionsPages(typeId?: string) {
  revalidatePath("/admin/options");
  if (typeId) revalidatePath(`/admin/options/${typeId}`);
}

// 23505 衝突時查出既有項目給有脈絡的訊息（比照 products 的
// buildSlugConflictError）；查詢本身失敗（CLAUDE.md §6：查詢失敗≠查無資料）
// 就退回通用訊息——23505 已證明衝突存在，這裡只是補名字
function buildCodeConflictResult(conflictName: string | null): {
  ok: false;
  error: string;
  fieldErrors: { code: string };
} {
  const message = conflictName
    ? `此代碼已被「${conflictName}」使用，請換一個`
    : "此代碼已被使用，請換一個";
  return { ok: false, error: message, fieldErrors: { code: message } };
}

// =============================================================================
// OptionType
// =============================================================================

export async function createOptionType(
  values: OptionTypeFormValues,
): Promise<OptionTypeActionResult> {
  await requireAdmin();

  const parsed = optionTypeFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof OptionTypeFormValues>(parsed.error),
    };
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("option_type")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: conflict, error: lookupError } = await supabase
        .from("option_type")
        .select("name")
        .eq("code", parsed.data.code)
        .maybeSingle();
      return buildCodeConflictResult(
        lookupError ? null : (conflict?.name ?? null),
      );
    }
    return { ok: false, error: "建立選項類型失敗，請稍後再試" };
  }

  revalidateOptionsPages();
  return { ok: true, id: data.id };
}

export async function updateOptionType(
  id: string,
  values: OptionTypeUpdateValues,
  guard: { updatedAt: string },
): Promise<OptionTypeActionResult> {
  await requireAdmin();

  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    return { ok: false, error: "選項類型識別碼格式不正確" };
  }

  // code 建立後鎖定：update schema 根本不含 code 欄位，多傳也會被剝除
  const parsed = optionTypeUpdateSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof OptionTypeFormValues>(parsed.error),
    };
  }

  const supabase = createServiceRoleClient();
  // 條件式 UPDATE 樂觀鎖（CLAUDE.md §6；比照 products 的 updateProduct）：
  // 兩個管理員同時打開同一頁各改不同欄位時，後送出的一方若 updated_at 已
  // 不是自己載入當下讀到的值，直接擋下而非整份覆蓋對方剛存的變更
  const { data: updated, error } = await supabase
    .from("option_type")
    .update(parsed.data)
    .eq("id", idParsed.data)
    .eq("updated_at", guard.updatedAt)
    .select("id");

  if (error) {
    return { ok: false, error: "更新選項類型失敗，請稍後再試" };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: RACE_MESSAGE };
  }

  revalidateOptionsPages(idParsed.data);
  return { ok: true, id: idParsed.data };
}

export async function setOptionTypeActive(
  id: string,
  isActive: boolean,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "選項類型識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();
  const { data: updated, error } = await supabase
    .from("option_type")
    .update({ is_active: isActive })
    .eq("id", parsed.data)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "更新顯示狀態失敗，請稍後再試" };
  }
  if (!updated) {
    return { ok: false, error: "找不到選項類型，可能已被刪除" };
  }

  revalidateOptionsPages(parsed.data);
  return { ok: true };
}

export async function deleteOptionType(id: string): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "選項類型識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();

  // 使用中不可刪（product_option.option_type_id 為 RESTRICT）：預查給友善訊息。
  // 與下面的圖檔路徑清單互不依賴，平行送出省一趟往返
  const [
    { count, error: countError },
    { data: valuesWithImage, error: imageListError },
  ] = await Promise.all([
    supabase
      .from("product_option")
      .select("id", { count: "exact", head: true })
      .eq("option_type_id", parsed.data),
    // 值 CASCADE 刪除但 Storage 選項圖不會跟著刪（0013 附註同型問題）：
    // 先收集圖檔路徑，刪除成功後批次清檔
    supabase
      .from("option_value")
      .select("image_path")
      .eq("option_type_id", parsed.data)
      .not("image_path", "is", null),
  ]);
  if (countError) {
    return { ok: false, error: "檢查選項類型使用狀態失敗，請稍後再試" };
  }
  if (count && count > 0) {
    return { ok: false, error: TYPE_IN_USE_MESSAGE };
  }
  if (imageListError) {
    return { ok: false, error: "檢查選項圖檔失敗，請稍後再試" };
  }

  const { error: deleteError } = await supabase
    .from("option_type")
    .delete()
    .eq("id", parsed.data);

  if (deleteError) {
    // 預查與刪除之間的 race window（別的分頁剛把 type 掛上商品）：
    // DB RESTRICT 擋下時回同一句友善訊息，不讓 500 冒出去
    if (deleteError.code === "23503") {
      return { ok: false, error: TYPE_IN_USE_MESSAGE };
    }
    return { ok: false, error: "刪除選項類型失敗，請稍後再試" };
  }

  // DB 為準：一次批次呼叫刪檔（.remove() 收陣列），失敗僅記錄不擋使用者。
  // 註：路徑快照在 delete 之前讀取，與並發上傳之間有極小 race window，
  // 輸掉的那個檔案成為孤兒——與整段 cascade delete 的原子性相比可接受
  const imagePaths = (valuesWithImage ?? [])
    .map((row) => row.image_path)
    .filter((p): p is string => p !== null);
  await bestEffortDeleteImages(imagePaths, { optionTypeId: parsed.data });

  revalidateOptionsPages();
  return { ok: true };
}

// =============================================================================
// OptionValue
// =============================================================================

export async function createOptionValue(
  typeId: string,
  values: OptionValueFormValues,
): Promise<OptionValueActionResult> {
  await requireAdmin();

  const idParsed = z.string().uuid().safeParse(typeId);
  if (!idParsed.success) {
    return { ok: false, error: "選項類型識別碼格式不正確" };
  }

  const parsed = optionValueFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof OptionValueFormValues>(
        parsed.error,
      ),
    };
  }

  const supabase = createServiceRoleClient();

  // 取號＋插入走 insert_option_value() RPC（migration 0014）：排序搶號在函式內
  // 重試，(option_type_id, code) 衝突則原樣拋 23505 由這裡接
  const { data: newId, error } = await supabase.rpc("insert_option_value", {
    p_option_type_id: idParsed.data,
    p_code: parsed.data.code,
    p_label: parsed.data.label,
    ...(parsed.data.swatch_hex ? { p_swatch_hex: parsed.data.swatch_hex } : {}),
  });

  if (error || !newId) {
    if (error?.code === "23505") {
      const { data: conflict, error: lookupError } = await supabase
        .from("option_value")
        .select("label")
        .eq("option_type_id", idParsed.data)
        .eq("code", parsed.data.code)
        .maybeSingle();
      return buildCodeConflictResult(
        lookupError ? null : (conflict?.label ?? null),
      );
    }
    // 23503：type 剛被別的分頁刪掉
    if (error?.code === "23503") {
      return { ok: false, error: "找不到選項類型，可能已被刪除" };
    }
    return { ok: false, error: "建立選項值失敗，請稍後再試" };
  }

  revalidateOptionsPages(idParsed.data);
  return { ok: true, id: newId };
}

export async function updateOptionValue(
  id: string,
  values: OptionValueUpdateValues,
  guard: { updatedAt: string },
): Promise<OptionValueActionResult> {
  await requireAdmin();

  const idParsed = z.string().uuid().safeParse(id);
  if (!idParsed.success) {
    return { ok: false, error: "選項值識別碼格式不正確" };
  }

  // code 鎖定，update schema 不含 code
  const parsed = optionValueUpdateSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "請確認欄位內容",
      fieldErrors: flattenFieldErrors<keyof OptionValueFormValues>(
        parsed.error,
      ),
    };
  }

  const supabase = createServiceRoleClient();
  // 條件式 UPDATE 樂觀鎖（同 updateOptionType 理由）
  const { data: updated, error } = await supabase
    .from("option_value")
    .update(parsed.data)
    .eq("id", idParsed.data)
    .eq("updated_at", guard.updatedAt)
    .select("option_type_id");

  if (error) {
    return { ok: false, error: "更新選項值失敗，請稍後再試" };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: RACE_MESSAGE };
  }

  revalidateOptionsPages(updated[0]!.option_type_id);
  return { ok: true, id: idParsed.data };
}

export async function setOptionValueActive(
  id: string,
  isActive: boolean,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "選項值識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();
  const { data: updated, error } = await supabase
    .from("option_value")
    .update({ is_active: isActive })
    .eq("id", parsed.data)
    .select("option_type_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "更新顯示狀態失敗，請稍後再試" };
  }
  if (!updated) {
    return { ok: false, error: "找不到選項值，可能已被刪除" };
  }

  revalidateOptionsPages(updated.option_type_id);
  return { ok: true };
}

const moveSchema = z.object({
  valueId: z.string().uuid(),
  optionTypeId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

export async function moveOptionValue(
  valueId: string,
  optionTypeId: string,
  direction: "up" | "down",
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = moveSchema.safeParse({ valueId, optionTypeId, direction });
  if (!parsed.success) {
    return { ok: false, error: "參數格式不正確" };
  }

  const supabase = createServiceRoleClient();

  // 鄰居選取＋交換收進 move_option_value() RPC（migration 0014）：
  // 單一交易＋row lock，並發交錯與部分成功都在 DB 層消滅
  const { data: moveResult, error: moveError } = await supabase.rpc(
    "move_option_value",
    {
      p_option_value_id: parsed.data.valueId,
      p_direction: parsed.data.direction,
    },
  );

  if (moveError) {
    // 含極端情況的鎖競爭（deadlock 中止），重試即可恢復
    return { ok: false, error: "調整排序失敗，請重新整理後再試" };
  }
  if (moveResult === "not_found") {
    return { ok: false, error: "找不到選項值，可能已被刪除" };
  }

  // revalidate 路徑用呼叫端傳入的 optionTypeId（同頁面既有的值，view 本來就
  // 只能看到自己這頁的 type）——比照 T11 moveImage 的做法，省一趟往返查詢，
  // 也不會因為補查失敗／race 而靜默漏 revalidate；'edge' 也 revalidate——
  // 按了方向鍵卻已在最前／最後，通常代表畫面是舊的（別的管理員剛動過排序）
  revalidatePath(`/admin/options/${parsed.data.optionTypeId}`);
  return { ok: true };
}

export async function deleteOptionValue(
  id: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "選項值識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();

  // 使用中不可刪（product_option_value.option_value_id 為 RESTRICT）
  const { count, error: countError } = await supabase
    .from("product_option_value")
    .select("id", { count: "exact", head: true })
    .eq("option_value_id", parsed.data);
  if (countError) {
    return { ok: false, error: "檢查選項值使用狀態失敗，請稍後再試" };
  }
  if (count && count > 0) {
    return { ok: false, error: VALUE_IN_USE_MESSAGE };
  }

  const { data: deleted, error } = await supabase
    .from("option_value")
    .delete()
    .eq("id", parsed.data)
    .select("image_path, option_type_id")
    .maybeSingle();

  if (error) {
    // 預查與刪除之間的 race window：DB RESTRICT 兜底
    if (error.code === "23503") {
      return { ok: false, error: VALUE_IN_USE_MESSAGE };
    }
    return { ok: false, error: "刪除選項值失敗，請稍後再試" };
  }
  if (!deleted) {
    return { ok: false, error: "找不到選項值，可能已被刪除" };
  }

  // DB 為準：image_path 可為 null（與 product_image.storage_path 不同），
  // 有圖才刪；刪檔失敗僅記錄
  if (deleted.image_path) {
    await bestEffortDeleteImages([deleted.image_path], {
      optionValueId: parsed.data,
    });
  }

  revalidateOptionsPages(deleted.option_type_id);
  return { ok: true };
}

// =============================================================================
// OptionValue 圖片
// =============================================================================

const uploadImageSchema = z.object({
  optionValueId: z.string().uuid(),
});

export async function uploadOptionValueImage(
  formData: FormData,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = uploadImageSchema.safeParse({
    optionValueId: formData.get("optionValueId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "選項值識別碼格式不正確" };
  }
  const { optionValueId } = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "請選擇要上傳的圖片" };
  }

  const supabase = createServiceRoleClient();

  // 先讀舊值：①確認選項值存在（擋孤兒目錄）②取得換圖時要刪的舊檔
  // ③當條件式 UPDATE 的 CAS token
  const { data: current, error: currentError } = await supabase
    .from("option_value")
    .select("image_path, option_type_id")
    .eq("id", optionValueId)
    .maybeSingle();
  if (currentError) {
    return { ok: false, error: "查詢選項值失敗，請稍後再試" };
  }
  if (!current) {
    return { ok: false, error: "找不到選項值，可能已被刪除" };
  }
  const oldPath = current.image_path;

  let newPath: string;
  try {
    newPath = await uploadOptionValueImageFile(optionValueId, file);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "圖片上傳失敗，請稍後再試",
    };
  }

  // 條件式 UPDATE（CLAUDE.md §6）：兩個分頁並發換圖時 check-then-act 會讓
  // 一方的檔案變孤兒＋靜默蓋掉對方結果——以剛讀到的舊值當 CAS 條件，
  // 沒命中＝別人剛換過圖，回滾新檔請使用者重整。
  // 註：.eq() 不匹配 null，舊值為 null 時用 .is() 分支
  let updateQuery = supabase
    .from("option_value")
    .update({ image_path: newPath })
    .eq("id", optionValueId);
  updateQuery =
    oldPath === null
      ? updateQuery.is("image_path", null)
      : updateQuery.eq("image_path", oldPath);
  const { data: updated, error: updateError } = await updateQuery
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    // 回滾剛上傳的新檔，避免孤兒檔；回滾失敗僅記錄
    await bestEffortDeleteImages([newPath], { optionValueId });
    if (updateError) {
      return { ok: false, error: "圖片建檔失敗，請稍後再試" };
    }
    return { ok: false, error: RACE_MESSAGE };
  }

  // DB 已指向新檔，舊檔才能刪；失敗僅記錄（孤兒檔，不影響正確性）
  if (oldPath) {
    await bestEffortDeleteImages([oldPath], { optionValueId });
  }

  revalidateOptionsPages(current.option_type_id);
  return { ok: true };
}

export async function removeOptionValueImage(
  id: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "選項值識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();

  const { data: current, error: currentError } = await supabase
    .from("option_value")
    .select("image_path, option_type_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (currentError) {
    return { ok: false, error: "查詢選項值失敗，請稍後再試" };
  }
  if (!current) {
    return { ok: false, error: "找不到選項值，可能已被刪除" };
  }
  if (!current.image_path) {
    return { ok: true }; // 本來就沒圖，冪等成功
  }

  // 條件式 UPDATE：別人剛換了新圖時不能誤刪對方的檔
  const { data: updated, error: updateError } = await supabase
    .from("option_value")
    .update({ image_path: null })
    .eq("id", parsed.data)
    .eq("image_path", current.image_path)
    .select("id")
    .maybeSingle();

  if (updateError) {
    return { ok: false, error: "移除圖片失敗，請稍後再試" };
  }
  if (!updated) {
    return { ok: false, error: RACE_MESSAGE };
  }

  await bestEffortDeleteImages([current.image_path], {
    optionValueId: parsed.data,
  });

  revalidateOptionsPages(current.option_type_id);
  return { ok: true };
}
