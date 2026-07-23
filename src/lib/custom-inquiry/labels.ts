import type {
  CustomInquiryBudget,
  CustomInquiryCategory,
} from "@/lib/custom-inquiry/schema";

// 品項／預算帶 key→中文（單一出處：表單 chip 標籤與 email 顯示共用）。
export const CATEGORY_LABELS: Record<CustomInquiryCategory, string> = {
  ring: "戒指",
  earring: "耳環",
  bracelet: "手鍊",
  necklace: "項鍊",
  unsure: "還不確定",
};

export const BUDGET_LABELS: Record<CustomInquiryBudget, string> = {
  "2-3": "NT$ 2–3 萬",
  "3-5": "NT$ 3–5 萬",
  "5plus": "NT$ 5 萬以上",
  chat: "想先聊聊",
};
