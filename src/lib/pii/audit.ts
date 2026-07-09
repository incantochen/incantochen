import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * PII 存取稽核（T64／T80）。落表 pii_access_log（決策 #13），取代 stdout log。
 * 寫入失敗一律 throw（不吞錯）：呼叫端須 await 並 fail closed，不可在稽核
 * 寫不進去的情況下仍回傳完整個資。
 */
export async function logPiiAccess(entry: {
  actorId: string;
  actorEmail: string;
  orderId: string;
  fields: string[];
}) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("pii_access_log").insert({
    actor_id: entry.actorId,
    actor_email: entry.actorEmail,
    order_id: entry.orderId,
    fields: entry.fields,
  });

  if (error) throw new Error(`PII 稽核 log 寫入失敗：${error.message}`);
}
