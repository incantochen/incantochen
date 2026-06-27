import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // 品牌基底：11.5px、寬字距、大寫、方角 2px、1px 邊框
  "inline-flex shrink-0 items-center justify-center gap-2 border text-[11.5px] font-medium tracking-[.2em] uppercase whitespace-nowrap transition-all outline-none select-none rounded-btn focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // 主要動作：加入購物袋、結帳、付款（淺底用）
        solid:
          "border-primary bg-primary text-primary-foreground hover:bg-primary-700",
        // 深底主 CTA：預約訂製（深底用）
        gold:
          "border-secondary bg-secondary text-secondary-foreground hover:bg-secondary-500",
        // 次要輪廓（淺底用）：所有產品
        outline:
          "border-primary bg-transparent text-primary hover:bg-primary hover:text-primary-foreground",
        // 幽靈（深底用）：金色細框＋金字，hover 淡金底
        ghost:
          "border-[rgba(197,160,89,.55)] bg-transparent text-secondary hover:bg-secondary/10",
        // 危險動作（刪除、取消）
        destructive:
          "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20",
        // 純文字連結
        link: "border-transparent bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 標準品牌尺寸
        default: "px-[30px] py-[15px]",
        // 緊湊（表單內、小空間）
        sm: "px-5 py-2.5 text-[10.5px]",
        // icon 專用（無文字）
        icon: "size-10 p-0 tracking-normal",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
