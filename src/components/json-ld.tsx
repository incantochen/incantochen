// JSON-LD 結構化資料的統一注入點（Server Component）。
//
// `type="application/ld+json"` 不是可執行腳本，CSP script-src（proxy.ts 的
// nonce＋strict-dynamic）不會攔它——瀏覽器只對「會執行」的 script 執法，
// 資料塊一律放行，故不需要 nonce。
//
// 小於號一律替換成 unicode escape（backslash-u003c）：JSON.stringify 不會
// 處理字串值裡的 "script 結尾標籤" 字樣，若商品名等資料含該字樣會提前終結
// script 標籤形成 XSS 缺口（§6「客人可影響的字串插進 HTML 必先 escape」的
// JSON-LD 版本）。
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
