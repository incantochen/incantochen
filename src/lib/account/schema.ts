import { z } from "zod"

export const profileFormSchema = z.object({
  name: z.string().trim().max(100, "姓名長度上限 100 字"),
})

export type ProfileFormValues = z.infer<typeof profileFormSchema>
