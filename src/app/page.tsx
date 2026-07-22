import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/product-card";
import { getFeaturedProducts } from "@/lib/product/featured-products";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// 首頁精選最多展示這麼多件；MVP 目錄規模小，超出再考慮分頁。
const FEATURED_LIMIT = 4;

export default async function Home() {
  const featured = await getFeaturedProducts(FEATURED_LIMIT);

  return (
    <>
      {/* ── Hero：滿版深色攝影＋左側金線 signature（brand-guide §8）──── */}
      <section className="relative isolate flex min-h-[600px] overflow-hidden bg-primary text-paper sm:min-h-[680px] md:min-h-[760px]">
        {/* 主視覺：模特在右、左半深色留白 → object-right 保住主體、文字壓左 */}
        <Image
          src="/brand/hero.jpg"
          alt="配戴 incantochen 祖母綠項鍊與耳環的女子"
          fill
          priority
          sizes="100vw"
          className="-z-20 object-cover object-right"
        />
        {/* 壓暗漸層：左→右保左側文字可讀、上下輕壓讓導覽與底部聚焦（§8） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(90deg, rgba(2,23,18,0.86) 0%, rgba(2,23,18,0.5) 38%, rgba(2,23,18,0.08) 62%, rgba(2,23,18,0) 100%), linear-gradient(180deg, rgba(2,23,18,0.5) 0%, rgba(2,23,18,0) 26%, rgba(2,23,18,0) 74%, rgba(2,23,18,0.45) 100%)",
          }}
        />

        {/* 左緣 signature：金漸層直線＋圓形下滑鈕＋直書 EXPLORE COLLECTION */}
        <div className="pointer-events-none absolute bottom-10 left-6 z-10 hidden flex-col items-center gap-4 md:flex">
          <div
            aria-hidden
            className="h-24 w-px bg-gradient-to-b from-transparent via-secondary to-secondary"
          />
          <Link
            href="#selected"
            aria-label="向下探索作品"
            className="pointer-events-auto flex size-12 items-center justify-center rounded-full border border-secondary/55 text-secondary-400 transition hover:border-secondary hover:bg-secondary/10"
          >
            <ArrowDown className="size-4" strokeWidth={1.4} />
          </Link>
          <span className="text-[10px] tracking-[0.44em] text-secondary-400 uppercase [writing-mode:vertical-rl]">
            Explore Collection
          </span>
        </div>

        {/* 文案（壓左側深色區）*/}
        <div className="mx-auto flex w-full max-w-[1240px] items-center px-6 md:pl-20">
          <div className="flex max-w-[30rem] flex-col items-start gap-7 py-24">
            <span className="eyebrow">incanto · 著迷</span>
            <h1 className="font-heading text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.12] text-paper">
              讓人著迷、有故事的彩色寶石
            </h1>
            <p className="max-w-[42ch] text-base leading-relaxed text-paper/80">
              以天然彩色寶石與細膩工藝，打造能融入日常、卻令人回味的珠寶。選妳的寶石、金屬與尺寸，於下單後專屬訂製。
            </p>
            <div className="mt-2 flex flex-wrap gap-4">
              <Button asChild variant="gold">
                <Link href="/collections/ring">探索作品</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link href="/custom">預約訂製</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── 精選作品（SELECTED PIECES）───────────────────────────── */}
      <section
        id="selected"
        className="mx-auto max-w-[1240px] scroll-mt-[var(--header-height)] px-6 py-16 sm:py-20"
      >
        <div className="flex items-end justify-between border-b border-border pb-5">
          <div>
            <div className="eyebrow">Selected Pieces</div>
            <h2 className="mt-2 font-heading text-[28px] text-ink">精選作品</h2>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/collections/ring">所有產品</Link>
          </Button>
        </div>

        {featured.length === 0 ? (
          <div className="mt-10 rounded-lg border border-border bg-cloud px-6 py-12 text-center text-ash">
            作品即將上架，敬請期待。
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((product) => (
              <ProductCard key={product.slug} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* ── 品牌理念（QUIET LUXURY）· ABOUT 錨點 ────────────────────── */}
      <section id="philo" className="scroll-mt-[var(--header-height)] bg-cloud">
        <div className="mx-auto max-w-[720px] px-6 py-20 text-center sm:py-24">
          <div className="eyebrow">Quiet Luxury</div>
          <p className="mt-6 font-heading text-[clamp(1.375rem,2.6vw,1.875rem)] leading-[1.5] text-ink">
            沒有浮誇的設計語言，只有經得起時間考驗的比例、材質與細節。一件對的作品會讓人著迷——不是因為多貴多閃，而是妳看著它會說：這就是我。
          </p>
          <div
            aria-hidden
            className="mx-auto mt-10 h-px w-16 bg-secondary opacity-60"
          />
        </div>
      </section>

      {/* ── 全客製（CUSTOM）───────────────────────────────────────── */}
      <section className="bg-primary text-paper">
        <div className="mx-auto flex max-w-[720px] flex-col items-center gap-6 px-6 py-20 text-center sm:py-24">
          <div className="eyebrow text-secondary-400">Custom</div>
          <h2 className="max-w-[20ch] font-heading text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.2] text-paper">
            從一顆寶石、一個念頭開始
          </h2>
          <p className="max-w-[42ch] text-base leading-relaxed text-paper/75">
            預約一對一訂製，我們陪妳從選石、草圖到成品——慢慢來，只為妳一個人。
          </p>
          <Button asChild variant="gold" className="mt-2">
            <Link href="/custom">預約訂製</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
