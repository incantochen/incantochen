import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

// 占位頁：售後說明（半客製售後政策，⚖️律師審定後上線）。
export const metadata: Metadata = {
  title: "售後說明",
  alternates: { canonical: "/after-sales" },
  robots: { index: false, follow: true },
};

export default function AfterSalesPage() {
  return (
    <ComingSoon
      eyebrow="After Sales"
      title="售後說明"
      description="保固、維修保養與退換說明整理中，正由專業把關用詞後上線。"
    />
  );
}
