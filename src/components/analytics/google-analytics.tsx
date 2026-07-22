import { buildGtagBootstrap } from "@/lib/analytics/gtag";

// GA4 載入（T60，Consent Mode v2）——server component，渲染兩個帶 nonce 的
// <script>，於 HTML parse 時執行（早於 hydration 與所有 tracker 的 effect）：
//   1. inline bootstrap：同步建立 dataLayer＋gtag stub＋consent default，並在
//      config 前依 cookie 還原 grant（見 buildGtagBootstrap 註解）。無 async，
//      parse 到此即同步跑完 → window.gtag 立即可用，tracker effect 不再 no-op。
//   2. loader：非同步抓 gtag.js，載入後依 dataLayer FIFO 補跑先前排入的命令。
// CSP：兩個 <script> 都帶 nonce，過 script-src 'nonce-…' 'strict-dynamic'；
// loader 動態插入的子腳本再由 strict-dynamic 傳遞信任。改用 server 端 <script>
// 取代舊的 effect+createElement bootstrap，消除「bootstrap effect 晚於 tracker
// effect 執行 → 首筆 purchase 漏送且被 localStorage 永久鎖死」的競態。
export function GoogleAnalytics({
  gaId,
  nonce,
}: {
  gaId: string;
  nonce?: string;
}) {
  return (
    <>
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: buildGtagBootstrap(gaId) }}
      />
      <script
        nonce={nonce}
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`}
      />
    </>
  );
}
