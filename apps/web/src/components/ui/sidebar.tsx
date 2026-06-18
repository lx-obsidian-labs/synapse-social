"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

const SIDEBAR_WIDTH = 260

type SidebarContextValue = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  isMobile: boolean
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider")
  }
  return context
}

export function SidebarProvider({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const [open, setOpen] = React.useState(true)
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  return (
    <SidebarContext.Provider value={{ open, setOpen, isMobile }}>
      <div data-sidebar-provider className={cn("flex min-h-screen", className)} {...props}>
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

export function SidebarTrigger({ className, onClick, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpen } = useSidebar()
  return (
    <button
      data-sidebar-trigger
      onClick={(e) => {
        setOpen((prev: boolean) => !prev)
        onClick?.(e)
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground",
        className
      )}
      {...props}
    >
      {children || (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      )}
    </button>
  )
}

export function Sidebar({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open, isMobile } = useSidebar()

  if (isMobile && !open) return null

  return (
    <div
      data-sidebar
      className={cn(
        "flex h-screen flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200",
        isMobile ? "fixed inset-y-0 left-0 z-50 shadow-lg" : "sticky top-0",
        (open || isMobile) ? "" : "w-0 overflow-hidden border-r-0",
        className
      )}
      style={{ width: open || isMobile ? SIDEBAR_WIDTH : 0, minWidth: open || isMobile ? SIDEBAR_WIDTH : 0 }}
      {...props}
    >
      {children}
    </div>
  )
}

export function SidebarHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex h-14 items-center border-b px-4", className)} {...props} />
}

export function SidebarContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-auto py-2", className)} {...props} />
}

export function SidebarFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center border-t px-4 py-3", className)} {...props} />
}

export function SidebarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-3 py-1", className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export function SidebarMenu({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-0.5", className)} {...props} />
}

export function SidebarMenuItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("", className)} {...props} />
}

interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  isActive?: boolean
}

export function SidebarMenuButton({ className, asChild = false, isActive, children, ...props }: SidebarMenuButtonProps) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        className
      )}
      {...props}
    >
      {children}
    </Comp>
  )
}
