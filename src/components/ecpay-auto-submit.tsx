"use client"

import { useEffect } from "react"

export function EcpayAutoSubmit({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null
    form?.submit()
  }, [formId])
  return null
}
