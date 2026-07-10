import "server-only";
import { headers } from "next/headers";

export function getClientIp(
  headersList: Awaited<ReturnType<typeof headers>>,
): string | null {
  return (
    headersList.get("cf-connecting-ip") ??
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    null
  );
}
