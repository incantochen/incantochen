import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

// 占位頁：隱私權政策（T36，⚖️律師審定後上線）。
export const metadata: Metadata = {
  title: "隱私權政策",
  alternates: { canonical: "/privacy" },
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <ComingSoon
      eyebrow="Privacy"
      title="隱私權政策"
      description="個資蒐集、使用與刪除方式的完整政策整理中，上線前將由專業把關。"
    />
  );
}
