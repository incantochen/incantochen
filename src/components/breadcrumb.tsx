import { Fragment } from "react"
import Link from "next/link"

export type BreadcrumbItem = { label: string; href?: string }

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="text-xs tracking-[0.1em] text-ash uppercase">
      {items.map((item, i) => (
        <Fragment key={i}>
          {item.href ? (
            <Link href={item.href} className="hover:text-primary">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
          {i < items.length - 1 && " / "}
        </Fragment>
      ))}
    </nav>
  )
}
