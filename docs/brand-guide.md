# Brand Guide — incantochen（v2 整理版）

> 品牌 UI 規範：精神／定位／色彩／字體／間距／元件／影像／文案語氣。
> v2 說明：彙整本階段所有定案，並以 homepage demo 實際驗證過的 token 為準。做任何 UI／頁面前先讀本檔；品牌 token 一律走 `tailwind.config` / shadcn theme，不要每頁自行挑色。

---

## 1. 品牌精神

- **品牌名**：**incantochen**（incanto＝義大利文「著迷／魔法」＋ chen）。
- **一句話**：讓人著迷、有故事的彩色寶石，成為妳日常穿搭與個人品味的一部分。
- **核心客群**：30–45 歲、都會、經濟獨立的女性；**為自己購買**。注重設計與質感、主導果斷、喜歡小眾設計品牌；卡在「品牌珠寶太貴太張揚／一般飾品沒有高級感」中間的人。
- **購買觸發**：身份認同——當她覺得「**這件東西就是我**」就會下手（非「妳值得獎勵」的里程碑敘事）。
- **調性關鍵字**：quiet luxury、enchantment（著迷）、heritage（古董細工的傳承感）、彩色寶石為主角、低調但「懂的人看得出」。
- **不是**：婚嫁取向、大 logo 張揚、廉價感、業務推銷式。

---

## 2. 定位與產品結構

- **定位陳述**：填補「品牌高端珠寶太貴太張揚」與「一般飾品沒高級感」之間的空缺——自助、即時報價、以彩色寶石為主角的高端珠寶，低調卻「懂的人一眼看得出」。
- **差異化支柱**：① 填補價格／質感缺口（質感對得起 NT$2–5 萬、不為 logo 溢價）② 彩色寶石為核心（非白鑽）③ quiet luxury／小眾設計調性 ④ 自助、透明、不被推銷。
- **全產品線**：戒指、耳環、手鍊、項鍊（示範以戒指起步，設計與文案需涵蓋全品類）。
- **兩種購買模式**：
  - **半客製（產品線主體）**：標準款＋可選配（例：戒指可選寶石／金屬色／尺寸），即時報價、走標準電商結帳、下單後訂製。
  - **全客製（預約）**：一對一訂製、預約制（首頁 CTA「預約訂製」）。注意：完整全客製流程於開發計畫屬 Phase 3，MVP 階段此入口可先做成預約／詢問表單。
- **客單帶**：NT$20,000–50,000／件。

---

## 3. Logo / Wordmark

- **字樣**：`INCANTOCHEN` 或 `incantochen`，字距明顯（letter-spacing 0.26–0.28em），用標題 serif（EB Garamond）。導覽列採**大寫＋寬字距**呈現，編輯感、克制。
- **用色**：淺底用 Ink 或 Emerald；深底（綠／黑／藏藍）用 Paper 或 Gold。
- **留白**：四周淨空 ≥ 字高 0.6 倍。
- **禁止**：陰影／漸層／外框、變形、低對比（金字壓淺金）、旋轉。
- ⏳ 待製：實際 logo／favicon／OG 圖（`public/brand/`）。

---

## 4. 色彩系統（以 homepage 驗證值為準）

### 4.1 主色票
| 角色 | 名稱 | Hex | 用途 |
|---|---|---|---|
| Primary | Emerald 祖母綠 | `#063B2F` | 主色：主要按鈕、深色區塊、頁尾、品牌識別、價格強調 |
| Secondary | Gold 金 | `#C5A059` | 點綴：eyebrow 標籤、金色細線、選中態、次要 CTA、深底文字 |
| Paper | 紙白 | `#FAF9F6` | 主背景 |
| Ink | 近黑 | `#1A1A1A` | 主文字 |
| Espresso | 濃咖啡 | `#38260B` | 深暖中性備用 |

衍生：`emerald-700 #052E25`、`emerald-900 #021712`、`gold-300 #D0B074`。
中性：`Cloud #F1EFEA`、`Stone #D9D5CC`、`Ash #9A968D`。

