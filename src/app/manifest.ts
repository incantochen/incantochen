import type { MetadataRoute } from "next";

// T59：Web App Manifest——提供品牌訊號（名稱／主題色／icon）給 Google 與
// 加入主畫面。theme_color／background_color 對齊 globals.css 品牌 token
// （--primary #063b2f、--background #faf9f6）。
// display:"browser"＝刻意不做獨立 App 體驗：本站無 service worker、非 PWA，
// 加入主畫面以瀏覽器分頁開啟即可（要真正可安裝需改 standalone＋補 SW，不在
// MVP 範圍）。
// icons：品牌 icon 素材尚未產出（public/brand 為空），先用既有 favicon.ico
// ＋app/icon.tsx 生成的 512px 品牌字標；正式 icon 到位後換 public/ 靜態檔。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "incantochen｜半客製彩色寶石飾品",
    short_name: "incantochen",
    description:
      "高端半客製彩色寶石飾品——選妳的寶石顏色、金屬與尺寸，下單後專屬訂製。",
    start_url: "/",
    display: "browser",
    theme_color: "#063b2f",
    background_color: "#faf9f6",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
