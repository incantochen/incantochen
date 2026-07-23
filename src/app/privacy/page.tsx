import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalPending, type LegalSection } from "@/components/legal-page";

// T36 隱私權政策。頁框與章節骨架（個資法應告知事項）已就緒；各節條文本體須
// 律師審定（CLAUDE.md §8「用詞以律師審定版為準，勿自行擬定」），以 <LegalPending />
// 佔位。條文定稿後替換並移除下方 metadata 的 robots noindex（見 TODO(T36-legal)）。
export const metadata: Metadata = {
  title: "隱私權政策",
  description:
    "incantochen（辰醉金閣）如何蒐集、使用、保護與刪除您的個人資料，以及您依個人資料保護法享有的權利。",
  alternates: { canonical: "/privacy" },
  // TODO(T36-legal): 條文經律師審定後改為 index: true。
  robots: { index: false, follow: true },
};

const sections: LegalSection[] = [
  { heading: "蒐集之目的", body: <LegalPending /> },
  { heading: "蒐集之個人資料類別", body: <LegalPending /> },
  { heading: "個人資料利用之期間、地區、對象及方式", body: <LegalPending /> },
  {
    heading: "當事人權利與行使方式",
    body: (
      <>
        <LegalPending />
        <p>
          如需查詢、更正或刪除個人資料，請透過{" "}
          <Link
            href="/contact"
            className="text-ink underline underline-offset-4 hover:text-secondary"
          >
            聯絡我們
          </Link>{" "}
          頁面提供的客服信箱提出，我們將依法處理。
        </p>
      </>
    ),
  },
  {
    heading: "個人資料之刪除與匿名化",
    // 技術機制為既定事實（決策 #17／T63 匿名化非實刪），惟正式用詞仍待律師審定。
    body: <LegalPending />,
  },
  { heading: "Cookie 與分析工具之使用", body: <LegalPending /> },
  { heading: "個人資料之安全維護", body: <LegalPending /> },
  { heading: "政策之修訂", body: <LegalPending /> },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="隱私權政策"
      intro="本政策說明 incantochen（辰醉金閣）如何蒐集、使用、保護與刪除您的個人資料，以及您依《個人資料保護法》享有的權利。"
      sections={sections}
      footnote="本頁條文正由專業人員審定中，定稿後將正式生效並標註更新日期。"
    />
  );
}
