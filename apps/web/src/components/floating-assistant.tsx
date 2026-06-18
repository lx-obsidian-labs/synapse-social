"use client"

import { useState } from "react"
import { Bot, X, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

export function FloatingAssistant() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([])
  const [input, setInput] = useState("")

  function handleSend() {
    if (!input.trim()) return
    setMessages((prev) => [...prev, { role: "user", content: input }])
    setInput("")
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", content: "I'll help you with that! Could you provide more details?" }])
    }, 800)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-[20px] bg-primary px-5 py-3 text-white shadow-lg transition-transform hover:scale-105"
      >
        <Bot size={20} />
        <span className="text-sm font-medium">Synapse</span>
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex w-[360px] flex-col rounded-2xl border bg-card shadow-xl">
      <div className="flex items-center justify-between rounded-t-2xl bg-gradient-to-r from-primary to-primary/80 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Bot size={18} />
          <span className="text-sm font-medium">Ask Synapse...</span>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-full p-1 hover:bg-white/20">
          <X size={16} />
        </button>
      </div>

      <ScrollArea className="h-[320px] p-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Bot size={32} className="mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Ask me anything about your page</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <div className="border-t p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className="flex gap-2"
        >
          <Input
            placeholder="Ask Synapse..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-9 text-sm"
          />
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!input.trim()}>
            <Send size={14} />
          </Button>
        </form>
      </div>
    </div>
  )
}
