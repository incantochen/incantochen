"use server";

import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { getClientIp } from "@/lib/get-client-ip";
import { checkCustomInquiryRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  sendCustomInquiryConfirmation,
  sendCustomInquiryNotification,
} from "@/lib/email/custom-inquiry-notification";
import {
  customInquiryFormSchema,
  type CustomInquiryFormValues,
} from "@/lib/custom-inquiry/schema";

type ActionResult = { ok: true } | { ok: false; error: string };

// honeypot：表單額外帶一個對使用者隱藏的 website 欄位；正常人不會填，bot 會。
export type CustomInquiryInput = CustomInquiryFormValues & {
  website?: string;
};

export async function createCustomInquiry(
  input: CustomInquiryInput,
): Promise<ActionResult> {
  // 1. honeypot 命中：靜默丟棄——回成功讓 bot 以為送出，但不建紀錄、不寄信。
  if (input.website && input.website.trim() !== "") {
    return { ok: true };
  }

  // 2. 驗證（email 正規化、必填、長度、enum）
  const parsed = customInquiryFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "表單內容格式不正確",
    };
  }
  const values = parsed.data;
  const email = values.email.toLowerCase();

  // 3. 限流（IP + email，fail-open）——放在 DB 寫入前，被限流的請求不耗 DB。
  const ip = getClientIp(await headers());
  const withinLimit = await checkCustomInquiryRateLimit(ip, email);
  if (!withinLimit) {
    return { ok: false, error: "操作過於頻繁，請稍後再試" };
  }

  // 4. 建立詢問紀錄（deny-by-default，走 service role）
  const serviceRole = createServiceRoleClient();
  const { data: inserted, error } = await serviceRole
    .from("custom_inquiry")
    .insert({
      category: values.category,
      budget_band: values.budgetBand,
      idea: values.idea,
      email,
      phone: values.phone ?? null,
      preferred_time: values.preferredTime ?? null,
    })
    // 一次取回整列供寄信用，兩支寄信函式不再各自依 id 重查 DB（省 2 次 round-trip）。
    .select("id, category, budget_band, idea, email, phone, preferred_time")
    .single();

  // §6：SDK 錯誤必檢查——insert 失敗不可靜默當成功。
  if (error || !inserted) {
    return { ok: false, error: "送出失敗，請稍後再試" };
  }

  // 5. 通知店家 + 客人確認信。刻意 await（serverless 禁 fire-and-forget），各自
  //    try/catch 吞錯不擋送出（DB 已有紀錄，可人工補救）——但一律記 Sentry
  //    （§6：Sentry 必須覆蓋寄信的靜默失敗點），否則店家漏接高價值 lead 卻無告警。
  try {
    await sendCustomInquiryNotification(inserted);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { area: "custom-inquiry-email", kind: "owner-notification" },
      extra: { inquiryId: inserted.id },
    });
  }
  try {
    await sendCustomInquiryConfirmation(inserted);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { area: "custom-inquiry-email", kind: "customer-confirmation" },
      extra: { inquiryId: inserted.id },
    });
  }

  return { ok: true };
}
