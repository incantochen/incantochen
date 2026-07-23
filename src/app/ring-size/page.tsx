import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo/site-meta";
import { Breadcrumb } from "@/components/breadcrumb";
import { buildBreadcrumbJsonLd } from "@/lib/seo/breadcrumb-json-ld";
import { JsonLd } from "@/components/json-ld";

// T54 戒圍量法與尺寸對照（公開內容頁，IA §/ring-size）。
// 對照基準：本店戒圍 = 國際圍（台灣）系統（決策記於 decisions.csv；尚未正式
// 定義前以此頁為權威）。半客製為下單後訂製、尺寸可依需求製作，不限特定號數。
// 對照數值取自使用者提供的「常用戒指尺寸對照表」（Secret Summer Jewellery）＋
// 另一份 .md 交叉驗證，涵蓋國際圍 4–21；內周長由內徑 × π 計算（來源表只列內徑）。
const canonicalPath = "/ring-size";
const description =
  "戒圍怎麼量？提供兩種在家量測方法，與國際圍／公制圍／港圍／美圍／日圍／歐洲圍尺寸對照表（國際圍 4–21）。本店以國際圍（台灣）為基準，下單後專屬訂製、尺寸可依需求製作。";

export const metadata: Metadata = {
  title: "戒圍量法與尺寸對照",
  description,
  alternates: { canonical: canonicalPath },
  openGraph: pageOpenGraph({
    title: "戒圍量法與尺寸對照",
    description,
    url: canonicalPath,
  }),
};

// 國際圍（台灣）對照表，涵蓋 4–21。diameter＝內圍直徑(mm)（來源表數值）；
// circumference＝內周長(mm)＝diameter × π（四捨五入至 0.1）。半客製為下單後
// 專屬訂製、尺寸可依需求製作，故不標「可選/不可選」。
type SizeRow = {
  intl: number; // 國際圍
  diameter: number; // 內徑 mm
  metric: number; // 公制圍
  hk: string; // 港圍
  us: string; // 美圍
  jp: string; // 日圍
  eu: string; // 歐洲圍
};

const RAW_ROWS: SizeRow[] = [
  { intl: 4, diameter: 13.0, metric: 3, hk: "—", us: "—", jp: "1", eu: "—" },
  { intl: 5, diameter: 13.5, metric: 4, hk: "—", us: "—", jp: "3", eu: "—" },
  { intl: 6, diameter: 14.0, metric: 5, hk: "6", us: "3", jp: "4", eu: "48" },
  { intl: 7, diameter: 14.5, metric: 6, hk: "8", us: "3½", jp: "6", eu: "49" },
  { intl: 8, diameter: 15.0, metric: 7, hk: "9", us: "4", jp: "7", eu: "50" },
  { intl: 9, diameter: 15.5, metric: 8, hk: "10", us: "4¾", jp: "9", eu: "51" },
  { intl: 10, diameter: 16.0, metric: 9, hk: "12", us: "5½", jp: "10", eu: "52" },
  { intl: 11, diameter: 16.5, metric: 10, hk: "13", us: "6", jp: "12", eu: "53" },
  { intl: 12, diameter: 17.0, metric: 11, hk: "15", us: "6¾", jp: "13", eu: "54" },
  { intl: 13, diameter: 17.5, metric: 12, hk: "16", us: "7¼", jp: "15", eu: "55" },
  { intl: 14, diameter: 18.0, metric: 13, hk: "18", us: "8", jp: "16", eu: "56" },
  { intl: 15, diameter: 18.5, metric: 14, hk: "19", us: "8½", jp: "18", eu: "57" },
  { intl: 16, diameter: 19.0, metric: 15, hk: "20", us: "9", jp: "19", eu: "58" },
  { intl: 17, diameter: 19.5, metric: 16, hk: "22", us: "9¾", jp: "21", eu: "59" },
  { intl: 18, diameter: 20.0, metric: 17, hk: "23", us: "10¼", jp: "22", eu: "60" },
  { intl: 19, diameter: 20.5, metric: 18, hk: "25", us: "11", jp: "24", eu: "61" },
  { intl: 20, diameter: 21.0, metric: 19, hk: "26", us: "11½", jp: "25", eu: "62" },
  { intl: 21, diameter: 21.5, metric: 20, hk: "—", us: "12", jp: "27", eu: "63" },
];

// 內周長 = 內徑 × π（來源表只列內徑），單一出處計算避免手抄失同步。
const SIZE_ROWS = RAW_ROWS.map((row) => ({
  ...row,
  circumference: Math.round(row.diameter * Math.PI * 10) / 10,
}));

const MEASURE_TIPS = [
  "傍晚量測較準——手指在一天中會略微腫脹，早上偏細、傍晚偏粗。",
  "避開太冷的環境與剛運動後，體溫與氣溫適中時量測。",
  "指節明顯較粗者，指根與指節各量一次、取兩者中間值（戒指要能通過指節）。",
  "寬版戒戴起來會比細版更緊，寬版可考慮進半號到一號。",
  "慣用手同一根手指通常略粗，請量實際配戴的那隻手。",
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 text-[11px] tracking-[0.28em] text-secondary-400 uppercase">
      {children}
    </div>
  );
}

