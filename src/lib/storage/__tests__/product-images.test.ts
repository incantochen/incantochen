/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: vi
    .fn()
    .mockResolvedValue({ id: "admin-1", email: "admin@example.com" }),
}));
vi.mock("@/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" },
}));

const state = {
  uploadResult: { error: null } as { error: { message: string } | null },
  removeResult: { error: null } as { error: { message: string } | null },
  productLookup: {
    data: { id: "prod-1" } as { id: string } | null,
    error: null as any,
  },
  lastSortLookup: {
    data: null as { sort_order: number } | null,
    error: null as any,
  },
  insertResult: { error: null as { message: string } | null },
  uploadedPaths: [] as string[],
  removedPaths: [] as string[][],
  inserted: [] as any[],
};

function makeServiceRole() {
  return {
    storage: {
      from: () => ({
        upload: (path: string) => {
          state.uploadedPaths.push(path);
          return Promise.resolve(state.uploadResult);
        },
        remove: (paths: string[]) => {
          state.removedPaths.push(paths);
          return Promise.resolve(state.removeResult);
        },
      }),
    },
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          if (table === "product") return Promise.resolve(state.productLookup);
          if (table === "product_image")
            return Promise.resolve(state.lastSortLookup);
          return Promise.resolve({ data: null, error: null });
        },
        insert: (values: any) => {
          state.inserted.push({ table, values });
          return Promise.resolve(state.insertResult);
        },
      };
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => makeServiceRole(),
}));

import {
  validateImageFile,
  MAX_IMAGE_FILE_SIZE,
  IMAGE_MIME_TO_EXT,
} from "@/lib/storage/constants";
import {
  buildProductImagePath,
  uploadProductImage,
} from "@/lib/storage/product-images";
import { uploadImage } from "@/app/admin/products/[id]/images/actions";

beforeEach(() => {
  state.uploadResult = { error: null };
  state.removeResult = { error: null };
  state.productLookup = { data: { id: "prod-1" }, error: null };
  state.lastSortLookup = { data: null, error: null };
  state.insertResult = { error: null };
  state.uploadedPaths = [];
  state.removedPaths = [];
  state.inserted = [];
});

describe("validateImageFile", () => {
  it.each(Object.entries(IMAGE_MIME_TO_EXT))(
    "白名單 mime %s 通過並對映副檔名 %s",
    (mime, ext) => {
      expect(validateImageFile(mime, 1024)).toEqual({ ok: true, ext });
    },
  );

  it("拒絕非白名單 mime", () => {
    for (const mime of ["image/gif", "image/svg+xml", "application/pdf", ""]) {
      expect(validateImageFile(mime, 1024).ok).toBe(false);
    }
  });

  it("拒絕超過 5MB 的檔案；剛好 5MB 通過", () => {
    expect(validateImageFile("image/jpeg", MAX_IMAGE_FILE_SIZE + 1).ok).toBe(
      false,
    );
    expect(validateImageFile("image/jpeg", MAX_IMAGE_FILE_SIZE).ok).toBe(true);
  });
});

describe("buildProductImagePath", () => {
  it("組出 {productId}/{uuid}.{ext} 且每次不同（uuid）", () => {
    const a = buildProductImagePath("prod-1", "webp");
    const b = buildProductImagePath("prod-1", "webp");
    expect(a).toMatch(
      /^prod-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/,
    );
    expect(a).not.toBe(b);
  });
});

function makeFile(type = "image/jpeg", size = 1024): File {
  return new File([new Uint8Array(size)], "原始檔名可以亂取.jpeg", { type });
}

describe("uploadProductImage", () => {
  it("Storage upload 回傳 error 時必須 throw（不靜默）", async () => {
    state.uploadResult = { error: { message: "boom" } };
    await expect(uploadProductImage("prod-1", makeFile())).rejects.toThrow(
      /圖片上傳 Storage 失敗/,
    );
  });

  it("成功時回傳由 mime 對映副檔名的 storage path（不信任檔名）", async () => {
    const path = await uploadProductImage("prod-1", makeFile("image/png"));
    expect(path).toMatch(/^prod-1\/.+\.png$/);
    expect(state.uploadedPaths).toEqual([path]);
  });
});

describe("uploadImage action", () => {
  const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

  function makeFormData(file: File = makeFile()) {
    const formData = new FormData();
    formData.set("productId", PRODUCT_ID);
    formData.set("file", file);
    return formData;
  }

  it("DB insert 失敗時回滾刪除已上傳檔案並回 ok:false", async () => {
    state.insertResult = { error: { message: "insert boom" } };

    const result = await uploadImage(makeFormData());

    expect(result.ok).toBe(false);
    expect(state.uploadedPaths).toHaveLength(1);
    // 回滾必須以剛上傳的 path 呼叫 storage remove
    expect(state.removedPaths).toEqual([[state.uploadedPaths[0]]]);
  });

  it("成功時 insert 首張圖 sort_order = 0（無既有圖片，max 視為 -1）", async () => {
    state.lastSortLookup = { data: null, error: null };

    const result = await uploadImage(makeFormData());

    expect(result).toEqual({ ok: true });
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0].values.sort_order).toBe(0);
    expect(state.removedPaths).toHaveLength(0);
  });

  it("已有圖片時 sort_order = 現有最大值 +1（不假設連續）", async () => {
    state.lastSortLookup = { data: { sort_order: 15 }, error: null };

    const result = await uploadImage(makeFormData());

    expect(result).toEqual({ ok: true });
    expect(state.inserted[0].values.sort_order).toBe(16);
  });

  it("非白名單 mime 在 server 端被拒，不落 Storage 也不落 DB", async () => {
    const result = await uploadImage(makeFormData(makeFile("image/gif")));

    expect(result.ok).toBe(false);
    expect(state.uploadedPaths).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });
});
