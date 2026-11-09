"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUp, Bot, CircleHelp, Globe2, Menu, MessageSquarePlus, PlugZap, Settings2, ShieldCheck, Trash2, X } from "lucide-react"

type Message = { id: string; role: "user" | "assistant"; content: string }
type Thread = { id: string; title: string; messages: Message[]; updatedAt: number }
const KEY = "synapse_threads_v2"
const welcome: Message = { id: "welcome", role: "assistant", content: "Welcome to Synapse. Tell me what you want to achieve — I can help plan research, automate browser workflows, review LinkedIn profiles and prepare content. Connected tools are managed separately and only execute when available." }
const starters = [
  "Audit my LinkedIn profile for software engineering roles",
  "Research competitors and create a concise report",
  "Plan a browser workflow for a repetitive task",
]
const providers = [
  { name: "Chrome DevTools", type: "Local browser", detail: "Navigation, debugging and performance" },
  { name: "LinkedIn", type: "Local account", detail: "Profiles, jobs and networking" },
  { name: "Firecrawl", type: "Hosted web", detail: "Search, scrape and crawl" },
  { name: "Browserbase", type: "Optional cloud", detail: "Remote browser sessions" },
]
function newThread(): Thread {
  return { id: crypto.randomUUID(), title: "New conversation", messages: [welcome], updatedAt: Date.now() }
}
export function AIPage() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [active, setActive] = useState("")
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [connections, setConnections] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let saved: Thread[] = []
    try {
      const raw = localStorage.getItem(KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) saved = parsed.filter((t): t is Thread =>
        !!t && typeof t.id === "string" && typeof t.title === "string" &&
        Array.isArray(t.messages) && t.messages.every((m: unknown) =>
          !!m && typeof m === "object" && "role" in m && "content" in m &&
          (m.role === "user" || m.role === "assistant") && typeof m.content === "string"))
        .slice(0, 40)
    } catch { /* corrupt browser storage must not prevent chat */ }
    const initial = saved.length ? saved : [newThread()]
    setThreads(initial)
    setActive(initial[0].id)
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (hydrated) {
      try { localStorage.setItem(KEY, JSON.stringify(threads.slice(0, 40))) } catch { /* storage unavailable */ }
    }
  }, [threads, hydrated])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [threads, active, loading])

  const current = threads.find(t => t.id === active)
  function addThread() {
    abortRef.current?.abort()
    setLoading(false)
    const next = newThread()
    setThreads(ts => [next, ...ts].slice(0, 40))
    setActive(next.id)
    setDrawer(false)
    setConnections(false)
  }
  function chooseThread(id: string) {
    abortRef.current?.abort()
    setLoading(false)
    setActive(id)
    setDrawer(false)
  }
  function deleteThread(id: string) {
    if (active === id) abortRef.current?.abort()
    const remaining = threads.filter(t => t.id !== id)
    if (!remaining.length) {
      const fresh = newThread()
      setThreads([fresh])
      setActive(fresh.id)
    } else {
      setThreads(remaining)
      if (active === id) setActive(remaining[0].id)
    }
    setLoading(false)
  }
  async function send(value: string) {
    const text = value.trim()
    if (!text || loading || !current) return
    const threadId = current.id
    const user: Message = { id: crypto.randomUUID(), role: "user", content: text }
    const nextMessages = [...current.messages, user]
    setThreads(ts => ts.map(t => t.id === threadId ? {
      ...t, title: t.messages.length <= 1 ? text.slice(0, 65) : t.title,
      messages: nextMessages, updatedAt: Date.now()
    } : t))
    setInput("")
    setLoading(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages.filter(m => m.id !== "welcome").map(({ role, content }) => ({ role, content })) }),
        signal: controller.signal
      })
      const payload = await response.json()
      if (controller.signal.aborted) return
      const answer = response.ok && typeof payload.content === "string"
        ? payload.content : "I couldn't complete that request. " + (payload.error || "Please retry.")
      setThreads(ts => ts.map(t => t.id === threadId ? {
        ...t, messages: [...t.messages, { id: crypto.randomUUID(), role: "assistant", content: answer }],
        updatedAt: Date.now()
      } : t))
    } catch (error) {
      if (controller.signal.aborted) return
      setThreads(ts => ts.map(t => t.id === threadId ? {
        ...t, messages: [...t.messages, { id: crypto.randomUUID(), role: "assistant", content: "The connection failed. Please try again." }]
      } : t))
    } finally {
      if (abortRef.current === controller) { abortRef.current = null; setLoading(false) }
    }
  }
  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-background text-foreground">
      {drawer && <button aria-label="Close conversations" onClick={() => setDrawer(false)} className="fixed inset-0 z-20 bg-black/50 md:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r bg-card transition-transform md:static md:translate-x-0 ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between p-4">
          <span className="flex items-center gap-2 text-base font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">S</span> Synapse AI</span>
          <button className="rounded-lg p-2 hover:bg-muted md:hidden" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18}/></button>
        </div>
        <div className="px-3 pb-3">
          <button onClick={addThread} className="flex w-full items-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium hover:bg-muted"><MessageSquarePlus size={17}/> New conversation</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent conversations</p>
          {threads.map(t => (
            <div key={t.id} className={`group mb-1 flex items-center gap-1 rounded-xl ${active === t.id ? "bg-muted" : "hover:bg-muted/60"}`}>
              <button onClick={() => chooseThread(t.id)} className="min-w-0 flex-1 truncate px-3 py-3 text-left text-sm" title={t.title}>{t.title}</button>
              <button aria-label={`Delete ${t.title}`} title="Delete conversation" className="mr-1 rounded p-2 text-muted-foreground opacity-50 hover:text-destructive group-hover:opacity-100" onClick={() => deleteThread(t.id)}><Trash2 size={14}/></button>
            </div>
          ))}
        </div>
        <div className="border-t p-3">
          <button onClick={() => { setConnections(true); setDrawer(false) }} className="flex w-full items-center gap-3 rounded-xl p-3 text-sm hover:bg-muted"><PlugZap size={18}/> Connections <span className="ml-auto text-xs text-muted-foreground">Configure</span></button>
          <p className="px-3 pt-2 text-[11px] text-muted-foreground">Conversations are saved in this browser only.</p>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 md:px-7">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 hover:bg-muted md:hidden" aria-label="Open conversations"><Menu size={20}/></button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{current?.title || "Synapse"}</h1><p className="text-xs text-muted-foreground">Your conversational workspace</p></div>
          <button onClick={() => setConnections(v => !v)} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs hover:bg-muted"><Settings2 size={15}/> Tools</button>
        </header>

        {connections ? (
          <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6">
            <h2 className="mb-2 text-2xl font-semibold">Connections</h2>
            <p className="mb-6 text-sm text-muted-foreground">Available integrations to configure in your local MCP companion. Listed here does not mean connected. No tools are executed by this web chat automatically.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map(p => <div key={p.name} className="rounded-2xl border bg-card p-4"><div className="mb-2 flex items-center gap-2"><Globe2 size={17} className="text-primary"/><strong>{p.name}</strong></div><p className="text-xs text-muted-foreground">{p.type} · {p.detail}</p><span className="mt-4 inline-flex text-xs text-muted-foreground"><ShieldCheck size={14} className="mr-1"/> Setup required</span></div>)}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">Run the MCP companion locally and follow <code>docs/mcp-integrations.md</code> for approved server configuration and permission boundaries.</p>
            <button onClick={() => setConnections(false)} className="mt-5 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">Back to chat</button>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {(current?.messages || []).map(m => <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot size={17}/></span>}
                  <div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-7 sm:max-w-[80%] ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border"}`}>{m.content}</div>
                </div>)}
                {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Bot size={17}/> Synapse is thinking…</div>}
                {current?.messages.length === 1 && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">Try asking</p>{starters.map(s => <button key={s} onClick={() => send(s)} className="block w-full rounded-xl border bg-card p-3 text-left text-sm hover:bg-muted">{s}</button>)}</div>}
                <div ref={bottomRef}/>
              </div>
            </div>
            <div className="shrink-0 px-4 pb-4 pt-2 md:px-8 md:pb-6">
              <form onSubmit={e => { e.preventDefault(); void send(input) }} className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border bg-card p-3 shadow-sm">
                <textarea aria-label="Message Synapse" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input) } }} rows={2} placeholder="Message Synapse… describe your goal in plain language" className="max-h-40 min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"/>
                <button type="submit" disabled={!input.trim() || loading} aria-label="Send message" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><ArrowUp size={19}/></button>
              </form>
              <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">AI responses may be inaccurate. External actions require a connected agent and approval.</p>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