export default function RingSizeGuidePage() {
  const breadcrumbItems = [
    { label: "首頁", href: "/" },
    { label: "戒圍量法與尺寸對照" },
  ];

  return (
    <div className="mx-auto max-w-[880px] px-6 py-10">
      <JsonLd data={buildBreadcrumbJsonLd(breadcrumbItems)} />
      <Breadcrumb items={breadcrumbItems} />

      {/* Hero */}
      <header className="mt-8">
        <SectionLabel>Ring Size Guide</SectionLabel>
        <h1 className="font-heading text-[34px] leading-tight text-ink">
          戒圍量法與尺寸對照
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ash">
          每只戒指皆為下單後專屬訂製，選對尺寸能省去改圈或重做。以下提供兩種在家量測方法與國際圍對照表；若介於兩個尺寸之間，建議選<strong className="text-ink">偏大</strong>的一號，或
          <Link href="/custom" className="text-primary underline underline-offset-2">
            洽詢客服
          </Link>
          協助。
        </p>
      </header>

      <hr className="my-9 h-px border-0 bg-secondary-400/40" />

      {/* 量法 */}
      <section>
        <SectionLabel>How to measure</SectionLabel>
        <h2 className="font-heading text-2xl text-ink">兩種量測方法</h2>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-white p-5">
            <div className="text-sm font-medium text-primary">方法 A · 量現有戒指</div>
            <p className="mt-1 text-[13px] text-ash">最準，適合已有合適戒指者。</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-sm text-ink">
              <li>挑一只戴起來剛好、同一根手指的戒指。</li>
              <li>用尺量它的<strong>內圈直徑</strong>（內緣到內緣，mm）。</li>
              <li>對照下表「內徑」欄，找到對應戒圍。</li>
            </ol>
          </div>

          <div className="rounded-lg border border-border bg-white p-5">
            <div className="text-sm font-medium text-primary">方法 B · 量手指周長</div>
            <p className="mt-1 text-[13px] text-ash">手邊沒戒指時用紙條或細線。</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-sm text-ink">
              <li>用紙條／細線繞手指最粗處（通常是指節）一圈。</li>
              <li>標記交會點，攤平量出長度（<strong>內周長</strong>，mm）。</li>
              <li>對照下表「內周長」欄，找到對應戒圍。</li>
            </ol>
          </div>
        </div>
      </section>

      <hr className="my-9 h-px border-0 bg-secondary-400/40" />

      {/* 對照表 */}
      <section>
        <SectionLabel>Size chart</SectionLabel>
        <h2 className="font-heading text-2xl text-ink">尺寸對照表</h2>
        <p className="mt-2 text-[13px] text-ash">
          本店以<strong className="text-ink">國際圍（台灣）</strong>為基準（涵蓋 4–21）。半客製為下單後專屬訂製，尺寸可依需求製作。
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] tracking-[0.06em] text-ash uppercase">
                <th className="py-2.5 pr-3 font-medium">國際圍</th>
                <th className="py-2.5 pr-3 font-medium">內徑 (mm)</th>
                <th className="py-2.5 pr-3 font-medium">內周長 (mm)</th>
                <th className="py-2.5 pr-3 font-medium">公制圍</th>
                <th className="py-2.5 pr-3 font-medium">港圍</th>
                <th className="py-2.5 pr-3 font-medium">美圍</th>
                <th className="py-2.5 pr-3 font-medium">日圍</th>
                <th className="py-2.5 pr-3 font-medium">歐洲圍</th>
              </tr>
            </thead>
            <tbody className="[font-variant-numeric:tabular-nums]">
              {SIZE_ROWS.map((row) => (
                <tr key={row.intl} className="border-b border-border">
                  <td className="py-2.5 pr-3 font-medium text-ink whitespace-nowrap">
                    #{String(row.intl).padStart(2, "0")}
                  </td>
                  <td className="py-2.5 pr-3 text-ink">{row.diameter.toFixed(1)}</td>
                  <td className="py-2.5 pr-3 text-ink">{row.circumference.toFixed(1)}</td>
                  <td className="py-2.5 pr-3 text-ash">{row.metric}</td>
                  <td className="py-2.5 pr-3 text-ash">{row.hk}</td>
                  <td className="py-2.5 pr-3 text-ash">{row.us}</td>
                  <td className="py-2.5 pr-3 text-ash">{row.jp}</td>
                  <td className="py-2.5 pr-3 text-ash">{row.eu}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-ash">
          數值為參考值，不同品牌略有差異；內周長 ≈ 內徑 × π。
        </p>
      </section>

      <hr className="my-9 h-px border-0 bg-secondary-400/40" />

      {/* 小提醒 */}
      <section>
        <SectionLabel>Tips</SectionLabel>
        <h2 className="font-heading text-2xl text-ink">量測小提醒</h2>
        <ul className="mt-4 space-y-2.5">
          {MEASURE_TIPS.map((tip) => (
            <li key={tip} className="flex gap-2.5 text-sm leading-6 text-ink">
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-secondary-400" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <div className="mt-10 rounded-lg border border-border bg-cloud px-5 py-6 text-center">
        <p className="text-sm text-ink">量好尺寸了嗎？挑選你的戒指，於配置器選擇戒圍。</p>
        <Link
          href="/collections/ring"
          className="mt-4 inline-flex rounded-[2px] bg-primary px-8 py-3.5 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary-700"
        >
          瀏覽戒指
        </Link>
      </div>
    </div>
  );
}
