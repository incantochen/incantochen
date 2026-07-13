"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AdminActionResult } from "@/lib/admin/action-result";
import {
  uploadProductImage,
  deleteProductImageFile,
} from "@/lib/storage/product-images";

const uploadSchema = z.object({
  productId: z.string().uuid(),
});

const altSchema = z.object({
  imageId: z.string().uuid(),
  alt: z.string().trim().max(200, "替代文字不可超過 200 字"),
});

const moveSchema = z.object({
  imageId: z.string().uuid(),
  productId: z.string().uuid(),
  direction: z.enum(["up", "down"]),
});

function revalidateImagesPage(productId: string) {
  revalidatePath(`/admin/products/${productId}/images`);
}

// 商品列表只顯示圖片數，僅上傳/刪除需要連列表一起 revalidate
function revalidateImageCountPages(productId: string) {
  revalidateImagesPage(productId);
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

  // 確認商品存在（也擋掉對不存在 id 亂丟檔案產生的孤兒目錄）
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

  let storagePath: string;
  try {
    storagePath = await uploadProductImage(productId, file);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "圖片上傳失敗，請稍後再試",
    };
  }

  // 取號＋插入走 insert_product_image() RPC（migration 0013）：max+1 在函式內
  // 原子執行，並發搶號由 unique 約束攔下重試——應用層不再 check-then-act
  const { error: insertError } = await supabase.rpc("insert_product_image", {
    p_product_id: productId,
    p_storage_path: storagePath,
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

  revalidateImageCountPages(productId);
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

  revalidateImageCountPages(deleted.product_id);
  return { ok: true };
}

export async function moveImage(
  imageId: string,
  productId: string,
  direction: "up" | "down",
): Promise<AdminActionResult> {
  await requireAdmin();

  const parsed = moveSchema.safeParse({ imageId, productId, direction });
  if (!parsed.success) {
    return { ok: false, error: "參數格式不正確" };
  }

  const supabase = createServiceRoleClient();

  // 鄰居選取＋交換全部收進 move_product_image() RPC（migration 0013）：
  // 單一交易＋row lock，並發交錯與「部分成功留下重複 sort_order」都在 DB 層消滅
  const { data: moveResult, error: moveError } = await supabase.rpc(
    "move_product_image",
    { p_image_id: parsed.data.imageId, p_direction: parsed.data.direction },
  );

  if (moveError) {
    // 含極端情況的鎖競爭（deadlock 中止），重試即可恢復
    return { ok: false, error: "調整排序失敗，請重新整理後再試" };
  }
  if (moveResult === "not_found") {
    return { ok: false, error: "找不到圖片，可能已被刪除" };
  }
  if (moveResult === "moved") {
    revalidateImagesPage(parsed.data.productId);
  }
  return { ok: true }; // 'edge'＝已在最前／最後，無事可做
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

  revalidateImagesPage(updated.product_id);
  return { ok: true };
}
