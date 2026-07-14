import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getImagePublicUrl } from "@/lib/storage/product-images";
import { ImageManager } from "./image-manager";

export default async function AdminProductImagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  // 非 uuid 的網址（舊書籤、手改）直接 404，不讓 uuid cast 錯誤變 500
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = createServiceRoleClient();

  // 商品＋圖片一次 embedded 查詢（省一趟往返）；sort_order 加 id 當第二排序鍵，
  // 順序完全確定
  const { data: product, error: productError } = await supabase
    .from("product")
    .select("id, name, slug, product_image(id, storage_path, alt, sort_order)")
    .eq("id", id)
    .order("sort_order", { ascending: true, referencedTable: "product_image" })
    .order("id", { ascending: true, referencedTable: "product_image" })
    .maybeSingle();

  if (productError) {
    throw new Error(`查詢商品失敗：${productError.message}`);
  }
  if (!product) notFound();

  // 公開 URL 在伺服器端組好再下傳，client 不需要知道 Storage 路徑規則
  const items = product.product_image.map((img) => ({
    id: img.id,
    alt: img.alt,
    publicUrl: getImagePublicUrl(img.storage_path),
  }));

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/admin/products"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 商品管理
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">
          {product.name} — 圖片管理
        </h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">{product.slug}</p>
      </div>

      <ImageManager productId={product.id} images={items} />
    </div>
  );
}
