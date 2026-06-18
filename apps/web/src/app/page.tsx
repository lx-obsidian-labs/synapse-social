"use client";

import { useState } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { HomePage } from '@/pages/Home';

export default function App() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          <SidebarTrigger className="m-4 md:hidden" />
          <div className="p-6">
            <HomePage />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
