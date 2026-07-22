import type { Metadata } from "next";
import {
  EB_Garamond,
  Hanken_Grotesk,
  Noto_Serif_TC,
  Noto_Sans_TC,
  Geist_Mono,
} from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { JsonLd } from "@/components/json-ld";
import { getSiteUrl, isIndexingEnabled } from "@/lib/seo/site-url";
import { SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/seo/site-meta";

const headLatin = EB_Garamond({
  variable: "--font-head-latin",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const headTC = Noto_Serif_TC({
  variable: "--font-head-tc",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const bodyLatin = Hanken_Grotesk({
  variable: "--font-body-latin",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const bodyTC = Noto_Sans_TC({
  variable: "--font-body-tc",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// T59 SEO 基礎：metadataBase 讓各頁的相對 canonical／og:url 解析成絕對網址；
// 非 production（preview／本機）全站 noindex——理由見 lib/seo/site-url.ts。
export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: SITE_TITLE,
    template: `%s｜${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  ...(isIndexingEnabled()
    ? {}
    : { robots: { index: false, follow: false } }),
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
  },
};

// Organization／WebSite JSON-LD（GEO）：讓搜尋引擎與 AI 引擎建立品牌實體
// 認知的最低限資料。logo／sameAs 等品牌資產（T35／brand 素材）到位再補。
function buildSiteJsonLd() {
  const url = getSiteUrl().toString();
  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      url,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      url,
      inLanguage: "zh-TW",
    },
  ];
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${headLatin.variable} ${headTC.variable} ${bodyLatin.variable} ${bodyTC.variable} ${geistMono.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {buildSiteJsonLd().map((data, i) => (
          <JsonLd key={i} data={data} />
        ))}
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
