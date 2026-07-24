"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { checkoutFormSchema } from "@/lib/checkout/schema";
import { AddressSelect } from "@/components/address-select";
import { createOrder } from "@/app/checkout/actions";
import { flattenFieldErrors } from "@/lib/zod/flatten-field-errors";

export function CheckoutForm({ defaultEmail }: { defaultEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(defaultEmail);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  // T48 地址標準化：縣市／區走連動下拉，選定後自動帶郵遞區號；shippingAddress
  // 僅存「詳細地址」（街道巷弄號樓），送出時前面串上縣市＋區組成完整寄件地址。
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [customConsent, setCustomConsent] = useState(false);
  // T42：發票去向——個人（綠界載具）／公司統編／手機條碼載具三選一
  const [invoiceTarget, setInvoiceTarget] = useState<
    "personal" | "company" | "mobile_barcode"
  >("personal");
  const [taxId, setTaxId] = useState("");
  const [carrierBarcode, setCarrierBarcode] = useState("");
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [priceUpdatedMessage, setPriceUpdatedMessage] = useState<string | null>(
    null,
  );
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [showCartLink, setShowCartLink] = useState(false);
  const [isPending, startTransition] = useTransition();

  function validate() {
    const nextErrors: Partial<Record<string, string>> = {};
    // 縣市／區為連動下拉，schema 不涵蓋，於此手動要求（zipCode 由選擇自動帶）。
    if (!city) nextErrors.city = "請選擇縣市";
    if (!district) nextErrors.district = "請選擇鄉鎮市區";
    const result = checkoutFormSchema.safeParse({
      email,
      recipientName,
      recipientPhone,
      zipCode,
      shippingAddress,
      customConsent,
      invoiceTarget,
      taxId,
      carrierBarcode,
    });
    if (!result.success) {
      Object.assign(nextErrors, flattenFieldErrors(result.error));
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setPriceUpdatedMessage(null);
    setRequiresLogin(false);
    setShowCartLink(false);
    if (!validate()) return;
    startTransition(async () => {
      const result = await createOrder({
        email,
        recipientName,
        recipientPhone,
        zipCode,
        // 存完整寄件地址＝縣市＋區＋詳細地址，物流標籤／後台看得到全址。
        shippingAddress: `${city}${district}${shippingAddress}`,
        customConsent: customConsent as true,
        invoiceTarget,
        taxId,
        carrierBarcode,
      });
      // redirect() in server action throws internally — only reach here on error
      if (!result.ok) {
        if (result.requiresLogin) {
          setRequiresLogin(true);
          setSubmitError(result.error);
        } else if (result.priceUpdated) {
          // Prices changed — refresh server components so the page shows the new total
          router.refresh();
          setPriceUpdatedMessage(result.error);
        } else {
          setSubmitError(result.error);
          setShowCartLink(!!result.showCartLink);
        }
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          Email
        </label>
        <input
          type="email"
          maxLength={254}
          value={email}
          readOnly={!!defaultEmail}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={validate}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary read-only:bg-cloud"
        />
        {errors.email && (
          <p className="mt-1 text-sm text-destructive">{errors.email}</p>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          收件人姓名
        </label>
        <input
          type="text"
          maxLength={50}
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          onBlur={validate}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
        />
        {errors.recipientName && (
          <p className="mt-1 text-sm text-destructive">
            {errors.recipientName}
          </p>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          電話
        </label>
        <input
          type="tel"
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
          onBlur={validate}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
        />
        {errors.recipientPhone && (
          <p className="mt-1 text-sm text-destructive">
            {errors.recipientPhone}
          </p>
        )}
      </div>

      {/* T48 地址標準化：縣市→區連動下拉，自動帶郵遞區號 */}
      <AddressSelect
        city={city}
        district={district}
        cityError={errors.city}
        districtError={errors.district}
        onChange={({ city: nextCity, district: nextDistrict, zip }) => {
          setCity(nextCity);
          setDistrict(nextDistrict);
          setZipCode(zip);
        }}
      />

      <div className="mb-4 grid grid-cols-[120px_1fr] gap-3">
        <div>
          <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
            郵遞區號
          </label>
          <input
            type="text"
            value={zipCode}
            readOnly
            aria-label="郵遞區號（由縣市與區自動帶入）"
            placeholder="—"
            className="mt-2 w-full rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm text-ash outline-none"
          />
          {errors.zipCode && (
            <p className="mt-1 text-sm text-destructive">{errors.zipCode}</p>
          )}
        </div>
        <div>
          <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
            詳細地址
          </label>
          <input
            type="text"
            // 上限 190：送出時前串縣市＋區（≤9 字），組出全址須 ≤ 200
            // （server 端同一 schema 的 shippingAddress max 200，超出會拒單）。
            maxLength={190}
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            onBlur={validate}
            placeholder="街道、巷弄、號、樓"
            className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
          />
          {errors.shippingAddress && (
            <p className="mt-1 text-sm text-destructive">
              {errors.shippingAddress}
            </p>
          )}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          配送方式
        </label>
        <div className="mt-2 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
          黑貓宅配（保價＋本人簽收）
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-cloud px-3.5 py-3 text-sm">
        ⓘ <strong>下單後為妳訂製</strong>，交期至少 <strong>XX</strong>{" "}
        天，將於結帳再次告知。
      </div>

      {/* T42：電子發票去向 */}
      <div className="mb-5">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          電子發票
        </label>
        <div className="mt-2 flex flex-wrap gap-4">
          {(
            [
              { value: "personal", label: "個人（綠界會員載具）" },
              { value: "company", label: "公司（統一編號）" },
              { value: "mobile_barcode", label: "手機條碼載具" },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-1.5 text-sm"
            >
              <input
                type="radio"
                name="invoiceTarget"
                value={option.value}
                checked={invoiceTarget === option.value}
                onChange={() => setInvoiceTarget(option.value)}
                className="accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
        {invoiceTarget === "company" && (
          <div className="mt-2.5">
            <input
              type="text"
              inputMode="numeric"
              maxLength={8}
              placeholder="統一編號（8 碼數字）"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ""))}
              onBlur={validate}
              className="w-full max-w-[240px] rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
            />
            {errors.taxId && (
              <p className="mt-1 text-sm text-destructive">{errors.taxId}</p>
            )}
          </div>
        )}
        {invoiceTarget === "mobile_barcode" && (
          <div className="mt-2.5">
            <input
              type="text"
              maxLength={8}
              placeholder="手機條碼（/ 開頭共 8 碼）"
              value={carrierBarcode}
              onChange={(e) => setCarrierBarcode(e.target.value.toUpperCase())}
              onBlur={validate}
              className="w-full max-w-[240px] rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
            />
            {errors.carrierBarcode && (
              <p className="mt-1 text-sm text-destructive">
                {errors.carrierBarcode}
              </p>
            )}
          </div>
        )}
      </div>

      {/* T57 客製例外同意 — ⚖️ TODO: 以律師審定版取代下方文字（T36） */}
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm">
        <p className="mb-3 font-medium text-amber-900">⚠️ 客製商品注意事項</p>
        <p className="mb-3 text-amber-800 leading-relaxed">
          本商品為半客製品，依消費者保護法第 19
          條但書，客製商品不適用七天猶豫期。
          如有品質瑕疵或製作錯誤，仍可依規定申請退換。
        </p>
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={customConsent}
            onChange={(e) => setCustomConsent(e.target.checked)}
            onBlur={validate}
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          />
          <span className="text-amber-900">我已閱讀並同意上述說明</span>
        </label>
        {errors.customConsent && (
          <p className="mt-1.5 text-sm text-destructive">
            {errors.customConsent}
          </p>
        )}
      </div>

      {priceUpdatedMessage && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
          <p className="font-medium mb-0.5">⚠️ 金額已更新</p>
          <p>{priceUpdatedMessage}</p>
        </div>
      )}

      {submitError && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm text-destructive">
          <p>{submitError}</p>
          {showCartLink && (
            <Link href="/cart" className="mt-1 inline-block underline">
              前往購物車調整
            </Link>
          )}
        </div>
      )}

      {requiresLogin && (
        <button
          type="button"
          onClick={() =>
            router.push(`/login?redirect=${encodeURIComponent("/checkout")}`)
          }
          className="mb-3 w-full rounded-[2px] border border-primary px-8 py-3.5 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase"
        >
          前往登入
        </button>
      )}

      {/* T71 ultra review #6：requiresLogin 時這顆按鈕註定再次被伺服器擋下，
          disable 掉避免使用者重複點擊觸發沒有意義的請求。 */}
      <button
        type="submit"
        disabled={isPending || requiresLogin}
        className="w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase disabled:opacity-50"
      >
        {isPending ? "處理中…" : "前往付款"}
      </button>
    </form>
  );
}
