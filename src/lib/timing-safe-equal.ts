import "server-only";

import { createHash, timingSafeEqual } from "crypto";

// 常數時間字串比對的單一出處（原本 cron／CheckMacValue／order-access-token
// 各手刻一份「Buffer.from 兩邊→長度不等 return false→timingSafeEqual」）。
// 先各自 sha256 成定長 digest 再比：兩邊長度永遠相等（免長度分支）、且
// digest 長度固定，比對耗時不洩漏原字串長度——cron 的 `Bearer ${CRON_SECRET}`
// 這種「長度本身即秘密」的情境才不會被計時側錄推出 secret 長度。
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
