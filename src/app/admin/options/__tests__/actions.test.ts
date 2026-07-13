/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => revalidatePath(p),
}));

const requireAdmin = vi.fn().mockResolvedValue({ email: "admin@example.com" });
vi.mock("@/lib/auth/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const uploadOptionValueImageFile = vi.fn();
const deleteImageFiles = vi.fn();
vi.mock("@/lib/storage/product-images", () => ({
  uploadOptionValueImage: (...a: unknown[]) => uploadOptionValueImageFile(...a),
  deleteImageFiles: (...a: unknown[]) => deleteImageFiles(...a),
}));

const TYPE_ID = "11111111-1111-4111-8111-111111111111";
const VALUE_ID = "22222222-2222-4222-8222-222222222222";

type MockError = { code?: string; message?: string } | null;

const state = {
  // option_type
  typeInsertError: null as MockError,
  typeInsertedId: "new-type-id",
  typeUpdateResult: { id: TYPE_ID } as { id: string } | null,
  typeUpdateError: null as MockError,
  typeDeleteError: null as MockError,
  typeConflict: null as { name: string } | null,
  // option_value
  valueUpdateResult: { option_type_id: TYPE_ID } as {
    option_type_id: string;
  } | null,
  valueUpdateError: null as MockError,
  valueDeleteResult: {
    image_path: null,
    option_type_id: TYPE_ID,
  } as { image_path: string | null; option_type_id: string } | null,
  valueDeleteError: null as MockError,
  valueConflict: null as { label: string } | null,
  valueCurrent: { image_path: null, option_type_id: TYPE_ID } as {
    image_path: string | null;
    option_type_id: string;
  } | null,
  valueCurrentError: null as MockError,
  valueImageUpdateResult: { id: VALUE_ID } as { id: string } | null,
  valueImageUpdateError: null as MockError,
  valuesWithImage: [] as { image_path: string | null }[],
  // 引用預查
  productOptionCount: 0,
  productOptionCountError: null as MockError,
  povCount: 0,
  povCountError: null as MockError,
  // RPC
  rpcResult: null as unknown,
  rpcError: null as MockError,
};

const recorded: {
  op: string;
  table: string;
  values?: any;
  eqs: [string, unknown][];
  is: [string, unknown][];
}[] = [];
const rpcCalls: { fn: string; args: any }[] = [];

function insertedValues(table: string) {
  return recorded.filter((r) => r.op === "insert" && r.table === table);
}
function updates(table: string) {
  return recorded.filter((r) => r.op === "update" && r.table === table);
}

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: state.rpcResult, error: state.rpcError });
    },
    from: (table: string) => {
      if (table === "product_option") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                count: state.productOptionCount,
                error: state.productOptionCountError,
              }),
          }),
        };
      }
      if (table === "product_option_value") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                count: state.povCount,
                error: state.povCountError,
              }),
          }),
        };
      }
      if (table === "option_type") {
        return {
          insert: (values: any) => {
            recorded.push({ op: "insert", table, values, eqs: [], is: [] });
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: state.typeInsertError
                      ? null
                      : { id: state.typeInsertedId },
                    error: state.typeInsertError,
                  }),
              }),
            };
          },
          update: (values: any) => {
            const entry = {
              op: "update",
              table,
              values,
              eqs: [] as [string, unknown][],
              is: [] as [string, unknown][],
            };
            recorded.push(entry);
            const chain: any = {
              eq: (col: string, val: unknown) => {
                entry.eqs.push([col, val]);
                return chain;
              },
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.typeUpdateError ? null : state.typeUpdateResult,
                    error: state.typeUpdateError,
                  }),
              }),
            };
            return chain;
          },
          delete: () => {
            const entry = {
              op: "delete",
              table,
              eqs: [] as [string, unknown][],
              is: [] as [string, unknown][],
            };
            recorded.push(entry);
            return {
              eq: (col: string, val: unknown) => {
                entry.eqs.push([col, val]);
                return Promise.resolve({ error: state.typeDeleteError });
              },
            };
          },
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: state.typeConflict, error: null }),
              not: () =>
                Promise.resolve({ data: state.valuesWithImage, error: null }),
            }),
          }),
        };
      }
      // table === "option_value"
      return {
        update: (values: any) => {
          const entry = {
            op: "update",
            table,
            values,
            eqs: [] as [string, unknown][],
            is: [] as [string, unknown][],
          };
          recorded.push(entry);
          const isImageUpdate = "image_path" in values;
          const chain: any = {
            eq: (col: string, val: unknown) => {
              entry.eqs.push([col, val]);
              return chain;
            },
            is: (col: string, val: unknown) => {
              entry.is.push([col, val]);
              return chain;
            },
            select: () => ({
              maybeSingle: () =>
                Promise.resolve(
                  isImageUpdate
                    ? {
                        data: state.valueImageUpdateError
                          ? null
                          : state.valueImageUpdateResult,
                        error: state.valueImageUpdateError,
                      }
                    : {
                        data: state.valueUpdateError
                          ? null
                          : state.valueUpdateResult,
                        error: state.valueUpdateError,
                      },
                ),
            }),
          };
          return chain;
        },
        delete: () => {
          const entry = {
            op: "delete",
            table,
            eqs: [] as [string, unknown][],
            is: [] as [string, unknown][],
          };
          recorded.push(entry);
          const chain: any = {
            eq: (col: string, val: unknown) => {
              entry.eqs.push([col, val]);
              return chain;
            },
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: state.valueDeleteError ? null : state.valueDeleteResult,
                  error: state.valueDeleteError,
                }),
            }),
          };
          return chain;
        },
        select: (cols: string) => ({
          eq: (col: string, val: unknown) => {
            const eqChain = {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: state.valueConflict, error: null }),
              }),
              maybeSingle: () =>
                Promise.resolve({
                  data: state.valueCurrentError ? null : state.valueCurrent,
                  error: state.valueCurrentError,
                }),
              not: () =>
                Promise.resolve({ data: state.valuesWithImage, error: null }),
            };
            void cols;
            void col;
            void val;
            return eqChain;
          },
        }),
      };
    },
  }),
}));

