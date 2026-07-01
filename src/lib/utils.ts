import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false,
  })
}

export function formatCurrency(amount: number) {
  return `NT$ ${amount.toLocaleString()}`
}
