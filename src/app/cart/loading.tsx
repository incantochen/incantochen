import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1240px] px-6 py-8">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-9 w-40" />

      <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:grid-cols-[1.6fr_0.9fr]">
        <div className="space-y-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[90px_1fr_auto] items-center gap-4 border-b border-border py-5">
              <Skeleton className="h-[90px] w-[90px] rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-8 w-24 rounded-lg" />
              </div>
              <Skeleton className="h-5 w-16 justify-self-end" />
            </div>
          ))}
        </div>

        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  )
}
