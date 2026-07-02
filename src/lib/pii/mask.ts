/**
 * PII 遮罩純函式（T64）。
 * 後台預設只顯示遮罩後的個資，完整值須經 revealOrderPii（含存取稽核 log）取得。
 * 遮罩只是顯示層防護（螢幕分享／截圖／肩窺），不是加密。
 */

const MASK = "***";

/** 手機／市話遮罩：保留前 4 碼與後 3 碼，如 0912345678 → 0912-***-678 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return MASK;
  return `${digits.slice(0, 4)}-${MASK}-${digits.slice(-3)}`;
}

/** Email 遮罩：local part 保留前 2 字元，網域完整保留，如 fishead02290@gmail.com → fi***@gmail.com */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.indexOf("@");
  if (at <= 0) return MASK;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}${MASK}${domain}`;
}

/** 姓名遮罩：保留首字，3 字以上另保留末字，如 王小明 → 王○明、陳美 → 陳○ */
export function maskName(name: string | null | undefined): string {
  if (!name) return "—";
  const chars = [...name.trim()];
  if (chars.length <= 1) return chars.join("");
  if (chars.length === 2) return `${chars[0]}○`;
  return `${chars[0]}${"○".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 地址遮罩：保留前 6 字元（約至縣市＋行政區），其餘遮蔽，如 台北市大安區信義路四段1號 → 台北市大安區*** */
export function maskAddress(address: string | null | undefined): string {
  if (!address) return "—";
  const trimmed = address.trim();
  if ([...trimmed].length <= 6) return MASK;
  return `${[...trimmed].slice(0, 6).join("")}${MASK}`;
}
