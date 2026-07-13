"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import type { AdminActionResult } from "@/lib/admin/action-result";
import { AdminNotifyBanner, useAdminNotify } from "@/components/admin-notify";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  validateImageFile,
} from "@/lib/storage/constants";
import { uploadImage, deleteImage, moveImage, updateAlt } from "./actions";

type ImageItem = {
  id: string;
  alt: string;
  publicUrl: string;
};

export function ImageManager({
  productId,
  images,
}: {
  productId: string;
  images: ImageItem[];
}) {
  const [isPending, startTransition] = useTransition();
  const { message, notify } = useAdminNotify();
  const [altDrafts, setAltDrafts] = useState<Record<string, string>>({});

  // 四個操作共用同一套「呼叫 action → !ok 顯示錯誤 → 成功顯示訊息/後續」骨架
  function runAction(
    action: () => Promise<AdminActionResult>,
    options: {
      successMsg?: string;
      fallbackError: string;
      onSuccess?: () => void;
    },
  ) {
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          notify(result.error, true);
          return;
        }
        if (options.successMsg) notify(options.successMsg);
        options.onSuccess?.();
      } catch (e) {
        notify(e instanceof Error ? e.message : options.fallbackError, true);
      }
    });
  }

  function handleUpload(file: File) {
    // client 端先驗給即時回饋；server 端（action＋bucket 設定）仍會再驗
    const validation = validateImageFile(file.type, file.size);
    if (!validation.ok) {
      notify(validation.error, true);
      return;
    }

    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("file", file);
    runAction(() => uploadImage(formData), {
      successMsg: "圖片已上傳",
      fallbackError: "上傳失敗",
    });
  }

  function handleDelete(imageId: string) {
    if (!confirm("確定要刪除這張圖片嗎？此操作無法復原。")) return;
    runAction(() => deleteImage(imageId), {
      successMsg: "圖片已刪除",
      fallbackError: "刪除失敗",
    });
  }

  function handleMove(imageId: string, direction: "up" | "down") {
    // 排序結果畫面立即可見，成功不另跳訊息
    runAction(() => moveImage(imageId, productId, direction), {
      fallbackError: "調整排序失敗",
    });
  }

  function handleSaveAlt(imageId: string) {
    const draft = altDrafts[imageId];
    if (draft === undefined) return;
    runAction(() => updateAlt(imageId, draft), {
      successMsg: "替代文字已更新",
      fallbackError: "更新失敗",
      onSuccess: () =>
        setAltDrafts((prev) => {
          const next = { ...prev };
          delete next[imageId];
          return next;
        }),
    });
  }

  return (
    <div className="space-y-4">
      <AdminNotifyBanner message={message} />

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <label className="block text-sm font-medium text-gray-700">
          上傳圖片
          <span className="ml-2 font-normal text-gray-400">
            JPEG／PNG／WebP／AVIF，5MB 以內
          </span>
        </label>
        <input
          type="file"
          accept={ALLOWED_IMAGE_MIME_TYPES.join(",")}
          disabled={isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // 立即清空 value：上傳失敗後重選同一個檔案才會再觸發 change
            e.target.value = "";
            if (file) handleUpload(file);
          }}
          className="mt-2 block text-sm text-gray-600 file:mr-3 file:rounded file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800 disabled:opacity-50"
        />
      </div>

      {images.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-400">
          尚無圖片，請從上方上傳
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="relative aspect-square overflow-hidden rounded bg-gray-100">
                <Image
                  src={image.publicUrl}
                  alt={image.alt}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className="object-cover"
                />
                {index === 0 && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-gray-900/80 px-1.5 py-0.5 text-xs font-medium text-white">
                    主圖
                  </span>
                )}
              </div>

              <div className="mt-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleMove(image.id, "up")}
                  disabled={isPending || index === 0}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  ↑ 上移
                </button>
                <button
                  type="button"
                  onClick={() => handleMove(image.id, "down")}
                  disabled={isPending || index === images.length - 1}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  ↓ 下移
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(image.id)}
                  disabled={isPending}
                  className="ml-auto rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  刪除
                </button>
              </div>

              <div className="mt-2 flex gap-1">
                <input
                  type="text"
                  value={altDrafts[image.id] ?? image.alt}
                  onChange={(e) =>
                    setAltDrafts((prev) => ({
                      ...prev,
                      [image.id]: e.target.value,
                    }))
                  }
                  placeholder="替代文字（alt）"
                  maxLength={200}
                  disabled={isPending}
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
                <button
                  type="button"
                  onClick={() => handleSaveAlt(image.id)}
                  disabled={isPending || altDrafts[image.id] === undefined}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  儲存
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
