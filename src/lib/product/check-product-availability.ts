import "server-only";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";

type ServiceRole = ReturnType<typeof createServiceRoleClient>;

// T117：PDP 用 anon client 查商品（受 RLS 0014 過濾）。管理員把某商品「必選
// 選項」的類別（option_type.is_active=false）或其最後一個顯示中的值
// （option_value.is_active=false）隱藏後，該選項整組從 anon !inner 查詢結果
// 消失——配置器沒有欄位可選、「加入購物袋」卻仍可按，客人會加到實際上無法
// 履約的商品，拖到結帳才被 verify-prices 的必選完整性驗證擋下。
//
// anon 結果無法區分「本來就沒有這個必選」與「必選被隱藏了」，故用 service
// role（不受 RLS）讀真相：只要有任一 required 選項的類別已隱藏、或該類別底下
// 所有值都已隱藏，該商品當下就無法完成配置＝暫停販售。
//
// ⚠️ 只回傳 boolean——service role 讀到的隱藏選項明細絕不外流到 client
// （呼叫端只把這個判斷結果傳進配置器）。
export async function isProductUnavailable(
  serviceRole: ServiceRole,
  productId: string,
): Promise<boolean> {
  const { data, error } = await serviceRole
    .from("product_option")
    .select(
      `
      id,
      option_type:option_type_id ( is_active ),
      product_option_value ( option_value:option_value_id ( is_active ) )
    `,
    )
    .eq("product_id", productId)
    .eq("required", true);

  if (error) {
    // 查詢失敗 ≠ 查無資料（§6），但這是純 UX 判斷、非金流關卡：fail-open
    // （視為可販售），別讓 DB 暫時性抖動把正常商品誤標「暫停販售」。真正
    // 無法履約的訂單仍會在結帳被 verify-prices 的必選完整性驗證擋下。
    console.error(
      "[isProductUnavailable] 必選選項可用性查詢失敗，fail-open 視為可販售",
      { productId, error },
    );
    return false;
  }

  // 任一必選選項不可滿足＝暫停販售。
  return (data ?? []).some((po) => {
    // 必選類別本身已隱藏。
    if (!po.option_type?.is_active) return true;
    // 必選類別的顯示中值一個都不剩。
    const hasActiveValue = (po.product_option_value ?? []).some(
      (pov) => pov.option_value?.is_active === true,
    );
    return !hasActiveValue;
  });
}
