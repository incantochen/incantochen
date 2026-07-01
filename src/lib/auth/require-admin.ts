import { redirect } from "next/navigation";
import { serverEnv } from "@/lib/env.server";
import { requireUser } from "@/lib/auth/require-user";

export async function requireAdmin() {
  const user = await requireUser();
  if (user.email !== serverEnv.ADMIN_EMAIL) redirect("/");
  return user;
}
