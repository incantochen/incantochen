import { describe, expect, it } from "vitest";
import { adminSupportCaseSchema, supportRequestFormSchema } from "./schema";

describe("supportRequestFormSchema", () => {
  it("trim 後為空字串擋下", () => {
    expect(
      supportRequestFormSchema.safeParse({ description: "   " }).success,
    ).toBe(false);
  });

  it("小於 10 字擋下", () => {
    expect(
      supportRequestFormSchema.safeParse({ description: "太短了" }).success,
    ).toBe(false);
  });

  it("恰好 10 字通過（邊界）", () => {
    expect(
      supportRequestFormSchema.safeParse({
        description: "一二三四五六七八九十",
      }).success,
    ).toBe(true);
  });

  it("恰好 2000 字通過（邊界）", () => {
    expect(
      supportRequestFormSchema.safeParse({ description: "字".repeat(2000) })
        .success,
    ).toBe(true);
  });

  it("超過 2000 字擋下", () => {
    expect(
      supportRequestFormSchema.safeParse({ description: "字".repeat(2001) })
        .success,
    ).toBe(false);
  });
});

describe("adminSupportCaseSchema", () => {
  it("合法兩類型皆通過", () => {
    for (const requestType of [
      "return_defect",
      "repair_maintenance",
    ] as const) {
      expect(
        adminSupportCaseSchema.safeParse({
          requestType,
          description: "一二三四五六七八九十",
        }).success,
      ).toBe(true);
    }
  });

  it("非法類型擋下", () => {
    expect(
      adminSupportCaseSchema.safeParse({
        requestType: "not-a-type",
        description: "一二三四五六七八九十",
      }).success,
    ).toBe(false);
  });

  it("缺 requestType 擋下", () => {
    expect(
      adminSupportCaseSchema.safeParse({ description: "一二三四五六七八九十" })
        .success,
    ).toBe(false);
  });
});
