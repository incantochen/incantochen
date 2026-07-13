import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { env } from "@/lib/env";
import {
  PRODUCT_IMAGES_BUCKET,
  detectImageMime,
  validateImageFile,
} from "@/lib/storage/constants";

// env 值帶尾斜線（複製貼上常見）會組出雙斜線 URL，next/image 的 remotePattern
// pathname 比對會失敗且無 fail-fast——在單一出處正規化掉
const SUPABASE_URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");

// UUID 命名、寫入後永不覆寫（upsert:false；換圖＝新路徑），可安全長快取
const IMMUTABLE_CACHE_SECONDS = "31536000";

// Storage 路徑的單一出處：DB（product_image.storage_path、option_value.image_path）
// 一律只存這種相對路徑，不存完整 URL——公開 URL 由 getImagePublicUrl 組出，
// 換 Supabase 專案／網域不需改資料（migration 0012 欄位 comment 同此約定）。
export function buildProductImagePath(productId: string, ext: string): string {
  return `${productId}/${crypto.randomUUID()}.${ext}`;
}

// 選項圖與商品圖同 bucket，以 option-value/ 前綴區隔（0012 comment 預告的路徑）
export function buildOptionValueImagePath(
  optionValueId: string,
  ext: string,
): string {
  return `option-value/${optionValueId}/${crypto.randomUUID()}.${ext}`;
}

// 驗證＋magic bytes 檢查＋上傳的共用核心：路徑由呼叫端決定
async function uploadImageToPath(path: string, file: File): Promise<string> {
  // 宣告的 mime 只反映副檔名，內容檢查才擋得住偽裝檔
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (detectImageMime(head) !== file.type) {
    throw new Error("檔案內容與宣告的圖片格式不符");
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      cacheControl: IMMUTABLE_CACHE_SECONDS,
    });

  if (error) {
    throw new Error(`圖片上傳 Storage 失敗：${error.message}`);
  }
  return path;
}

export async function uploadProductImage(
  productId: string,
  file: File,
): Promise<string> {
  const validation = validateImageFile(file.type, file.size);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  return uploadImageToPath(
    buildProductImagePath(productId, validation.ext),
    file,
  );
}

export async function uploadOptionValueImage(
  optionValueId: string,
  file: File,
): Promise<string> {
  const validation = validateImageFile(file.type, file.size);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  return uploadImageToPath(
    buildOptionValueImagePath(optionValueId, validation.ext),
    file,
  );
}

export async function deleteImageFile(path: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .remove([path]);

  if (error) {
    throw new Error(`刪除 Storage 圖片失敗：${error.message}`);
  }
}

// product_image 的 FK 是 on delete cascade，但 Storage 檔案不會跟著刪——
// 日後刪商品（T10）必須先呼叫本函式清 bucket，否則圖檔永久孤兒（0013 附註同此）
export async function deleteAllProductImageFiles(
  productId: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: files, error: listError } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .list(productId);

  if (listError) {
    throw new Error(`列出商品圖片檔案失敗：${listError.message}`);
  }
  if (!files || files.length === 0) return;

  const { error: removeError } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .remove(files.map((f) => `${productId}/${f.name}`));

  if (removeError) {
    throw new Error(`刪除商品圖片檔案失敗：${removeError.message}`);
  }
}

export function getImagePublicUrl(path: string): string {
  return `${SUPABASE_URL_BASE}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${path}`;
}
