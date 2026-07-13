import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-6 h-9 w-40" />
      <Skeleton className="mt-2 h-4 w-72" />

      <div className="mt-8 flex gap-6 border-b border-border pb-3.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="mt-3 h-3 w-24" />
            <Skeleton className="mt-2 h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
