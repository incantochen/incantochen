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
    <div className="mx-auto max-w-[680px] px-6 py-10 sm:py-14">
      {/* 淺色 pagehead，與 /collections 一致（paper 底、金 eyebrow、serif 標題、灰副標） */}
      <div>
        <div className="eyebrow">Custom</div>
        <h1 className="mt-2 font-heading text-[34px] text-ink">預約訂製</h1>
        <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-ash">
          與我們一起打造完全屬於妳的設計。預約一對一全客製訂製，從選石、草圖到成品——慢慢來，只為妳一個人。
        </p>
      </div>

      <div className="mt-8 border-t border-border pt-8">
        <CustomInquiryForm />
      </div>
    </div>
  );
}