### 4.2 完整色階（Tailwind 用）
**Emerald**：`50 #EAF1EE · 100 #CADBD4 · 200 #9DBBB0 · 300 #6E9A8B · 400 #3E6C5C · 500 #1C4B3C · 600 #063B2F · 700 #052E25 · 800 #04231C · 900 #021712`
**Gold**：`50 #F7F1E4 · 100 #EDDFC2 · 200 #DEC795 · 300 #D0B074 · 400 #C5A059 · 500 #A9863F · 600 #876A30 · 700 #645024 · 800 #3F3216 · 900 #241C0C`

### 4.3 寶石點綴色（受控）
**UI chrome 只用綠／金／中性；彩色只出現在「寶石／商品本身」**，一個畫面飽和寶石色 ≤ 2 種。
翡翠/祖母綠 `#1F7A52`、藍寶 `#1E5C9B`、藍托帕 `#3E7C97`、粉剛/紅寶 `#B04A63`、蛋白石（漸層）`#BFE3E0 → #E8D6E8 → #CDE6C9`。

### 4.4 語意色
Success `#1C7A4D`、Error/刪除 `#B23A38`、Warning `#C5862F`、Info `#3E6C8C`。

### 4.5 對比與用色原則
- **金 `#C5A059` 對白底對比不足**：勿用作白底小字，限用於大標、eyebrow、icon、細線，或壓深底。
- Emerald 配白字、Paper 配 Ink 文字達 WCAG AA。
- 互動元件需可見 focus 樣式。

---

## 5. 字體系統（中英雙軌）

| 角色 | 拉丁 | 中文 | 用途 |
|---|---|---|---|
| Headline | **EB Garamond**（serif） | **Noto Serif TC 思源宋體** | H1–H3、hero、品牌語句 |
| Body | **Hanken Grotesk**（sans） | **Noto Sans TC 思源黑體** | 內文、說明、表單 |
| Label/eyebrow | Hanken Grotesk | Noto Sans TC | 按鈕、標籤、價格、導覽、caption |

> 定案：**serif 標題＋sans 內文**（取代早期「純 sans」），呼應古董細工的編輯／傳承感，sans 內文維持現代易讀。

- font stack：標題 `"EB Garamond","Noto Serif TC",Georgia,serif`；內文 `"Hanken Grotesk","Noto Sans TC",system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif`。
- **字級階層**：display 2.75–3.5rem / h1 2.25 / h2 1.75 / h3 1.375（serif，weight 400–500）；body 1rem、body-lg 1.125（sans，行高 1.6）；small 0.875。
- **eyebrow 標籤**：11px、`letter-spacing .34em`、大寫、金色、weight 500（全站區段小標統一用此樣式，如 `SELECTED PIECES`、`CUSTOM`、`QUIET LUXURY`）。
- 標題行高 1.1–1.25；中文標題字重 ≥ Medium。

---

## 6. 間距 / 圓角 / 陰影

- **間距尺度（4px 基準）**：4·8·12·16·24·32·48·64·96。區段垂直 64–96（手機 40–56）。同一橫列內的標籤與按鈕**上下間距需一致**（標頭帶垂直置中）。
- **圓角（兩種，刻意區分）**：
  - **按鈕＝方角 `2px`**（編輯感、克制）。
  - **卡片／輸入框／大區塊＝柔角 `11px`**。
- **陰影**：克制。卡片用極淺長陰影（如 `0 22px 44px -28px rgba(6,59,47,.5)`，hover 才明顯）；深色區塊靠色階分層而非重陰影。
- **格線**：桌機 12 欄、最大內容寬 ~1240px、gutter 22–24px；手機優先。
- **質感原則**：留白足、線細、對齊精準——quiet luxury 靠精準而非裝飾。金色細線（hairline）為品牌簽名元素。

---

## 7. 元件基調

