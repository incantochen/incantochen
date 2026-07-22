import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";

// 占位頁：戒圍尺寸對照／量法說明（T54）。
export const metadata: Metadata = {
  title: "戒圍量法",
  alternates: { canonical: "/ring-size" },
  robots: { index: false, follow: true },
};

export default function RingSizePage() {
  return (
    <ComingSoon
      eyebrow="Ring Size"
      title="戒圍量法"
      description="戒圍尺寸對照表與在家量測方法整理中，協助妳選對尺寸、降低重做成本。"
    />
  );
}
