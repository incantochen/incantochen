import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { env } from "@/lib/env";
import {
  PRODUCT_IMAGES_BUCKET,
  validateImageFile,
} from "@/lib/storage/constants";

// Storage 路徑的單一出處：DB（product_image.storage_path、option_value.image_path）
// 一律只存這種相對路徑，不存完整 URL——公開 URL 由 getProductImagePublicUrl 組出，
// 換 Supabase 專案／網域不需改資料（migration 0012 欄位 comment 同此約定）。
export function buildProductImagePath(productId: string, ext: string): string {
  return `${productId}/${crypto.randomUUID()}.${ext}`;
}

export async function uploadProductImage(
  productId: string,
  file: File,
): Promise<string> {
  const validation = validateImageFile(file.type, file.size);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const path = buildProductImagePath(productId, validation.ext);
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (error) {
    throw new Error(`圖片上傳 Storage 失敗：${error.message}`);
  }
  return path;
}

export async function deleteProductImageFile(path: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .remove([path]);

  if (error) {
    throw new Error(`刪除 Storage 圖片失敗：${error.message}`);
  }
}

export function getProductImagePublicUrl(path: string): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${path}`;
}
