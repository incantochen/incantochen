import { describe, expect, it } from "vitest";
import { maskAddress, maskEmail, maskName, maskPhone } from "./mask";

describe("maskPhone", () => {
  it("遮罩台灣手機號碼：保留前 4 後 3", () => {
    expect(maskPhone("0912345678")).toBe("0912-***-678");
  });

  it("先移除非數字字元再遮罩", () => {
    expect(maskPhone("0912-345-678")).toBe("0912-***-678");
    expect(maskPhone("+886 912 345 678")).toBe("8869-***-678");
  });

  it("過短號碼整串遮罩，不洩漏部分數字", () => {
    expect(maskPhone("1234567")).toBe("***");
  });

  it("空值回退為 —", () => {
    expect(maskPhone(null)).toBe("—");
    expect(maskPhone("")).toBe("—");
  });
});

describe("maskEmail", () => {
  it("local part 保留前 2 字元，網域完整", () => {
    expect(maskEmail("fishead02290@gmail.com")).toBe("fi***@gmail.com");
  });

  it("local part 只有 1–2 字元時只保留 1 字元", () => {
    expect(maskEmail("ab@example.com")).toBe("a***@example.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });

  it("格式不像 email 時整串遮罩", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });

  it("空值回退為 —", () => {
    expect(maskEmail(null)).toBe("—");
  });
});

describe("maskName", () => {
  it("三字中文名保留首末字", () => {
    expect(maskName("王小明")).toBe("王○明");
  });

  it("兩字名只保留首字", () => {
    expect(maskName("陳美")).toBe("陳○");
  });

  it("四字以上中間全遮", () => {
    expect(maskName("歐陽小明")).toBe("歐○○明");
  });

  it("單字名原樣保留", () => {
    expect(maskName("王")).toBe("王");
  });

  it("空值回退為 —", () => {
    expect(maskName(null)).toBe("—");
    expect(maskName("")).toBe("—");
  });
});

describe("maskAddress", () => {
  it("保留前 6 字元（縣市＋行政區）", () => {
    expect(maskAddress("台北市大安區信義路四段1號")).toBe("台北市大安區***");
  });

  it("過短地址整串遮罩", () => {
    expect(maskAddress("台北市")).toBe("***");
  });

  it("空值回退為 —", () => {
    expect(maskAddress(null)).toBe("—");
  });
});
