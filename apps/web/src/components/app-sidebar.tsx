"use client"

import { Home, PenSquare, MessageSquare, BarChart3, Bot, Settings, PanelLeftClose, PanelLeft } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
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
  const { open, setOpen } = useSidebar()

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            S
          </div>
          {open && <span className="text-base font-semibold">Synapse Social</span>}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.id}>
              <SidebarMenuButton
                isActive={currentPage === item.id}
                onClick={() => setCurrentPage(item.id)}
                title={!open ? item.label : undefined}
              >
                <span className="shrink-0">{item.icon}</span>
                {open && <span>{item.label}</span>}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            N
          </div>
          {open && (
            <div className="flex flex-1 flex-col">
              <span className="text-sm font-medium">Nathan</span>
              <span className="text-xs text-muted-foreground">Page Admin</span>
            </div>
          )}
          {open && (
            <button
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              title="Collapse sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            title="Expand sidebar"
          >
            <PanelLeft size={16} />
          </button>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
