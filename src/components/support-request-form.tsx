"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supportRequestFormSchema } from "@/lib/support/schema";
import { createSupportRequest } from "@/app/account/orders/[id]/support/actions";

export function SupportRequestForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();

  function validate() {
    const result = supportRequestFormSchema.safeParse({ description });
    if (result.success) {
      setError(null);
      return true;
    }
    setError(result.error.issues[0]?.message ?? "說明格式不正確");
    return false;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;
    setSubmitError(null);
    if (!validate()) return;
    startTransition(async () => {
      const result = await createSupportRequest(orderId, { description });
      if (result.ok) {
        setSuccess(true);
        router.refresh();
      } else {
        setSubmitError(result.error);
      }
    });
  }

  if (success) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        已收到您的商品問題回報，我們將盡快以 Email
        與您聯繫；如需提供照片，屆時請直接回覆該信件。
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-5">
        <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
          說明
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={validate}
          rows={5}
          className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
          placeholder="請描述商品問題，例如：破損位置、瑕疵狀況或收到的商品與訂單不符之處"
        />
        {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
      </div>

      {submitError && (
        <p className="mb-3 text-sm text-destructive">{submitError}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-[2px] bg-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase disabled:opacity-50"
      >
        {isPending ? "送出中…" : "送出商品問題回報"}
      </button>
    </form>
  );
}
