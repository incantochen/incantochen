// 商品目錄卡片用來挑「代表色」的選項類型代碼。這兩個字串目前沒有 DB 層級
// 約束保證存在或拼字正確（option_type.code 只是 unique text）；T12/T13 開放
// 後台設定其他品類的選項後，若新品類的顏色選項用了不同代碼，這裡的
// .find() 會直接回傳 undefined，卡片只是優雅地不顯示色點／meta，不會噴錯——
// 這是刻意的降級行為，不是遺漏的錯誤處理。
export const GEM_COLOR_OPTION_CODE = "gem_color"
export const METAL_COLOR_OPTION_CODE = "metal_color"
