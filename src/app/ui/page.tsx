import { Button } from "@/components/ui/button"

// title.absolute：跳過 root layout 的「%s｜incantochen」template（此頁自帶
// 品牌名，套 template 會變成品牌名重複）。/ui 為開發用樣式對照頁。
export const metadata = { title: { absolute: "UI Kit — incantochen" } }

function Section({ title, dark = false, children }: { title: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <section className={dark ? "bg-primary px-10 py-12" : "px-10 py-12 border-b border-stone"}>
      <p className={`eyebrow mb-8 ${dark ? "text-secondary" : ""}`}>{title}</p>
      {children}
    </section>
  )
}

function Swatch({ name, hex, className }: { name: string; hex: string; className: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-12 w-24 rounded ${className}`} />
      <span className="text-[11px] text-ink/70">{name}</span>
      <span className="text-[10px] text-ash font-mono">{hex}</span>
    </div>
  )
}

export default function UIPage() {
  return (
    <main className="max-w-3xl mx-auto divide-y divide-stone">

      {/* 頁頭 */}
      <div className="px-10 py-16">
        <p className="eyebrow mb-3">incantochen</p>
        <h1 className="font-heading text-3xl text-ink">UI Kit</h1>
        <p className="mt-2 text-sm text-ash">品牌元件展示頁 — 僅限開發使用</p>
      </div>

      {/* Eyebrow */}
      <Section title="Eyebrow">
        <div className="flex flex-col gap-4">
          <p className="eyebrow">Selected Pieces</p>
          <p className="eyebrow">Custom · 客製訂製</p>
          <p className="eyebrow">Quiet Luxury</p>
          <p className="text-xs text-ash mt-2">class: <code className="font-mono bg-cloud px-1 rounded">.eyebrow</code> — 11px / weight 500 / tracking .34em / uppercase / gold</p>
        </div>
      </Section>

      {/* 按鈕 — 淺底 */}
      <Section title="Button — 淺底">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="solid">加入購物袋</Button>
          <Button variant="outline">所有產品</Button>
          <Button variant="solid" size="sm">小尺寸 Solid</Button>
          <Button variant="outline" size="sm">小尺寸 Outline</Button>
          <Button variant="destructive">刪除</Button>
          <Button variant="link">文字連結</Button>
        </div>
      </Section>

      {/* 按鈕 — 深底 */}
      <Section title="Button — 深底" dark>
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="gold">預約訂製</Button>
          <Button variant="ghost">探索系列</Button>
          <Button variant="gold" size="sm">小尺寸 Gold</Button>
          <Button variant="ghost" size="sm">小尺寸 Ghost</Button>
        </div>
      </Section>

      {/* Icon 按鈕 */}
      <Section title="Button — Icon">
        <div className="flex items-center gap-4">
          <Button variant="solid" size="icon" aria-label="加入">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>
          </Button>
          <Button variant="outline" size="icon" aria-label="搜尋">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </Button>
          <Button variant="ghost" size="icon" className="bg-primary" aria-label="關閉">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </Button>
        </div>
      </Section>

      {/* 色票 */}
      <Section title="Color Tokens">
        <div className="flex flex-col gap-8">
          <div>
            <p className="text-xs text-ash mb-4 uppercase tracking-widest">Primary — Emerald</p>
            <div className="flex flex-wrap gap-4">
              <Swatch name="50" hex="#EAF1EE" className="bg-primary-50 border border-stone" />
              <Swatch name="100" hex="#CADBD4" className="bg-primary-100" />
              <Swatch name="300" hex="#6E9A8B" className="bg-primary-300" />
              <Swatch name="600" hex="#063B2F" className="bg-primary-600" />
              <Swatch name="700" hex="#052E25" className="bg-primary-700" />
              <Swatch name="900" hex="#021712" className="bg-primary-900" />
            </div>
          </div>
          <div>
            <p className="text-xs text-ash mb-4 uppercase tracking-widest">Secondary — Gold</p>
            <div className="flex flex-wrap gap-4">
              <Swatch name="50" hex="#F7F1E4" className="bg-secondary-50 border border-stone" />
              <Swatch name="300" hex="#D0B074" className="bg-secondary-300" />
              <Swatch name="400" hex="#C5A059" className="bg-secondary-400" />
              <Swatch name="500" hex="#A9863F" className="bg-secondary-500" />
              <Swatch name="900" hex="#241C0C" className="bg-secondary-900" />
            </div>
          </div>
          <div>
            <p className="text-xs text-ash mb-4 uppercase tracking-widest">Neutrals</p>
            <div className="flex flex-wrap gap-4">
              <Swatch name="Paper" hex="#FAF9F6" className="bg-paper border border-stone" />
              <Swatch name="Cloud" hex="#F1EFEA" className="bg-cloud border border-stone" />
              <Swatch name="Stone" hex="#D9D5CC" className="bg-stone" />
              <Swatch name="Ash" hex="#9A968D" className="bg-ash" />
              <Swatch name="Ink" hex="#1A1A1A" className="bg-ink" />
              <Swatch name="Espresso" hex="#38260B" className="bg-espresso" />
            </div>
          </div>
          <div>
            <p className="text-xs text-ash mb-4 uppercase tracking-widest">Semantic</p>
            <div className="flex flex-wrap gap-4">
              <Swatch name="Success" hex="#1C7A4D" className="bg-success" />
              <Swatch name="Error" hex="#B23A38" className="bg-destructive" />
              <Swatch name="Warning" hex="#C5862F" className="bg-warning" />
              <Swatch name="Info" hex="#3E6C8C" className="bg-info" />
            </div>
          </div>
        </div>
      </Section>

      {/* 字體 */}
      <Section title="Typography">
        <div className="flex flex-col gap-6">
          <div>
            <p className="eyebrow mb-3">Heading — EB Garamond + Noto Serif TC</p>
            <p className="font-heading text-4xl text-ink">著迷的開始</p>
            <p className="font-heading text-2xl text-ink mt-2">The Art of Colour</p>
            <p className="font-heading text-lg text-ink mt-1">彩色寶石，靜默有力</p>
          </div>
          <div>
            <p className="eyebrow mb-3">Body — Hanken Grotesk + Noto Sans TC</p>
            <p className="font-sans text-base text-ink leading-relaxed">Incantochen 以天然彩色寶石與細膩工藝，打造能融入日常、卻令人回味的珠寶。沒有浮誇的設計語言，只有經得起時間考驗的比例、材質與細節。</p>
            <p className="font-sans text-sm text-ash mt-2 leading-relaxed">每件作品皆可依個人喜好選擇寶石、金屬與尺寸，於下單後專屬訂製。</p>
          </div>
        </div>
      </Section>

    </main>
  )
}
