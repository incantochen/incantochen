import type { ZodError } from "zod"

export function flattenFieldErrors<TKey extends string = string>(
  error: ZodError,
): Partial<Record<TKey, string>> {
  const fieldErrors: Partial<Record<TKey, string>> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === "string" && !fieldErrors[key as TKey]) {
      fieldErrors[key as TKey] = issue.message
    }
  }
  return fieldErrors
}
