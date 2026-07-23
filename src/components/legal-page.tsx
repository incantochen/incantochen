import type { ReactNode } from "react";

// T36 隱私／服務條款共用外殼。兩頁（/privacy、/terms）共用版型，各頁只提供
// 章節骨架與內文；條文本體須律師審定，未定者以 <LegalPending /> 佔位。
// 版式對齊 /contact、/custom（淺色 pagehead、金 eyebrow、serif 標題、灰內文）。

export type LegalSection = { heading: string; body: ReactNode };

// 尚未定稿的條文佔位：內文待律師審定版替換（grep LegalPending 找齊）。
export function LegalPending() {
  return (
    <p className="italic text-ash/60">（本節條文待律師審定後補上）</p>
  );
}

export function LegalPage({
  eyebrow,
  title,
  intro,
  sections,
  footnote,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  sections: LegalSection[];
  footnote?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[720px] px-6 py-10 sm:py-14">
      {/* 淺色 pagehead */}
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="mt-2 font-heading text-[34px] text-ink">{title}</h1>
        {intro && (
          <p className="mt-3 max-w-[56ch] text-sm leading-relaxed text-ash">
            {intro}
          </p>
        )}
      </div>

      <div className="mt-8 space-y-8 border-t border-border pt-8">
        {sections.map((section, index) => (
          <section key={section.heading}>
            <h2 className="font-heading text-lg text-ink">
              {index + 1}. {section.heading}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ash">
              {section.body}
            </div>
          </section>
        ))}
      </div>

      {footnote && (
        <p className="mt-10 border-t border-border pt-6 text-xs leading-relaxed text-ash/70">
          {footnote}
        </p>
      )}
    </div>
  );
}
