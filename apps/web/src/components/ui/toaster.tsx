"use client"

import {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
} from "@/components/ui/toast"

export function ToasterComponent() {
  return (
    <ToastProvider>
      <Toast>
        <div className="grid gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastClose />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  )
}
