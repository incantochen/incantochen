// 圖片上傳常數的單一出處（T11）：server 端驗證（product-images.ts）與
// client 端即時回饋（image-manager.tsx）共用；bucket 端另有同值的
// file_size_limit / allowed_mime_types 當第二道防線（migration 0012）。
// 本檔不得 import "server-only"——client component 也要用。

export const PRODUCT_IMAGES_BUCKET = "product-images";

// 副檔名一律由 mime 對映，不信任使用者檔名
export const IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(IMAGE_MIME_TO_EXT);

export const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5MB，與 bucket 設定一致

export type ImageFileValidation =
  | { ok: true; ext: string }
  | { ok: false; error: string };

export function validateImageFile(
  mimeType: string,
  size: number,
): ImageFileValidation {
  const ext = IMAGE_MIME_TO_EXT[mimeType];
  if (!ext) {
    return {
      ok: false,
      error: "僅支援 JPEG／PNG／WebP／AVIF 圖片格式",
    };
  }
  if (size > MAX_IMAGE_FILE_SIZE) {
    return { ok: false, error: "圖片大小不可超過 5MB" };
  }
  return { ok: true, ext };
}
