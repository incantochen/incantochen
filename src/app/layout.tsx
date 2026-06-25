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

export const metadata: Metadata = {
  title: "incantochen",
  description: "高端半客製彩色寶石飾品",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${headLatin.variable} ${headTC.variable} ${bodyLatin.variable} ${bodyTC.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
