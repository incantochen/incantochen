import type { Metadata } from "next";
import { CustomInquiryForm } from "@/components/custom-inquiry-form";

// 全客製一對一訂製：MVP 只做預約／詢問表單（user-flow Flow 4），捕捉需求＋
// 通知店家、人工後續。全站 preview／本機 noindex 由 root layout 統一處理。
export const metadata: Metadata = {
  title: "預約訂製",
  description:
    "與 incantochen 一起打造完全屬於妳的設計。預約一對一全客製訂製，從選石、草圖到成品，慢慢來，只為妳一個人。",
  alternates: { canonical: "/custom" },
};

export default function CustomPage() {
  return (
    <>
      {/* HERO：綠底品牌敘事（對齊 wireframe custom.html） */}
      <section className="bg-primary-900 text-paper">
        <div className="mx-auto max-w-[680px] px-7 py-20 text-center sm:py-24">
          <div className="eyebrow">Custom · 預約訂製</div>
          <h1 className="mt-4 font-heading text-[clamp(1.75rem,3.8vw,2.5rem)] leading-[1.18] text-paper">
            獨一無二 — 從一顆寶石、一個念頭開始
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-paper/80 sm:text-base">
            與我們一起打造完全屬於妳的設計。預約一對一訂製，我們陪妳從選石、草圖到成品——慢慢來，只為妳一個人。
          </p>
        </div>
      </section>

      {/* 表單 */}
      <section className="mx-auto max-w-[680px] px-7 py-14 sm:py-20">
        <div className="rounded-xl border border-border bg-white p-6 sm:p-8">
          <CustomInquiryForm />
        </div>
      </section>
    </>
  );
}
