import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

// 占位頁：聯絡我們。
export const metadata: Metadata = {
  title: "聯絡我們",
  alternates: { canonical: "/contact" },
  robots: { index: false, follow: true },
};

export default function ContactPage() {
  return (
    <ComingSoon
      eyebrow="Contact"
      title="聯絡我們"
      description="客服聯絡方式整理中，敬請期待。"
    />
  );
}