import {
  createOptionType,
  updateOptionType,
  setOptionTypeActive,
  deleteOptionType,
  createOptionValue,
  updateOptionValue,
  moveOptionValue,
  deleteOptionValue,
  uploadOptionValueImage,
  removeOptionValueImage,
} from "../actions";

function makeFile(type = "image/png") {
  return new File([new Uint8Array(64)], "swatch.png", { type });
}

beforeEach(() => {
  recorded.length = 0;
  rpcCalls.length = 0;
  revalidatePath.mockClear();
  uploadOptionValueImageFile.mockReset();
  deleteImageFiles.mockReset();
  state.typeInsertError = null;
  state.typeInsertedId = "new-type-id";
  state.typeUpdateResult = { id: TYPE_ID };
  state.typeUpdateError = null;
  state.typeDeleteError = null;
  state.typeConflict = null;
  state.valueUpdateResult = { option_type_id: TYPE_ID };
  state.valueUpdateError = null;
  state.valueDeleteResult = { image_path: null, option_type_id: TYPE_ID };
  state.valueDeleteError = null;
  state.valueConflict = null;
  state.valueCurrent = { image_path: null, option_type_id: TYPE_ID };
  state.valueCurrentError = null;
  state.valueImageUpdateResult = { id: VALUE_ID };
  state.valueImageUpdateError = null;
  state.valuesWithImage = [];
  state.productOptionCount = 0;
  state.productOptionCountError = null;
  state.povCount = 0;
  state.povCountError = null;
  state.rpcResult = null;
  state.rpcError = null;
});

