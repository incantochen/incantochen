"use client";

import { useState, useTransition } from "react";
import { checkoutFormSchema } from "@/lib/checkout/schema";
import { createAdminOrderFromCart } from "@/app/admin/orders/checkout/actions";
import { flattenFieldErrors } from "@/lib/zod/flatten-field-errors";

export function AdminCheckoutForm() {
  const [email, setEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [customConsent, setCustomConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [priceUpdatedMessage, setPriceUpdatedMessage] = useState<string | null>(
    null,
  );
  const [success, setSuccess] = useState<{
    orderNo: string;
    paymentLink: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function validate() {
    const result = checkoutFormSchema.safeParse({
      email,
      recipientName,
      recipientPhone,
      zipCode,
      shippingAddress,
      customConsent,
      // T42：admin 代客建單目前不收發票去向 UI，固定走個人發票（綠界載具）；
      // schema 本身雖有 default('personal')，這裡明寫更清楚不是遺漏
      invoiceTarget: "personal",
    });
    if (result.success) {
      setErrors({});
      return true;
    }
    setErrors(flattenFieldErrors(result.error));
    return false;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setPriceUpdatedMessage(null);
    if (!validate()) return;
    startTransition(async () => {
      const result = await createAdminOrderFromCart({
        email,
        recipientName,
        recipientPhone,
        zipCode,
        shippingAddress,
        // T137：admin 代客建單暫不收配送方式 UI，固定宅配（面交於出貨時處理）。
        deliveryMethod: "delivery",
        customConsent: customConsent as true,
        invoiceTarget: "personal",
      });
      if (!result.ok) {
        if (result.priceUpdated) {
          setPriceUpdatedMessage(result.error);
        } else {
          setSubmitError(result.error);
        }
        return;
      }
      setSuccess({ orderNo: result.orderNo, paymentLink: result.paymentLink });
    });
  }

  async function handleCopy() {
    if (!success) return;
    await navigator.clipboard.writeText(success.paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (success) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="mb-4 text-sm font-medium text-green-700">
          ✅ 訂單成功建立
        </p>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500">
            訂單號
          </label>
          <p className="mt-1 font-mono text-sm text-gray-900">
            {success.orderNo}
          </p>
        </div>

        <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠️ 請勿在此瀏覽器開啟此連結（會建立真實 ECPay
          付款嘗試）——請點擊下方「複製連結」後傳給客人。
        </div>

        <label className="block text-xs font-medium text-gray-500">
          付款連結
        </label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            readOnly
            value={success.paymentLink}
            className="flex-1 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
          />
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {copied ? "已複製" : "複製連結"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-gray-200 bg-white p-6"
    >
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500">
          客戶 Email
        </label>
        <input
          type="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={validate}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-600">{errors.email}</p>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500">
          收件人姓名
        </label>
        <input
          type="text"
          maxLength={50}
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          onBlur={validate}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
        />
        {errors.recipientName && (
          <p className="mt-1 text-sm text-red-600">{errors.recipientName}</p>
        )}
      </div>

      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500">電話</label>
        <input
          type="tel"
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
          onBlur={validate}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
        />
        {errors.recipientPhone && (
          <p className="mt-1 text-sm text-red-600">{errors.recipientPhone}</p>
        )}
      </div>

      <div className="mb-4 grid grid-cols-[120px_1fr] gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500">
            郵遞區號
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value.replace(/\D/g, ""))}
            onBlur={validate}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
          />
          {errors.zipCode && (
            <p className="mt-1 text-sm text-red-600">{errors.zipCode}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">
            地址
          </label>
          <input
            type="text"
            maxLength={200}
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            onBlur={validate}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-500"
          />
          {errors.shippingAddress && (
            <p className="mt-1 text-sm text-red-600">
              {errors.shippingAddress}
            </p>
          )}
        </div>
      </div>

      <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={customConsent}
            onChange={(e) => setCustomConsent(e.target.checked)}
            onBlur={validate}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="text-amber-900">
            客戶已閱讀並同意客製商品說明（無七天鑑賞期，瑕疵／錯誤可退）
          </span>
        </label>
        {errors.customConsent && (
          <p className="mt-1.5 text-sm text-red-600">{errors.customConsent}</p>
        )}
      </div>

      {priceUpdatedMessage && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="mb-0.5 font-medium">⚠️ 金額已更新</p>
          <p>{priceUpdatedMessage}</p>
        </div>
      )}

      {submitError && (
        <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded bg-gray-900 px-6 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "處理中…" : "建立訂單"}
      </button>
    </form>
  );
}
