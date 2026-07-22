"use client"

import { useEffect, useState } from "react"
import { FooterColumn } from "@/components/footer-column"

type FooterLink = { label: string; href: string }
type Column = { heading: string; links: FooterLink[] }

// 桌機（md+）偵測提升至此、一次算出以 prop 傳給各欄，避免每個 FooterColumn
// 各建一份 (min-width:768px) matchMedia 監聽（原本三欄=三份）。
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const update = () => setIsDesktop(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])
  return isDesktop
}

// 手機 flex 直排、桌機 md:contents 讓三欄回到父 grid（版式同原 site-footer）。
export function FooterColumns({ columns }: { columns: Column[] }) {
  const isDesktop = useIsDesktop()
  return (
    <div className="flex flex-col md:contents">
      {columns.map((col) => (
        <FooterColumn
          key={col.heading}
          heading={col.heading}
          links={col.links}
          isDesktop={isDesktop}
        />
      ))}
    </div>
  )
}
