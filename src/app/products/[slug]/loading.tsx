import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <Skeleton className="h-3 w-48" />

      <div className="mt-8 grid grid-cols-1 items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Skeleton className="aspect-square w-full rounded-lg" />
          <div className="mt-2.5 grid grid-cols-4 gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-lg" />
            ))}
          </div>
        </div>

        <div>
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-3 h-9 w-2/3" />
          <Skeleton className="mt-6 h-8 w-40" />
          <div className="mt-8 space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-3 w-24" />
                <div className="mt-2 flex gap-2.5">
                  <Skeleton className="h-10 w-20 rounded-lg" />
                  <Skeleton className="h-10 w-20 rounded-lg" />
                  <Skeleton className="h-10 w-20 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="mt-8 h-14 w-full rounded-btn" />
        </div>
      </div>
    </div>
  )
}
