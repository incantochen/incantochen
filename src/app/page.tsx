import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductCard, type ProductCardData } from "@/components/product-card";
import { getFeaturedProducts } from "@/lib/product/featured-products";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// 首頁精選最多展示這麼多件；MVP 目錄規模小，超出再考慮分頁。
const FEATURED_LIMIT = 4;

export default async function Home() {
  // 精選區為非關鍵展示：DB 暫時性故障時降級隱藏、其餘首頁內容照常呈現，
  // 不讓不依賴 DB 的 hero／理念／CTA 隨查詢失敗一起 500。
  let featured: ProductCardData[] = [];
  try {
    featured = await getFeaturedProducts(FEATURED_LIMIT);
  } catch (err) {
    console.error("[home] 載入精選商品失敗，降級隱藏精選區：", err);
  }

  return (
    <>
      {/* ── HERO：滿版攝影＋左緣金線 signature（demo indexV2 / brand-guide §8）──
          -mt 讓 hero 鑽到透明導覽列下方（首頁 header 透明浮層，見 HeaderChrome）*/}
      <section
        data-nav-dark
        className="relative isolate -mt-[var(--header-height)] flex min-h-[86vh] overflow-hidden bg-primary text-paper"
      >
        <Image
          src="/brand/hero.png"
          alt="藏藍絨盒上的金質皇冠戒，中央鑲藍寶石"
          fill
          priority
          sizes="100vw"
          className="-z-20 object-cover"
          style={{ objectPosition: "50% 42%" }}
        />
        {/* 上下壓暗漸層：讓導覽與底部文案聚焦（demo .hero::after） */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, rgba(5,7,12,0.74) 0%, rgba(5,7,12,0.10) 26%, rgba(5,7,12,0.16) 60%, rgba(5,7,12,0.78) 100%)",
          }}
        />

        {/* 左緣 signature：金漸層直線＋圓形下滑鈕＋直書 EXPLORE COLLECTION */}
        <div className="absolute top-1/2 left-6 z-10 hidden -translate-y-1/2 flex-col items-center gap-[22px] md:flex lg:left-[46px]">
          <span
            aria-hidden
            className="h-14 w-px bg-gradient-to-b from-secondary to-transparent"
          />
          <Link
            href="#products"
            aria-label="向下探索系列"
            className="flex size-12 items-center justify-center rounded-full border border-secondary/55 text-secondary-400 transition hover:border-secondary hover:bg-secondary/10"
          >
            <ArrowDown className="size-4" strokeWidth={1.4} />
          </Link>
          <span className="text-[11px] tracking-[0.44em] text-secondary-400 uppercase [writing-mode:vertical-rl]">
            explore collection
          </span>
        </div>

        {/* hero-tag：左下 eyebrow（極簡編輯感，brand-guide §8 hero 只留 eyebrow）。
            視覺維持極簡；h1 以 sr-only 提供文件主標（SEO／螢幕報讀器大綱）。 */}
        <div className="mx-auto flex w-full max-w-[1240px] items-end px-6 pb-16 md:pl-[110px]">
          <h1 className="sr-only">
            incantochen 辰醉金閣 — 高端半客製彩色寶石珠寶
          </h1>
          <span className="eyebrow" aria-hidden>
            incanto · 著迷
          </span>
        </div>
      </section>

      {/* ── PHILOSOPHY（quiet luxury）─────────────────────────────── */}
      <section className="bg-cloud py-20 sm:py-24">
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 items-center gap-8 px-6 md:grid-cols-2 md:gap-12">
          <div className="eyebrow">quiet luxury</div>
          <div>
            <p className="text-[15.5px] leading-relaxed text-espresso/85">
              珠寶不只是點綴，更是內在風格的延伸。Incantochen
              以天然彩色寶石與細膩工藝，打造能輕疊於日常、卻在細處綻放光芒的精緻珠寶。每件作品皆可依您的喜好自由挑選寶石、金屬與尺寸，於下單後專屬訂製；並隨作品附上國際寶石證書，替您守護每一份源自大自然的珍貴饋贈。
            </p>
            <hr className="mt-6 h-px w-[120px] border-0 bg-secondary opacity-50" />
          </div>
        </div>
      </section>

      {/* ── SELECTED PIECES（真實上架商品）───────────────────────── */}
      <section
        id="products"
        className="mx-auto max-w-[1240px] scroll-mt-[var(--header-height)] px-6 pt-8 pb-16 sm:pt-10 sm:pb-20"
      >
        <div className="mb-8 flex min-h-16 items-center justify-between gap-5">
          <div className="eyebrow leading-none">selected pieces</div>
          <Button asChild variant="outline" size="sm">
            <Link href="/collections/ring">所有產品</Link>
          </Button>
        </div>

        {featured.length === 0 ? (
          <div className="rounded-lg border border-border bg-cloud px-6 py-12 text-center text-ash">
            作品即將上架，敬請期待。
          </div>
        ) : (
          // 與 collections/[category] 相同的格線（手機 2 欄、桌機 4 欄）
          <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {featured.map((product) => (
              <ProductCard key={product.slug} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* ── EVERYDAY（日常情境分割版）──────────────────────────── */}
      <section id="everyday" className="grid grid-cols-1 items-stretch md:grid-cols-[1.05fr_0.95fr]">
        <div className="relative min-h-[300px] md:min-h-[420px]">
          <Image
            src="/brand/everyday.jpg"
            alt="配戴祖母綠手鍊與戒指、於暖陽下的日常情境"
            fill
            sizes="(max-width: 820px) 100vw, 55vw"
            className="object-cover"
          />
        </div>
        <div className="flex flex-col justify-center px-6 py-14 sm:px-12 sm:py-20 lg:px-20">
          <div className="eyebrow">everyday</div>
          <h2 className="mt-3 mb-4 font-heading text-[clamp(1.625rem,3.3vw,2.375rem)] leading-[1.2] text-ink">
            日常戴得住，
            <br />
            細看有故事。
          </h2>
          <p className="max-w-[46ch] text-[15.5px] leading-relaxed text-espresso/85">
            不是收進保險箱的逸品，而是配進白襯衫、配進一杯咖啡的日常。寶石的顏色安靜卻有存在感——懂的人，一眼就看得出。
          </p>
        </div>
      </section>

      {/* ── CHOOSE COLOR / CUSTOM（深色影像疊圖 CTA）──────────────── */}
      <section
        data-nav-dark
        className="relative isolate overflow-hidden bg-primary-900 text-paper"
      >
        <Image
          src="/brand/choose.jpg"
          alt="綠絨托盤上的彩色寶石戒指"
          fill
          sizes="100vw"
          className="-z-20 object-cover opacity-40"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(180deg, rgba(2,23,18,0.6), rgba(2,23,18,0.85))",
          }}
        />
        <div className="mx-auto flex max-w-[720px] flex-col items-center px-6 py-24 text-center">
          <div className="eyebrow">custom</div>
          <h2 className="my-4 max-w-[20ch] font-heading text-[clamp(1.75rem,3.8vw,2.625rem)] leading-[1.2] text-paper">
            獨一無二
          </h2>
          <p className="mb-7 max-w-[48ch] text-base leading-relaxed text-paper/80">
            從一顆寶石、一個念頭開始，與我們一起打造完全屬於妳的設計。預約一對一訂製，我們陪妳從選石、草圖到成品——慢慢來，只為妳一個人。
          </p>
          <Button asChild variant="gold">
            <Link href="/custom">預約訂製</Link>
          </Button>
        </div>
      </section>

      {/* ── STORY（品牌名 incanto）───────────────────────────────── */}
      <section
        id="story"
        data-nav-dark
        className="scroll-mt-[var(--header-height)] bg-primary py-20 text-center text-paper sm:py-24"
      >
        <div className="mx-auto max-w-[680px] px-6">
          <div className="eyebrow">the name</div>
          <p className="mt-3 font-heading text-[clamp(1.875rem,4.6vw,3.25rem)] text-secondary-400 italic">
            incanto
          </p>
          <p className="mt-4 text-base leading-relaxed text-paper/85">
            義大利文裡，是「著迷、魔法」的意思。我們相信一枚對的作品，是會讓人著迷的——不是因為它多貴、多閃，而是因為妳看著它會說：這就是我。
          </p>
        </div>
      </section>
    </>
  );
}
