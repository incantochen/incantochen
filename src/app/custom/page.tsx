import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

// 占位頁：全客製一對一訂製（Phase 3）。noindex 避免空頁被索引。
export const metadata: Metadata = {
  title: "預約訂製",
  alternates: { canonical: "/custom" },
  robots: { index: false, follow: true },
};

export default function CustomPage() {
  return (
    <ComingSoon
      eyebrow="Custom"
      title="預約訂製"
      description="全客製一對一訂製服務籌備中。從選石、草圖到成品，慢慢來，只為妳一個人——敬請期待。"
    />
  );
}
