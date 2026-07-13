"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  uploadProductImage,
  deleteProductImageFile,
} from "@/lib/storage/product-images";

export type AdminActionResult = { ok: true } | { ok: false; error: string };

const uploadSchema = z.object({
  productId: z.string().uuid(),
});

const altSchema = z.object({
  imageId: z.string().uuid(),
  alt: z.string().trim().max(200, "替代文字不可超過 200 字"),
});

const moveSchema = z.object({
  imageId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

function revalidateImagePages(productId: string) {
  revalidatePath(`/admin/products/${productId}/images`);
  revalidatePath("/admin/products");
}

export async function uploadImage(
  formData: FormData,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = uploadSchema.safeParse({
    productId: formData.get("productId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "商品識別碼格式不正確" };
  }
  const { productId } = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "請選擇要上傳的圖片" };
  }

  const supabase = createServiceRoleClient();

  // 先確認商品存在（也擋掉對不存在 id 亂丟檔案產生的孤兒目錄）
  const { data: product, error: productError } = await supabase
    .from("product")
    .select("id")
    .eq("id", productId)
    .maybeSingle();
  if (productError) {
    return { ok: false, error: "查詢商品失敗，請稍後再試" };
  }
  if (!product) {
    return { ok: false, error: "找不到商品" };
  }

  // sort_order 排最後：現有最大值 +1；沒有任何圖片時視 max 為 -1，首張圖＝0
  const { data: last, error: lastError } = await supabase
    .from("product_image")
    .select("sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) {
    return { ok: false, error: "查詢圖片排序失敗，請稍後再試" };
  }
  const nextSortOrder = (last?.sort_order ?? -1) + 1;

  let storagePath: string;
  try {
    storagePath = await uploadProductImage(productId, file);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "圖片上傳失敗，請稍後再試",
    };
  }

  const { error: insertError } = await supabase.from("product_image").insert({
    product_id: productId,
    storage_path: storagePath,
    sort_order: nextSortOrder,
  });

  if (insertError) {
    // 回滾已上傳的檔案，避免孤兒檔；回滾失敗僅記錄，不再往外拋
    try {
      await deleteProductImageFile(storagePath);
    } catch (e) {
      console.error("回滾 Storage 圖片失敗", e);
      Sentry.captureException(e, { extra: { storagePath, productId } });
    }
    return { ok: false, error: "圖片建檔失敗，請稍後再試" };
  }

  revalidateImagePages(productId);
  return { ok: true };
}

export async function deleteImage(imageId: string): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = z.string().uuid().safeParse(imageId);
  if (!parsed.success) {
    return { ok: false, error: "圖片識別碼格式不正確" };
  }

  const supabase = createServiceRoleClient();
  const { data: deleted, error } = await supabase
    .from("product_image")
    .delete()
    .eq("id", parsed.data)
    .select("storage_path, product_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "刪除圖片失敗，請稍後再試" };
  }
  if (!deleted) {
    return { ok: false, error: "找不到圖片，可能已被刪除" };
  }

  // DB 為準：Storage 刪檔失敗僅記錄，不擋使用者
  try {
    await deleteProductImageFile(deleted.storage_path);
  } catch (e) {
    console.error("刪除 Storage 圖片失敗", e);
    Sentry.captureException(e, {
      extra: { storagePath: deleted.storage_path, imageId: parsed.data },
    });
  }

  revalidateImagePages(deleted.product_id);
  return { ok: true };
}

export async function moveImage(
  imageId: string,
  direction: "up" | "down",
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = moveSchema.safeParse({ imageId, direction });
  if (!parsed.success) {
    return { ok: false, error: "參數格式不正確" };
  }

  const supabase = createServiceRoleClient();
  const { data: target, error: targetError } = await supabase
    .from("product_image")
    .select("id, product_id, sort_order")
    .eq("id", parsed.data.imageId)
    .maybeSingle();

  if (targetError) {
    return { ok: false, error: "查詢圖片失敗，請稍後再試" };
  }
  if (!target) {
    return { ok: false, error: "找不到圖片，可能已被刪除" };
  }

  // sort_order 不保證連續（0、3、8、15 皆合法），排序只看相對大小：
  // 找方向上「最接近」的相鄰一筆，與之交換 sort_order。只更新這兩筆，
  // 禁止全量 reindex（更新過多 row、放大 race 風險）。
  const ascending = parsed.data.direction === "down";
  const neighborQuery = supabase
    .from("product_image")
    .select("id, sort_order")
    .eq("product_id", target.product_id);
  const { data: neighbor, error: neighborError } = await (
    ascending
      ? neighborQuery.gt("sort_order", target.sort_order)
      : neighborQuery.lt("sort_order", target.sort_order)
  )
    .order("sort_order", { ascending })
    .limit(1)
    .maybeSingle();

  if (neighborError) {
    return { ok: false, error: "查詢相鄰圖片失敗，請稍後再試" };
  }
  if (!neighbor) {
    return { ok: true }; // 已在最前／最後，無事可做
  }

  const { error: updateTargetError } = await supabase
    .from("product_image")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", target.id);
  if (updateTargetError) {
    return { ok: false, error: "調整排序失敗，請稍後再試" };
  }

  const { error: updateNeighborError } = await supabase
    .from("product_image")
    .update({ sort_order: target.sort_order })
    .eq("id", neighbor.id);
  if (updateNeighborError) {
    return { ok: false, error: "調整排序失敗，請重新整理確認順序" };
  }

  revalidateImagePages(target.product_id);
  return { ok: true };
}

export async function updateAlt(
  imageId: string,
  alt: string,
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = altSchema.safeParse({ imageId, alt });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "替代文字格式不正確",
    };
  }

  const supabase = createServiceRoleClient();
  const { data: updated, error } = await supabase
    .from("product_image")
    .update({ alt: parsed.data.alt })
    .eq("id", parsed.data.imageId)
    .select("product_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: "更新替代文字失敗，請稍後再試" };
  }
  if (!updated) {
    return { ok: false, error: "找不到圖片，可能已被刪除" };
  }

  revalidateImagePages(updated.product_id);
  return { ok: true };
}
