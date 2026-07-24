"use client";

import { twCities, districtsOf, zipOf } from "@/lib/address/tw-districts";

// T48 地址標準化選單：縣市 → 鄉鎮市區 連動下拉，選定後自動帶出 3 碼郵遞區號。
// 純受控元件——狀態由父層（checkout-form）持有，本元件只負責渲染與連動邏輯。
// 樣式沿用配置器 select（appearance-none＋自繪箭頭＋Emerald focus，§7.6）。

const selectClass =
  "w-full appearance-none rounded-[11px] border border-border bg-white px-3.5 py-2.5 pr-10 text-sm text-ink focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none disabled:bg-cloud disabled:text-ash";

function Chevron() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ash"
    >
      ▾
    </span>
  );
}

export function AddressSelect({
  city,
  district,
  onChange,
  cityError,
  districtError,
}: {
  city: string;
  district: string;
  // 回傳選定結果（含連動算出的郵遞區號）；換縣市時區與郵遞區號一併清空。
  onChange: (next: { city: string; district: string; zip: string }) => void;
  cityError?: string;
  districtError?: string;
}) {
  const districtList = districtsOf(city);

  return (
    <div className="mb-4 grid grid-cols-2 gap-3">
      <div>
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          縣市
        </label>
        <div className="relative mt-2">
          <select
            aria-label="縣市"
            value={city}
            onChange={(e) =>
              onChange({ city: e.target.value, district: "", zip: "" })
            }
            className={selectClass}
          >
            <option value="">請選擇</option>
            {twCities.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
        {cityError && (
          <p className="mt-1 text-sm text-destructive">{cityError}</p>
        )}
      </div>

      <div>
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          鄉鎮市區
        </label>
        <div className="relative mt-2">
          <select
            aria-label="鄉鎮市區"
            value={district}
            disabled={!city}
            onChange={(e) =>
              onChange({
                city,
                district: e.target.value,
                zip: zipOf(city, e.target.value),
              })
            }
            className={selectClass}
          >
            <option value="">{city ? "請選擇" : "請先選縣市"}</option>
            {districtList.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
          <Chevron />
        </div>
        {districtError && (
          <p className="mt-1 text-sm text-destructive">{districtError}</p>
        )}
      </div>
    </div>
  );
}
