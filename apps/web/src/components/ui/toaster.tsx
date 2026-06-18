"use client"

import * as React from "react"
import * as ToasterPrimitive from "@radix-ui/react-toast"
import { Toaster } from "@/components/ui/toast"

export function ToasterComponent() {
  return (
    <ToastProvider>
      <Toaster />
      <ToastViewport />
    </ToastProvider>
  )
}