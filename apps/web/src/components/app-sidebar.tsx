"use client"

import { Home, PenSquare, MessageSquare, BarChart3, Bot, Settings } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useAppStore, type PageId } from "@/store"

const navItems: { id: PageId; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "Home", icon: <Home size={20} /> },
  { id: "create", label: "Create", icon: <PenSquare size={20} /> },
  { id: "inbox", label: "Inbox", icon: <MessageSquare size={20} /> },
  { id: "insights", label: "Insights", icon: <BarChart3 size={20} /> },
  { id: "ai", label: "AI Assistant", icon: <Bot size={20} /> },
  { id: "settings", label: "Settings", icon: <Settings size={20} /> },
]

export function AppSidebar() {
  const currentPage = useAppStore((s) => s.currentPage)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            S
          </div>
          <span className="text-base font-semibold">Synapse Social</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                isActive={currentPage === item.id}
                onClick={() => setCurrentPage(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-medium">
            N
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">Nathan</span>
            <span className="text-xs text-muted-foreground">Page Admin</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
