import raw from "./tw-districts.json";

export type TwDistrict = { name: string; zip: string };
export type TwCity = { name: string; districts: TwDistrict[] };

// 台灣縣市→鄉鎮市區→3 碼郵遞區號（22 縣市／371 區）。
// 資料來源：中華郵政 3 碼郵遞區號公開資料（社群整理版 gist，2026-07 取用）。
// T48 地址標準化選單用；純靜態 JSON、零執行期相依（不裝 react-twzipcode 等套件）。
export const twCities = raw as TwCity[];

// 依縣市名取其鄉鎮市區清單（查無回空陣列）。
export function districtsOf(cityName: string): TwDistrict[] {
  return twCities.find((c) => c.name === cityName)?.districts ?? [];
}

// 依縣市＋區名取 3 碼郵遞區號（查無回空字串）。
export function zipOf(cityName: string, districtName: string): string {
  return (
    districtsOf(cityName).find((d) => d.name === districtName)?.zip ?? ""
  );
}
