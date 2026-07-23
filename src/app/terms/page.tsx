import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalPending, type LegalSection } from "@/components/legal-page";

// T36 服務條款。頁框與章節骨架已就緒；條文本體（尤其七天鑑賞期客製例外）須
// 律師審定（CLAUDE.md §8「用詞以律師審定版為準，勿自行擬定」），以 <LegalPending />
// 佔位。條文定稿後替換並移除下方 metadata 的 robots noindex（見 TODO(T36-legal)）。
export const metadata: Metadata = {
  title: "服務條款",
  description:
    "incantochen（辰醉金閣）交易條款：下單付款、半客製品交期、七天鑑賞期例外、退換貨與售後權益等說明。",
  alternates: { canonical: "/terms" },
  // TODO(T36-legal): 條文經律師審定後改為 index: true。
  robots: { index: false, follow: true },
};

const sections: LegalSection[] = [
  {
    heading: "服務範圍與賣家資訊",
    body: (
      <>
        <LegalPending />
        <p>
          賣家名稱、統一編號與聯絡方式詳見{" "}
          <Link
            href="/contact"
            className="text-ink underline underline-offset-4 hover:text-secondary"
          >
            聯絡我們
          </Link>{" "}
          頁面。
        </p>
      </>
    ),
  },
  { heading: "商品說明與價格", body: <LegalPending /> },
  { heading: "下單、付款與訂單成立", body: <LegalPending /> },
  { heading: "半客製品之訂製與交期告知", body: <LegalPending /> },
  {
    // 半客製主張法定客製品、無七天鑑賞退（業務拍板 2026-07-02）；正式用詞待律師。
    heading: "七天鑑賞期之例外（客製化商品）",
    body: <LegalPending />,
  },
  {
    heading: "退換貨、瑕疵處理與售後",
    body: (
      <>
        <LegalPending />
        <p>
          售後與退換貨方式另見{" "}
          <Link
            href="/after-sales"
            className="text-ink underline underline-offset-4 hover:text-secondary"
          >
            退換與售後說明
          </Link>
          。
        </p>
      </>
    ),
  },
  { heading: "智慧財產權", body: <LegalPending /> },
  { heading: "責任限制", body: <LegalPending /> },
  { heading: "準據法與管轄法院", body: <LegalPending /> },
  { heading: "條款之修訂", body: <LegalPending /> },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="服務條款"
      intro="本頁為 incantochen（辰醉金閣）購買半客製珠寶商品之服務條款。完整條文正由專業人員審定中，定稿後將正式生效。"
      sections={sections}
      footnote="本頁條文正由專業人員審定中，定稿後將正式生效並標註更新日期。"
    />
  );
}
