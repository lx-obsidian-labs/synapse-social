"use client"

import { AIPage } from "@/views/AI"

// Synapse is conversation-first. Legacy pages remain in the repository for
// migration and can be reached again once their capabilities are exposed
// through audited tools rather than competing navigation buttons.
export default function App() {
  return <AIPage />
}
