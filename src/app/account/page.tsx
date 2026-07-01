import Link from "next/link"

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <Link
        href="/account/orders"
        className="rounded-[2px] border border-primary px-8 py-3 text-center text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground"
      >
        查看訂單
      </Link>
      <Link
        href="/account/profile"
        className="rounded-[2px] border border-primary px-8 py-3 text-center text-[11.5px] font-medium tracking-[0.2em] text-primary uppercase hover:bg-primary hover:text-primary-foreground"
      >
        個人資料
      </Link>
    </div>
  )
}
