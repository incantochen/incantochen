"use client";

import { useState, useTransition, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { requestOtp, verifyOtpCode } from "./actions";
import { safeRedirect } from "@/lib/auth/safe-redirect";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSendCode() {
    setError(null);
    startTransition(async () => {
      const result = await requestOtp(email);
      if (result.ok) {
        setStep("otp");
      } else {
        setError(result.error);
      }
    });
  }

  function handleVerify() {
    setError(null);
    startTransition(async () => {
      const result = await verifyOtpCode(email, code);
      if (result.ok) {
        router.push(redirectTo);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <div className="text-[11px] tracking-[0.34em] text-secondary-400 uppercase">
        LOGIN
      </div>
      <h1 className="mt-2 font-heading text-[34px] text-ink">登入</h1>

      {step === "email" ? (
        <div className="mt-8">
          <label className="block text-[11px] tracking-[0.16em] text-ash uppercase">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={isPending || !email}
            onClick={handleSendCode}
            className="mt-4 w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary-700 disabled:opacity-60"
          >
            {isPending ? "寄送中…" : "寄送驗證碼"}
          </button>
        </div>
      ) : (
        <div className="mt-8">
          <p className="text-sm text-ash">
            驗證碼已寄到 {email}，請輸入信中的驗證碼。
          </p>
          <label className="mt-4 block text-[11px] tracking-[0.16em] text-ash uppercase">
            驗證碼
          </label>
          <input
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="mt-2 w-full rounded-lg border border-border px-3.5 py-3 text-center text-2xl tracking-[0.3em] outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={isPending || code.length < 4}
            onClick={handleVerify}
            className="mt-4 w-full rounded-[2px] bg-primary px-8 py-4 text-[11.5px] font-medium tracking-[0.2em] text-primary-foreground uppercase hover:bg-primary-700 disabled:opacity-60"
          >
            {isPending ? "驗證中…" : "登入"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSendCode}
            className="mt-3 text-sm text-primary underline underline-offset-2"
          >
            重新寄送驗證碼
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
