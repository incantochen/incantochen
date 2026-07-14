import { redirect } from "next/navigation"

// MVP 僅戒指有商品；之後多品類都上架後可改回真正的全品類索引頁。
export default function CollectionsIndexPage() {
  redirect("/collections/ring")
}