### 7.1 按鈕（編輯感：大寫、寬字距、方角）
共通：`font-size 11.5px`、`letter-spacing .2em`、大寫、`padding 15px 30px`、`radius 2px`、1px 邊框。
- **Solid**：Emerald 底＋Paper 字（主要動作：加入購物袋、結帳、付款）。
- **Gold**：Gold 底＋Emerald-900 字（深底上的主 CTA，如預約訂製）。
- **Ghost**：透明＋金色細框（`rgba(197,160,89,.55)`）＋金字，hover 淡金底（**深底用**）。
- **Outline**：透明＋Emerald 框＋Emerald 字，hover 翻轉填色（**淺底用**，如「所有產品」）。

### 7.2 導覽
三欄：品牌字樣（左，大寫寬字距）｜連結（置中，12px 大寫 `.22em`）｜線性 icon（右：搜尋／會員／購物袋，stroke 1.4、18px）。透明浮在深色 hero 上，文字 Paper、hover Gold。

### 7.3 區段標頭（通用樣式）
左：eyebrow 小標（金、大寫寬字距）；右：Outline 按鈕。放在**固定高度標頭帶**內垂直置中，**列上下間距一致**（demo 用各 64px）。

### 7.4 商品卡
白底、`radius 11px`、1px 淺邊、圖片 1:1、hover 上浮。資訊區：**寶石色點（9px 圓）＋材質 meta（10.5px 大寫 `.16em`，Ash 色）＋品名（serif 19px）＋價格（sans 14px、Emerald、weight 500）**。圖片優先含配戴／生活情境。

### 7.5 配置器選項 chip（半客製）
寶石選項＝色塊＋名稱；選中態＝Emerald 框＋金色 ring/勾；白名單外＝灰階 disable。價格即時總價醒目、加價明細可展開。

### 7.6 輸入框／標籤
輸入框：Paper/白底、細框 Stone、focus 轉 Emerald、`radius 11px`。標籤/Tag：中性 Stone 底 Ink 字；「客製／限量」可用金底深字（節制）。

---

## 8. Hero / 版型訊號

- **滿版深色 hero**：大圖滿版、上下加深漸層（上 ~.74、下 ~.78）讓導覽與底部聚焦；圖以寶石為主角、置於畫面中心稍上。
- **左側 signature**：細直線（金漸層）＋圓形下滑鈕（48px、金色細框、↓）＋直書 `EXPLORE COLLECTION`（金、大寫、`letter-spacing .44em`）。
- **文案極簡**：hero 只留 eyebrow（如 `incanto · 著迷`），不放大段標語——以圖與 signature 製造著迷感。
- **區段節奏**：明確 eyebrow → 內容；金色細線分隔；大量留白。

---

## 9. 影像 / 攝影方向

- **主視覺 / hero（著迷感）**：深色背景（藏藍／祖母綠／近黑皆可）＋金＋寶石光，戲劇、貴氣。
  > 註：hero 攝影可用深藏藍等深寶石色背景，與品牌主色（祖母綠）並存——**品牌 chrome 維持綠＋金，攝影背景可較自由**。
- **日常情境（轉換主力）**：暖陽自然光、白襯衫／大理石／咖啡等生活場景，讓客群投射「戴著它過日子＝這就是我」。
- **靜態疊圖（MVP 呈現機制）**：Blender 素材＋前端擬真疊圖（對齊＋光影）；驗收＝對齊精準、光影自然、與實品一致。多角度＋配戴情境補足信任。
- **共通**：寶石是主角、金屬為襯；背景乾淨、色溫一致。

---

## 10. 文案語氣（Voice & Tone）

### 10.1 原則
身份認同（非獎勵敘事）、低調有內涵（像懂行的朋友、不推銷）、具體勝過華麗、主動語態、簡潔；可少量帶 incanto 的「著迷」意象但不濫用。**全品類用詞**（珠寶／作品，而非只說戒指）。

