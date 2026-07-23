import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

// 占位頁：服務條款（T36，⚖️律師審定後上線）。
export const metadata: Metadata = {
  title: "服務條款",
  alternates: { canonical: "/terms" },
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <ComingSoon
      eyebrow="Terms"
      title="服務條款"
      description="交易條款、客製品交期與七天鑑賞權益等說明整理中，上線前將由專業把關。"
    />
  );
}
