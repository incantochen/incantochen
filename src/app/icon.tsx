import { ImageResponse } from "next/og";

// T59：生成式 512px 品牌 icon（manifest 引用）。品牌 icon 素材尚未產出
// （public/brand 為空），先以 ImageResponse 產深綠底＋金色「i」字標撐住
// Google／Android／PWA 的 icon 需求；正式素材到位後換 public/ 靜態檔。
// 顏色對齊品牌 token：primary #063b2f／secondary-400 #c5a059。
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#063b2f",
          color: "#c5a059",
          fontSize: 340,
          fontFamily: "serif",
        }}
      >
        i
      </div>
    ),
    { ...size },
  );
}
