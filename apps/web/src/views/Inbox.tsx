"use client"

import { useState } from "react"
import { Search, Send, Sparkles } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { ConnectPrompt } from "@/components/connect-prompt"
import { isExtensionContext } from "@/lib/extension-bridge"
import { mockConversations, suggestedReplies } from "@/store"

export function InboxPage() {
  const inExtension = isExtensionContext()

  if (!inExtension) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Inbox</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your conversations</p>
        <ConnectPrompt />
      </div>
    )
  }

  const [activeTab, setActiveTab] = useState("all")
  const [selectedConv, setSelectedConv] = useState(mockConversations[0])
  const [reply, setReply] = useState("")

  const filtered = activeTab === "unread"
    ? mockConversations.filter((c) => c.unread > 0)
    : mockConversations

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      <Card className="flex w-[340px] shrink-0 flex-col">
        <div className="border-b p-3">
          <h2 className="mb-3 text-base font-semibold">Inbox</h2>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search conversations..." className="pl-9" />
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-3">
            <TabsList className="w-full">
              <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
              <TabsTrigger value="unread" className="flex-1">Unread</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <ScrollArea className="flex-1">
          {filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setSelectedConv(conv)}
              className={`flex w-full items-start gap-3 border-b p-3 text-left transition-colors hover:bg-muted/50 ${
                selectedConv?.id === conv.id ? "bg-primary/5" : ""
              }`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {conv.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{conv.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(conv.timestamp).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{conv.lastMessage}</p>
              </div>
              {conv.unread > 0 && (
                <Badge className="ml-auto shrink-0 px-1.5 py-0 text-[10px]">{conv.unread}</Badge>
              )}
            </button>
          ))}
        </ScrollArea>
      </Card>

      {selectedConv && (
        <Card className="flex flex-1 flex-col">
          <div className="flex items-center gap-3 border-b p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-medium">
              {selectedConv.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{selectedConv.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Facebook</Badge>
              </div>
              <span className="text-xs text-muted-foreground">Active now</span>
            </div>
          </div>

          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {selectedConv.messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.sender === "page" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[70%] rounded-xl px-4 py-2 ${
                      msg.sender === "page"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <p className="text-sm">{msg.content}</p>
                    <p className={`mt-1 text-[10px] ${msg.sender === "page" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="border-t p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              {suggestedReplies.slice(0, 2).map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setReply(suggestion)}
                  className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary"
                >
                  <Sparkles size={10} className="text-primary" /> {suggestion.length > 40 ? suggestion.slice(0, 40) + "..." : suggestion}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Textarea
                placeholder="Type a reply..."
                className="min-h-[40px] resize-none"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    setReply("")
                  }
                }}
              />
              <Button size="icon" className="shrink-0" disabled={!reply.trim()}>
                <Send size={16} />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
