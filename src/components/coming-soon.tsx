import Link from "next/link";
import { Button } from "@/components/ui/button";

// 未建頁的品牌占位：避免 footer／導覽連到 404。內容留給對應任務
// （全客製／T54 戒圍／T36 隱私權·條款／售後說明）上線時替換。
export function ComingSoon({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center px-6 py-24 text-center sm:py-32">
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="mt-4 font-heading text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.2] text-ink">
        {title}
      </h1>
      {description && (
        <p className="mt-4 max-w-[42ch] text-sm leading-relaxed text-ash">
          {description}
        </p>
      )}
      <div aria-hidden className="my-8 h-px w-16 bg-secondary opacity-50" />
      <p className="text-[11px] tracking-[0.22em] text-ash uppercase">
        內容整理中 · Coming Soon
      </p>
      <Button asChild variant="outline" size="sm" className="mt-8">
        <Link href="/">返回首頁</Link>
      </Button>
    </div>
  );
}
