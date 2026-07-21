import { ImageResponse } from "next/og";

// T59：全站 OG 分享卡（LINE／FB／IG 訊息／Slack 等分享預覽）。
// 商品實拍素材尚未產出（T116），先以生成式品牌卡撐住：深綠底＋金色 Latin
// 字標——ImageResponse 內建字型不含 CJK（中文會變豆腐字），故文案刻意
// 全英文。素材到位後可改 PDP 每商品動態 OG 圖。
// 顏色對齊品牌 token：primary #063b2f／secondary-300 #d0b074／-400 #c5a059。
export const alt = "incantochen — Semi-Bespoke Colored Gemstone Jewelry";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#063b2f",
        }}
      >
        <div
          style={{
            fontSize: 96,
            letterSpacing: "0.18em",
            color: "#c5a059",
            fontFamily: "serif",
          }}
        >
          INCANTOCHEN
        </div>
        <div
          style={{
            marginTop: 32,
            fontSize: 26,
            letterSpacing: "0.42em",
            color: "#d0b074",
          }}
        >
          SEMI-BESPOKE COLORED GEMSTONE JEWELRY
        </div>
      </div>
    ),
    { ...size },
  );
}
