import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

// T61 賣家資訊揭露＋聯絡頁。頁框與品牌 token 已就緒；賣家名稱／負責人／統編／
// 地址／客服信箱已填實值，僅客服電話與客服時間以「（待補）」佔位。補齊後移除
// 下方 metadata 的 robots noindex 開放索引（見 TODO(T61-facts)）。
export const metadata: Metadata = {
  title: "聯絡我們",
  description:
    "incantochen（辰醉金閣）賣家資訊、客服聯絡方式與退換貨政策說明。半客製彩色寶石珠寶，有問題歡迎與我們聯繫。",
  alternates: { canonical: "/contact" },
  // TODO(T61-facts): 下列賣家法定事實填妥後，改為 index: true 開放索引。
  robots: { index: false, follow: true },
};

// 尚未確認的法定事實佔位；填實值時直接替換字串即可（grep TODO(T61-facts)）。
const TODO = "（待補）";

// 通訊交易應載明事項（消保法第 18 條、通訊交易解除權合理例外事由辦法）——
// 賣家身分與聯絡方式揭露。value 為 TODO 者代表事實待使用者確認。
const disclosures: { term: string; value: ReactNode }[] = [
  { term: "賣家名稱", value: "辰醉金閣（incantochen）" },
  { term: "負責人", value: "樂小辰" },
  { term: "營業登記／統一編號", value: "85634292" },
  { term: "營業地址", value: "台北市承德路一段 400 號" },
  {
    term: "客服信箱",
    value: (
      <a
        href="mailto:incantochen@gmail.com"
        className="text-ink underline underline-offset-4 hover:text-secondary"
      >
        incantochen@gmail.com
      </a>
    ),
  },
  // TODO(T61-facts): 客服電話與客服時間待補；補齊後移除 metadata robots noindex。
  { term: "客服電話", value: TODO },
  { term: "客服時間", value: TODO },
];

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-[680px] px-6 py-10 sm:py-14">
      {/* 淺色 pagehead，與 /custom、/collections 一致 */}
      <div>
        <div className="eyebrow">Contact</div>
        <h1 className="mt-2 font-heading text-[34px] text-ink">聯絡我們</h1>
        <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-ash">
          incantochen（辰醉金閣）為彩色寶石為主角的半客製珠寶品牌。訂製、訂單或商品有任何問題，歡迎透過下列方式與我們聯繫。
        </p>
      </div>

      {/* 賣家資訊揭露（通訊交易應載明事項） */}
      <section className="mt-8 border-t border-border pt-8">
        <h2 className="font-heading text-lg text-ink">賣家資訊</h2>
        <dl className="mt-4 divide-y divide-border/70">
          {disclosures.map(({ term, value }) => (
            <div
              key={term}
              className="grid grid-cols-[7.5rem_1fr] gap-4 py-3 sm:grid-cols-[9rem_1fr]"
            >
              <dt className="text-sm text-ash">{term}</dt>
              <dd
                className={
                  value === TODO
                    ? "text-sm text-ash/60 italic"
                    : "text-sm text-ink"
                }
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 退換貨與售後政策（連向既有頁面，避免重複維護條文本體） */}
      <section className="mt-8 border-t border-border pt-8">
        <h2 className="font-heading text-lg text-ink">退換貨與售後政策</h2>
        <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-ash">
          本站商品多為下單後訂製之半客製品。退換貨權益、瑕疵處理與交期說明，詳見下列頁面：
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          <li>
            <Link href="/after-sales" className="text-ink underline underline-offset-4 hover:text-secondary">
              退換與售後說明
            </Link>
          </li>
          <li>
            <Link href="/terms" className="text-ink underline underline-offset-4 hover:text-secondary">
              服務條款（含客製品交期與鑑賞權益）
            </Link>
          </li>
          <li>
            <Link href="/privacy" className="text-ink underline underline-offset-4 hover:text-secondary">
              隱私權政策
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
