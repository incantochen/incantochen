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

type MockResult = { data?: any; error: { message: string } | null };

const state = {
  uploadResult: { error: null } as { error: { message: string } | null },
  removeResult: { error: null } as { error: { message: string } | null },
  productLookup: {
    data: { id: "prod-1" } as { id: string } | null,
    error: null as any,
  },
  rpcResults: {} as Record<string, MockResult>,
  rpcCalls: [] as { fn: string; args: any }[],
  deleteResult: { data: null, error: null } as MockResult,
  updateResult: { data: null, error: null } as MockResult,
  updatedValues: [] as any[],
  uploadedPaths: [] as string[],
  removedPaths: [] as string[][],
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
    rpc: (fn: string, args: any) => {
      state.rpcCalls.push({ fn, args });
      return Promise.resolve(
        state.rpcResults[fn] ?? { data: null, error: null },
      );
    },
    from: (table: string) => {
      let op: "select" | "delete" | "update" = "select";
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        delete: () => {
          op = "delete";
          return chain;
        },
        update: (values: any) => {
          op = "update";
          state.updatedValues.push({ table, values });
          return chain;
        },
        maybeSingle: () => {
          if (op === "delete") return Promise.resolve(state.deleteResult);
          if (op === "update") return Promise.resolve(state.updateResult);
          if (table === "product") return Promise.resolve(state.productLookup);
          return Promise.resolve({ data: null, error: null });
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
  detectImageMime,
  MAX_IMAGE_FILE_SIZE,
  IMAGE_MIME_TO_EXT,
} from "@/lib/storage/constants";
import {
  buildProductImagePath,
  buildOptionValueImagePath,
  uploadProductImage,
  uploadOptionValueImage,
  getImagePublicUrl,
} from "@/lib/storage/product-images";
import {
  uploadImage,
  deleteImage,
  moveImage,
  updateAlt,
} from "@/app/admin/products/[id]/images/actions";

beforeEach(() => {
  state.uploadResult = { error: null };
  state.removeResult = { error: null };
  state.productLookup = { data: { id: "prod-1" }, error: null };
  state.rpcResults = {};
  state.rpcCalls = [];
  state.deleteResult = { data: null, error: null };
  state.updateResult = { data: null, error: null };
  state.updatedValues = [];
  state.uploadedPaths = [];
  state.removedPaths = [];
});

// 各格式的檔頭 magic bytes（detectImageMime 判定依據）
const MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  // RIFF....WEBP
  "image/webp": [
    0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ],
  // ....ftypavif
  "image/avif": [
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
  ],
};

function makeFile(type = "image/jpeg", size = 1024, withMagic = true): File {
  const bytes = new Uint8Array(size);
  if (withMagic) bytes.set(MAGIC_BYTES[type] ?? [], 0);
  return new File([bytes], "原始檔名可以亂取.jpeg", { type });
}

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

describe("detectImageMime", () => {
  it.each(Object.keys(MAGIC_BYTES))("正確判定 %s", (mime) => {
    const bytes = new Uint8Array(16);
    bytes.set(MAGIC_BYTES[mime]!, 0);
    expect(detectImageMime(bytes)).toBe(mime);
  });

  it("文字內容／未知格式回 null", () => {
    expect(
      detectImageMime(new TextEncoder().encode("this is not an image")),
    ).toBeNull();
    expect(detectImageMime(new Uint8Array(0))).toBeNull();
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

describe("buildOptionValueImagePath", () => {
  it("組出 option-value/{optionValueId}/{uuid}.{ext}（同 bucket 前綴區隔）", () => {
    const a = buildOptionValueImagePath("val-1", "png");
    const b = buildOptionValueImagePath("val-1", "png");
    expect(a).toMatch(
      /^option-value\/val-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
    );
    expect(a).not.toBe(b);
  });
});

describe("uploadOptionValueImage", () => {
  it("成功時回傳 option-value 前綴的 storage path", async () => {
    const path = await uploadOptionValueImage("val-1", makeFile("image/webp"));
    expect(path).toMatch(/^option-value\/val-1\/.+\.webp$/);
    expect(state.uploadedPaths).toEqual([path]);
  });

  it("magic bytes 不符時拒絕（與商品圖共用核心檢查）", async () => {
    await expect(
      uploadOptionValueImage("val-1", makeFile("image/jpeg", 1024, false)),
    ).rejects.toThrow(/檔案內容與宣告的圖片格式不符/);
    expect(state.uploadedPaths).toHaveLength(0);
  });

  it("Storage upload 回傳 error 時必須 throw（不靜默）", async () => {
    state.uploadResult = { error: { message: "boom" } };
    await expect(uploadOptionValueImage("val-1", makeFile())).rejects.toThrow(
      /圖片上傳 Storage 失敗/,
    );
  });
});

describe("getImagePublicUrl", () => {
  it("以正規化後的 base URL 組公開 URL（不因尾斜線產生雙斜線）", () => {
    // env mock 無尾斜線；正規化行為由 SUPABASE_URL_BASE 的 replace 保證，
    // 此處驗證輸出形狀單斜線
    expect(getImagePublicUrl("prod-1/a.webp")).toBe(
      "https://example.supabase.co/storage/v1/object/public/product-images/prod-1/a.webp",
    );
  });
});

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

  it("檔案內容與宣告 mime 不符時拒絕（magic bytes 檢查，擋偽裝檔）", async () => {
    // 文字內容偽裝成 .jpg：宣告 image/jpeg、內容無 JPEG 檔頭
    await expect(
      uploadProductImage("prod-1", makeFile("image/jpeg", 1024, false)),
    ).rejects.toThrow(/檔案內容與宣告的圖片格式不符/);
    expect(state.uploadedPaths).toHaveLength(0);
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

  it("成功時以 insert_product_image RPC 建檔（取號在 DB 端原子執行）", async () => {
    const result = await uploadImage(makeFormData());

    expect(result).toEqual({ ok: true });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]!.fn).toBe("insert_product_image");
    expect(state.rpcCalls[0]!.args).toEqual({
      p_product_id: PRODUCT_ID,
      p_storage_path: state.uploadedPaths[0],
    });
    expect(state.removedPaths).toHaveLength(0);
  });

  it("RPC 建檔失敗時回滾刪除已上傳檔案並回 ok:false", async () => {
    state.rpcResults["insert_product_image"] = {
      data: null,
      error: { message: "insert boom" },
    };

    const result = await uploadImage(makeFormData());

    expect(result.ok).toBe(false);
    expect(state.uploadedPaths).toHaveLength(1);
    // 回滾必須以剛上傳的 path 呼叫 storage remove
    expect(state.removedPaths).toEqual([[state.uploadedPaths[0]]]);
  });

  it("非白名單 mime 在 server 端被拒，不落 Storage 也不落 DB", async () => {
    const result = await uploadImage(makeFormData(makeFile("image/gif")));

    expect(result.ok).toBe(false);
    expect(state.uploadedPaths).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("偽裝檔（宣告 jpeg、內容非圖片）在 server 端被拒", async () => {
    const result = await uploadImage(
      makeFormData(makeFile("image/jpeg", 1024, false)),
    );

    expect(result.ok).toBe(false);
    expect(state.uploadedPaths).toHaveLength(0);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

describe("moveImage action", () => {
  it("呼叫 move_product_image RPC 並帶正確參數", async () => {
    state.rpcResults["move_product_image"] = { data: "moved", error: null };

    const result = await moveImage(IMAGE_ID, PRODUCT_ID, "up");

    expect(result).toEqual({ ok: true });
    expect(state.rpcCalls).toEqual([
      {
        fn: "move_product_image",
        args: { p_image_id: IMAGE_ID, p_direction: "up" },
      },
    ]);
  });

  it("'edge'（已在最前／最後）視為成功、無事可做", async () => {
    state.rpcResults["move_product_image"] = { data: "edge", error: null };
    expect(await moveImage(IMAGE_ID, PRODUCT_ID, "down")).toEqual({ ok: true });
  });

  it("'not_found' 回結構化錯誤", async () => {
    state.rpcResults["move_product_image"] = {
      data: "not_found",
      error: null,
    };
    const result = await moveImage(IMAGE_ID, PRODUCT_ID, "up");
    expect(result.ok).toBe(false);
  });

  it("RPC error（含鎖競爭中止）回結構化錯誤，不 throw", async () => {
    state.rpcResults["move_product_image"] = {
      data: null,
      error: { message: "deadlock detected" },
    };
    const result = await moveImage(IMAGE_ID, PRODUCT_ID, "up");
    expect(result.ok).toBe(false);
  });

  it("非法參數（非 uuid／未知方向）不打 DB", async () => {
    const result = await moveImage("not-a-uuid", PRODUCT_ID, "up");
    expect(result.ok).toBe(false);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("deleteImage action", () => {
  it("DB 為準：先刪 row 成功後刪 Storage 檔", async () => {
    state.deleteResult = {
      data: { storage_path: "prod-1/a.webp", product_id: PRODUCT_ID },
      error: null,
    };

    const result = await deleteImage(IMAGE_ID);

    expect(result).toEqual({ ok: true });
    expect(state.removedPaths).toEqual([["prod-1/a.webp"]]);
  });

  it("row 不存在時回錯誤且不動 Storage", async () => {
    state.deleteResult = { data: null, error: null };

    const result = await deleteImage(IMAGE_ID);

    expect(result.ok).toBe(false);
    expect(state.removedPaths).toHaveLength(0);
  });

  it("Storage 刪檔失敗不影響結果（DB 為準，僅記錄）", async () => {
    state.deleteResult = {
      data: { storage_path: "prod-1/a.webp", product_id: PRODUCT_ID },
      error: null,
    };
    state.removeResult = { error: { message: "storage boom" } };

    expect(await deleteImage(IMAGE_ID)).toEqual({ ok: true });
  });
});

describe("updateAlt action", () => {
  it("trim 後存入", async () => {
    state.updateResult = { data: { product_id: PRODUCT_ID }, error: null };

    const result = await updateAlt(IMAGE_ID, "  戒指正面  ");

    expect(result).toEqual({ ok: true });
    expect(state.updatedValues).toEqual([
      { table: "product_image", values: { alt: "戒指正面" } },
    ]);
  });

  it("超過 200 字被拒且不打 DB", async () => {
    const result = await updateAlt(IMAGE_ID, "a".repeat(201));
    expect(result.ok).toBe(false);
    expect(state.updatedValues).toHaveLength(0);
  });
});
