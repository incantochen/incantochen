import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getProductImagePublicUrl } from "@/lib/storage/product-images";
import { ImageManager } from "./image-manager";

export default async function AdminProductImagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id } = await params;
  const supabase = createServiceRoleClient();

  const { data: product, error: productError } = await supabase
    .from("product")
    .select("id, name, slug")
    .eq("id", id)
    .maybeSingle();

  if (productError) {
    throw new Error(`查詢商品失敗：${productError.message}`);
  }
  if (!product) notFound();

  const { data: images, error: imagesError } = await supabase
    .from("product_image")
    .select("id, storage_path, alt, sort_order")
    .eq("product_id", id)
    .order("sort_order", { ascending: true });

  if (imagesError) {
    throw new Error(`查詢商品圖片失敗：${imagesError.message}`);
  }

  // 公開 URL 在伺服器端組好再下傳，client 不需要知道 Storage 路徑規則
  const items = (images ?? []).map((img) => ({
    id: img.id,
    alt: img.alt,
    publicUrl: getProductImagePublicUrl(img.storage_path),
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
