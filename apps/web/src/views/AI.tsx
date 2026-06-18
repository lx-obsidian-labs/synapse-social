"use client"

import { useState } from "react"
import { Send, Sparkles, Bot, Lightbulb, Zap, BarChart3, Users, PenSquare } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

const suggestions = [
  { icon: <PenSquare size={14} />, text: "Create a Facebook post" },
  { icon: <BarChart3 size={14} />, text: "Analyze engagement" },
  { icon: <Users size={14} />, text: "Summarize comments" },
  { icon: <Lightbulb size={14} />, text: "Generate campaign ideas" },
]

export function AIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "0",
      role: "assistant",
      content: "Hi! I'm your AI assistant. I can help you create content, analyze performance, manage comments, and more. What would you like to do?",
    },
  ])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSend() {
    if (!input.trim() || loading) return

    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", content: input }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setLoading(true)

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      const reply = res.ok ? data.content : `Error: ${data.error || "Chat failed"}`
      const aiMsg: ChatMessage = { id: Date.now().toString() + "ai", role: "assistant", content: reply }
      setMessages((prev) => [...prev, aiMsg])
    } catch {
      const aiMsg: ChatMessage = { id: Date.now().toString() + "ai", role: "assistant", content: "Error: Could not reach the server" }
      setMessages((prev) => [...prev, aiMsg])
    }
    setLoading(false)
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">AI Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your intelligent copilot for Facebook management</p>
      </div>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b bg-gradient-to-r from-primary/5 to-primary/10 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <Bot size={18} />
          </div>
          <div>
            <div className="text-sm font-medium">Synapse Assistant</div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="flex h-1.5 w-1.5 rounded-full bg-success" />
              Online · Powered by NVIDIA NIM
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Bot size={16} />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-xl px-4 py-2.5 ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-start">
                <div className="mr-2 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot size={16} />
                </div>
                <div className="rounded-xl bg-muted px-4 py-2.5">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "0ms" }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "150ms" }} />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {messages.length === 1 && (
          <div className="flex flex-wrap justify-center gap-2 px-4 py-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => {
                  setInput(s.text)
                }}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <span className="text-primary">{s.icon}</span>
                {s.text}
              </button>
            ))}
          </div>
        )}

        <div className="border-t p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Input
                placeholder="Ask Synapse anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="pr-10"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-primary"
                disabled={!input.trim() || loading}
              >
                <Send size={16} />
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  )
}
