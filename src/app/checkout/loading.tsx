import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-9 w-24" />

      <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>

        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </div>
  )
}