### 10.2 該／不該
| 該 | 不該 |
|---|---|
| 「翡翠的綠，安靜卻有存在感。」 | 「人人稱羨的奢華逸品！」 |
| 「選妳的顏色」 | 「犒賞辛苦的自己，妳值得」 |
| 「金額已更新，請確認後再付款。」 | 「糟糕！出錯了 :(」 |

### 10.3 定案範例
- **品牌理念（已採用）**：「Incantochen 以天然彩色寶石與細膩工藝，打造能融入日常、卻令人回味的珠寶。沒有浮誇的設計語言，只有經得起時間考驗的比例、材質與細節。每件作品皆可依個人喜好選擇寶石、金屬與尺寸，於下單後專屬訂製。」
- **hero eyebrow**：`incanto · 著迷`
- **全客製區（已採用）**：「獨一無二 — 從一顆寶石、一個念頭開始，與我們一起打造完全屬於妳的設計。預約一對一訂製，我們陪妳從選石、草圖到成品——慢慢來，只為妳一個人。」CTA：`預約訂製`
- **品牌故事（incanto）**：「義大利文裡，是『著迷、魔法』的意思。一枚對的作品會讓人著迷——不是因為多貴多閃，而是妳看著它會說：這就是我。」
- **交期**：「下單後為妳訂製，交期將於商品頁與結帳時告知。」

### 10.4 半客製 vs 全客製 用詞
- 半客製（產品線）：強調「自助選配、即時報價、透明、不被推銷」。
- 全客製（預約）：強調「一對一、從草圖到成品、慢慢來」。兩者語氣不要混用。

---

## 11. 可實作 token

### 11.1 字型載入
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Hanken+Grotesk:wght@300;400;500;600&family=Noto+Serif+TC:wght@400;500;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet">
```

### 11.2 CSS 變數
```css
:root{
  --emerald:#063B2F; --emerald-700:#052E25; --emerald-900:#021712;
  --gold:#C5A059; --gold-300:#D0B074;
  --paper:#FAF9F6; --cloud:#F1EFEA; --stone:#D9D5CC; --ash:#9A968D;
  --ink:#1A1A1A; --espresso:#38260B;
  --success:#1C7A4D; --error:#B23A38; --warning:#C5862F; --info:#3E6C8C;
  --head:"EB Garamond","Noto Serif TC",Georgia,serif;
  --body:"Hanken Grotesk","Noto Sans TC",system-ui,-apple-system,sans-serif;
  --radius-card:11px; --radius-btn:2px;
}
```

### 11.3 Tailwind `theme.extend`
```js
extend:{
  colors:{
    primary:{DEFAULT:'#063B2F',50:'#EAF1EE',100:'#CADBD4',200:'#9DBBB0',300:'#6E9A8B',400:'#3E6C5C',500:'#1C4B3C',600:'#063B2F',700:'#052E25',800:'#04231C',900:'#021712'},
    secondary:{DEFAULT:'#C5A059',50:'#F7F1E4',100:'#EDDFC2',200:'#DEC795',300:'#D0B074',400:'#C5A059',500:'#A9863F',600:'#876A30',700:'#645024',800:'#3F3216',900:'#241C0C'},
    paper:'#FAF9F6', cloud:'#F1EFEA', stone:'#D9D5CC', ash:'#9A968D', ink:'#1A1A1A', espresso:'#38260B',
  },
  fontFamily:{
    head:['"EB Garamond"','"Noto Serif TC"','Georgia','serif'],
    body:['"Hanken Grotesk"','"Noto Sans TC"','system-ui','sans-serif'],
  },
  borderRadius:{ btn:'2px', card:'11px' },
}
```

---

## 12. 待補 / 同步

- ⏳ 待製：logo／favicon／OG 圖、3D 合成商品圖（`public/brand/`）。
- 🔁 **藏藍備案**：若改回首版 Aetheris 的藏藍，只需把 primary 換成 `#1A2B3C`、第三色換濃咖啡，其餘不動（一行 token）。目前定案為祖母綠。
- 📌 全客製為 Phase 3；MVP 的「預約訂製」入口先做預約／詢問表單。
- ⚠️ **同步**：本檔 v2 定案（品牌名、客群、全產品線、祖母綠＋金視覺、serif/sans 雙軌、編輯感按鈕/導覽/hero、文案語氣）請回填 repo 的 `memory.md` 與 `CLAUDE.md`，讓 Claude Code 端對齊。
- 參考實作：見 homepage demo（`incantochen-home.html`）——上述 token 與元件皆已在其中驗證。
