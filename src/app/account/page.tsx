import { requireUser } from "@/lib/auth/require-user"
import { signOut } from "./actions"

export default async function AccountPage() {
  const user = await requireUser()

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-heading text-[28px] text-ink">歡迎回來，{user.email}</h1>
      <form action={signOut}>
        <button
          type="submit"
          className="mt-6 rounded-[2px] border border-primary px-8 py-3 text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground"
        >
          登出
        </button>
      </form>
    </div>
  )
}
