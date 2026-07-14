import { Gem } from "lucide-react"
import { cn } from "@/lib/utils"

// 真實商品圖／3D 合成素材（T55/T56）到位前的佔位方塊，單一出處供 PDP 主圖、
// 購物車縮圖、商品卡共用。
export function PlaceholderImage({
  iconSize = "size-10",
  caption,
  className,
}: {
  iconSize?: string
  caption?: string
  className?: string
}) {
  return (
    <div className={cn("relative flex items-center justify-center bg-cloud", className)}>
      <Gem className={cn(iconSize, "text-ash/60")} strokeWidth={1.2} />
      {caption && (
        <span className="absolute bottom-2 left-0 right-0 text-center text-[10.5px] tracking-[0.14em] text-ash uppercase">
          {caption}
        </span>
      )}
    </div>
  )
}
