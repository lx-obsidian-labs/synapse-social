"use client"

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { HomePage } from "@/views/Home"
import { CreatePage } from "@/views/Create"
import { InboxPage } from "@/views/Inbox"
import { InsightsPage } from "@/views/Insights"
import { AIPage } from "@/views/AI"
import { SettingsPage } from "@/views/Settings"
import { FloatingAssistant } from "@/components/floating-assistant"
import { useAppStore, type PageId } from "@/store"

const pages: Record<PageId, React.ReactNode> = {
  home: <HomePage />,
  create: <CreatePage />,
  inbox: <InboxPage />,
  insights: <InsightsPage />,
  ai: <AIPage />,
  settings: <SettingsPage />,
}

export default function App() {
  const currentPage = useAppStore((s) => s.currentPage)

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          <div className="flex items-center border-b bg-card px-4 py-2 md:hidden">
            <SidebarTrigger />
          </div>
          <div className="p-6">
            {pages[currentPage]}
          </div>
        </main>
      </div>
      <FloatingAssistant />
    </SidebarProvider>
  )
}