describe("createOptionType", () => {
  const VALID = {
    code: "gem_color",
    name: "寶石顏色",
    applies_to: "all",
    input_type: "swatch",
  } as const;

  it("建立成功並回傳 id", async () => {
    const result = await createOptionType({ ...VALID });
    expect(result).toEqual({ ok: true, id: "new-type-id" });
    expect(insertedValues("option_type")[0]?.values).toMatchObject({
      code: "gem_color",
    });
  });

  it("code 格式不符（大寫／連字號）被 zod 擋下", async () => {
    const result = await createOptionType({ ...VALID, code: "Gem-Color" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors?.code).toBeTruthy();
    }
    expect(insertedValues("option_type")).toHaveLength(0);
  });

  it("23505 衝突查出既有項目名稱給友善訊息", async () => {
    state.typeInsertError = { code: "23505" };
    state.typeConflict = { name: "寶石顏色" };
    const result = await createOptionType({ ...VALID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("寶石顏色");
      expect(result.fieldErrors?.code).toContain("寶石顏色");
    }
  });
});

describe("updateOptionType", () => {
  it("update payload 不含 code（建立後鎖定）", async () => {
    const result = await updateOptionType(TYPE_ID, {
      name: "新名稱",
      applies_to: "ring",
      input_type: "select",
      // @ts-expect-error 模擬惡意多傳 code
      code: "hacked_code",
    });
    expect(result.ok).toBe(true);
    const update = updates("option_type")[0];
    expect(update?.values).not.toHaveProperty("code");
    expect(update?.values).toMatchObject({ name: "新名稱" });
  });

  it("找不到列時回友善訊息", async () => {
    state.typeUpdateResult = null;
    const result = await updateOptionType(TYPE_ID, {
      name: "新名稱",
      applies_to: "ring",
      input_type: "select",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("找不到");
  });
});

describe("setOptionTypeActive", () => {
  it("寫入 is_active 欄位", async () => {
    const result = await setOptionTypeActive(TYPE_ID, false);
    expect(result.ok).toBe(true);
    expect(updates("option_type")[0]?.values).toEqual({ is_active: false });
  });
});

describe("deleteOptionType", () => {
  it("有商品使用時擋下並提示改為隱藏", async () => {
    state.productOptionCount = 2;
    const result = await deleteOptionType(TYPE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("隱藏");
    expect(recorded.filter((r) => r.op === "delete")).toHaveLength(0);
  });

  it("race window 內 DB RESTRICT（23503）兜底回同句訊息", async () => {
    state.typeDeleteError = { code: "23503" };
    const result = await deleteOptionType(TYPE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("隱藏");
  });

  it("刪除成功後批次清值的 Storage 圖檔", async () => {
    state.valuesWithImage = [
      { image_path: "option-value/a/1.png" },
      { image_path: "option-value/b/2.png" },
    ];
    const result = await deleteOptionType(TYPE_ID);
    expect(result.ok).toBe(true);
    expect(deleteImageFiles).toHaveBeenCalledTimes(1);
    expect(deleteImageFiles).toHaveBeenCalledWith([
      "option-value/a/1.png",
      "option-value/b/2.png",
    ]);
  });

  it("Storage 清檔失敗不擋成功回應", async () => {
    state.valuesWithImage = [{ image_path: "option-value/a/1.png" }];
    deleteImageFiles.mockRejectedValue(new Error("storage down"));
    const result = await deleteOptionType(TYPE_ID);
    expect(result.ok).toBe(true);
  });
});

describe("createOptionValue", () => {
  it("走 insert_option_value RPC 並帶對參數", async () => {
    state.rpcResult = "new-value-id";
    const result = await createOptionValue(TYPE_ID, {
      code: "emerald",
      label: "祖母綠",
      swatch_hex: "#1A6B54",
    });
    expect(result).toEqual({ ok: true, id: "new-value-id" });
    expect(rpcCalls[0]).toEqual({
      fn: "insert_option_value",
      args: {
        p_option_type_id: TYPE_ID,
        p_code: "emerald",
        p_label: "祖母綠",
        p_swatch_hex: "#1A6B54",
      },
    });
  });

  it("swatch_hex 為 null 時不帶 p_swatch_hex（RPC default null）", async () => {
    state.rpcResult = "new-value-id";
    await createOptionValue(TYPE_ID, {
      code: "emerald",
      label: "祖母綠",
      swatch_hex: null,
    });
    expect(rpcCalls[0]?.args).not.toHaveProperty("p_swatch_hex");
  });

  it("23505（code 衝突）查出既有值給友善訊息", async () => {
    state.rpcError = { code: "23505" };
    state.valueConflict = { label: "祖母綠" };
    const result = await createOptionValue(TYPE_ID, {
      code: "emerald",
      label: "重複的",
      swatch_hex: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("祖母綠");
  });
});

describe("updateOptionValue", () => {
  it("update payload 不含 code", async () => {
    const result = await updateOptionValue(VALUE_ID, {
      label: "新名稱",
      swatch_hex: null,
      // @ts-expect-error 模擬惡意多傳 code
      code: "hacked",
    });
    expect(result.ok).toBe(true);
    expect(updates("option_value")[0]?.values).not.toHaveProperty("code");
  });
});

describe("moveOptionValue", () => {
  it("走 move_option_value RPC 並帶對參數，revalidate 用 DB 的 option_type_id", async () => {
    state.rpcResult = "moved";
    const result = await moveOptionValue(VALUE_ID, "down");
    expect(result.ok).toBe(true);
    expect(rpcCalls[0]).toEqual({
      fn: "move_option_value",
      args: { p_option_value_id: VALUE_ID, p_direction: "down" },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/options/${TYPE_ID}`);
  });

  it("not_found 回友善訊息", async () => {
    state.rpcResult = "not_found";
    const result = await moveOptionValue(VALUE_ID, "up");
    expect(result.ok).toBe(false);
  });

  it("edge 視為成功且仍 revalidate（畫面可能是舊的）", async () => {
    state.rpcResult = "edge";
    const result = await moveOptionValue(VALUE_ID, "up");
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/options/${TYPE_ID}`);
  });
});

describe("deleteOptionValue", () => {
  it("有商品使用時擋下", async () => {
    state.povCount = 1;
    const result = await deleteOptionValue(VALUE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("隱藏");
  });

  it("刪除成功且有圖時刪 Storage 檔", async () => {
    state.valueDeleteResult = {
      image_path: "option-value/x/1.png",
      option_type_id: TYPE_ID,
    };
    const result = await deleteOptionValue(VALUE_ID);
    expect(result.ok).toBe(true);
    expect(deleteImageFiles).toHaveBeenCalledWith(["option-value/x/1.png"]);
  });

  it("無圖時不呼叫刪檔", async () => {
    const result = await deleteOptionValue(VALUE_ID);
    expect(result.ok).toBe(true);
    expect(deleteImageFiles).not.toHaveBeenCalled();
  });
});

describe("uploadOptionValueImage", () => {
  function buildFormData() {
    const formData = new FormData();
    formData.set("optionValueId", VALUE_ID);
    formData.set("file", makeFile());
    return formData;
  }

  it("上傳成功：無舊圖時 CAS 用 is(null)，不刪任何檔", async () => {
    uploadOptionValueImageFile.mockResolvedValue("option-value/x/new.png");
    const result = await uploadOptionValueImage(buildFormData());
    expect(result.ok).toBe(true);
    const update = updates("option_value")[0];
    expect(update?.values).toEqual({ image_path: "option-value/x/new.png" });
    expect(update?.is).toEqual([["image_path", null]]);
    expect(deleteImageFiles).not.toHaveBeenCalled();
  });

  it("換圖成功：CAS 比對舊路徑，成功後刪舊檔", async () => {
    state.valueCurrent = {
      image_path: "option-value/x/old.png",
      option_type_id: TYPE_ID,
    };
    uploadOptionValueImageFile.mockResolvedValue("option-value/x/new.png");
    const result = await uploadOptionValueImage(buildFormData());
    expect(result.ok).toBe(true);
    const update = updates("option_value")[0];
    expect(update?.eqs).toContainEqual([
      "image_path",
      "option-value/x/old.png",
    ]);
    expect(deleteImageFiles).toHaveBeenCalledWith(["option-value/x/old.png"]);
  });

  it("CAS 沒命中（並發換圖）：回滾新檔並回並發訊息", async () => {
    uploadOptionValueImageFile.mockResolvedValue("option-value/x/new.png");
    state.valueImageUpdateResult = null; // 0 列命中
    const result = await uploadOptionValueImage(buildFormData());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("重新整理");
    expect(deleteImageFiles).toHaveBeenCalledWith(["option-value/x/new.png"]);
  });

  it("DB 更新失敗：回滾新檔", async () => {
    uploadOptionValueImageFile.mockResolvedValue("option-value/x/new.png");
    state.valueImageUpdateError = { message: "db down" };
    const result = await uploadOptionValueImage(buildFormData());
    expect(result.ok).toBe(false);
    expect(deleteImageFiles).toHaveBeenCalledWith(["option-value/x/new.png"]);
  });

  it("找不到選項值時不上傳", async () => {
    state.valueCurrent = null;
    const result = await uploadOptionValueImage(buildFormData());
    expect(result.ok).toBe(false);
    expect(uploadOptionValueImageFile).not.toHaveBeenCalled();
  });
});

describe("removeOptionValueImage", () => {
  it("本來就沒圖：冪等成功且不動 DB", async () => {
    const result = await removeOptionValueImage(VALUE_ID);
    expect(result.ok).toBe(true);
    expect(updates("option_value")).toHaveLength(0);
  });

  it("移除成功後刪 Storage 檔", async () => {
    state.valueCurrent = {
      image_path: "option-value/x/old.png",
      option_type_id: TYPE_ID,
    };
    const result = await removeOptionValueImage(VALUE_ID);
    expect(result.ok).toBe(true);
    const update = updates("option_value")[0];
    expect(update?.values).toEqual({ image_path: null });
    expect(update?.eqs).toContainEqual([
      "image_path",
      "option-value/x/old.png",
    ]);
    expect(deleteImageFiles).toHaveBeenCalledWith(["option-value/x/old.png"]);
  });

  it("CAS 沒命中回並發訊息且不刪檔", async () => {
    state.valueCurrent = {
      image_path: "option-value/x/old.png",
      option_type_id: TYPE_ID,
    };
    state.valueImageUpdateResult = null;
    const result = await removeOptionValueImage(VALUE_ID);
    expect(result.ok).toBe(false);
    expect(deleteImageFiles).not.toHaveBeenCalled();
  });
});
