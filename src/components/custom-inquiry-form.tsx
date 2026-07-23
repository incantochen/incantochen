"use client";

import { useRef, useState, useTransition } from "react";
import { createCustomInquiry } from "@/app/custom/actions";
import {
  BUDGET_VALUES,
  CATEGORY_VALUES,
  customInquiryFormSchema,
  type CustomInquiryBudget,
  type CustomInquiryCategory,
} from "@/lib/custom-inquiry/schema";
import { BUDGET_LABELS, CATEGORY_LABELS } from "@/lib/custom-inquiry/labels";

const fieldLabel = "block text-[11px] tracking-[0.16em] text-ash uppercase";
const inputClass =
  "mt-2 w-full rounded-lg border border-border bg-white px-3.5 py-3 text-sm outline-none focus:border-primary";

function chipClass(selected: boolean) {
  return [
    "rounded-lg border px-4 py-2.5 text-sm transition",
    selected
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-white text-ink hover:border-ash",
  ].join(" ");
}

export function CustomInquiryForm() {
  const [category, setCategory] = useState<CustomInquiryCategory | null>(null);
  const [budgetBand, setBudgetBand] = useState<CustomInquiryBudget | null>(
    null,
  );
  const [idea, setIdea] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  // 同步防重入：isPending 是非同步狀態，同一 render frame 內連點兩下時閉包仍讀到
  // 舊值 false 而放行第二次提交（→ 兩筆紀錄＋四封信）。用 ref 同步鎖住。
  const submittingRef = useRef(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    setError(null);

    const candidate = {
      category,
      budgetBand,
      idea,
      email,
      phone,
      preferredTime,
    };
    const result = customInquiryFormSchema.safeParse(candidate);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "請確認表單內容");
      return;
    }

    submittingRef.current = true;
    startTransition(async () => {
      try {
        const res = await createCustomInquiry({ ...result.data, website });
        if (res.ok) {
          setSuccess(true);
        } else {
          setError(res.error);
        }
      } catch {
        // action reject（網路中斷／伺服器例外，非回傳 ActionResult）時仍給回饋，
        // 不讓使用者卡在「按了沒反應」。
        setError("送出失敗，請稍後再試");
      } finally {
        submittingRef.current = false;
      }
    });
  }

  if (success) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/10 px-5 py-8 text-center text-success">
        <p className="text-base">已收到，將盡快與妳聯繫。</p>
        <p className="mt-2 text-sm text-success/80">
          我們會盡快以 Email 與妳聯繫；屆時如需補充，直接回覆信件即可。
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className={fieldLabel}>想訂製的品項</label>
        <div className="mt-2 flex flex-wrap gap-2.5">
          {CATEGORY_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={chipClass(category === value)}
            >
              {CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={fieldLabel}>預算範圍</label>
        <div className="mt-2 flex flex-wrap gap-2.5">
          {BUDGET_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setBudgetBand(value)}
              className={chipClass(budgetBand === value)}
            >
              {BUDGET_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={fieldLabel} htmlFor="ci-idea">
          妳的想法
        </label>
        <textarea
          id="ci-idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={4}
          className={inputClass}
          placeholder="想要的寶石、風格、配戴場合，或任何參考方向…"
        />
      </div>

      <div>
        <label className={fieldLabel} htmlFor="ci-email">
          Email（必填）
        </label>
        <input
          id="ci-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="妳的 Email"
          autoComplete="email"
        />
      </div>

      <div>
        <label className={fieldLabel} htmlFor="ci-phone">
          電話（選填）
        </label>
        <input
          id="ci-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
          placeholder="方便聯絡的電話"
          autoComplete="tel"
        />
      </div>

      <div>
        <label className={fieldLabel} htmlFor="ci-time">
          方便聯絡時段（選填）
        </label>
        <input
          id="ci-time"
          value={preferredTime}
          onChange={(e) => setPreferredTime(e.target.value)}
          className={inputClass}
          placeholder="例：平日晚上"
        />
      </div>

      {/* honeypot：對使用者隱藏，naive bot 會填 → action 端靜默丟棄。
          用 off-screen 定位（非 display:none）＋非語意的 id/name/label＋
          autoComplete off，避免密碼管理員／瀏覽器 autofill 誤填而丟掉合法預約
          （欄位名刻意不用 website/email/company 等 autofill 會辨識的 token）。 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label htmlFor="ci-hp">此欄位請保持空白</label>
        <input
          id="ci-hp"
          name="ci-hp"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase disabled:opacity-50"
      >
        {isPending ? "送出中…" : "送出預約"}
      </button>
      <p className="text-center text-sm text-ash">送出後我們會盡快與妳聯繫。</p>
    </form>
  );
}
