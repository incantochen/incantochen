import { requireUser } from "@/lib/auth/require-user"
import { AccountNav } from "@/components/account-nav"

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()

  return (
    <div className="mx-auto max-w-[1240px] px-6 py-10">
      <div className="eyebrow">MY ACCOUNT</div>
      <h1 className="mt-2 font-heading text-[34px] text-ink">會員中心</h1>
      <p className="mt-2 text-sm text-ash">哈囉，妳好 · {user.email}</p>

      <div className="mt-9 grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr] md:gap-9">
        <div className="md:sticky md:top-[var(--header-height)] md:self-start">
          <AccountNav />
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
