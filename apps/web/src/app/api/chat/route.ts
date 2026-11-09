import { NextRequest, NextResponse } from "next/server"

type SafeMessage = { role: "user" | "assistant"; content: string }
export async function POST(req: NextRequest) {
  try {
    const data: unknown = await req.json()
    const incoming = typeof data === "object" && data !== null && "messages" in data
      ? (data as { messages?: unknown }).messages : null
    if (!Array.isArray(incoming) || !incoming.length || incoming.length > 80 ||
        !incoming.every((m: unknown) => typeof m === "object" && m !== null &&
          "role" in m && (m.role === "user" || m.role === "assistant") &&
          "content" in m && typeof m.content === "string" && m.content.length <= 12000)) {
      return NextResponse.json({ error: "Provide 1–80 valid chat messages (max 12,000 characters each)." }, { status: 400 })
    }
    const messages = (incoming as SafeMessage[]).slice(-25)
    const apiKey = process.env.NVIDIA_API_KEY
    if (!apiKey) return NextResponse.json({ error: "NVIDIA API key is not configured on the server" }, { status: 503 })

    // No MCP tools are executed by this endpoint. Tool execution must go through
    // a separate trusted agent runtime with explicit, verifiable user approval.
    const systemPrompt = [
      "You are Synapse AI, a versatile task-planning and research assistant from LX Obsidian Labs.",
      "Help with software, web research, browser-workflow planning, social media, LinkedIn profile reviews and documents.",
      "Be clear, practical and capable, but never claim you executed browser actions, read private accounts, connected MCP tools or verified live data unless tool outputs are actually supplied.",
      "This chat route has no external tool execution. When execution is requested, explain that a connected, approved agent is required.",
      "Do not claim to publish, post, message, delete or change accounts. Ask for approval before high-impact external actions."
    ].join(" ")
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "meta/llama-3.1-8b-instruct",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        max_tokens: 1536,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(45000),
      cache: "no-store"
    })
    if (!response.ok) {
      console.error("NVIDIA response status:", response.status)
      return NextResponse.json({ error: "The AI provider is temporarily unavailable" }, { status: 502 })
    }
    const json = await response.json()
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) return NextResponse.json({ error: "Empty AI response" }, { status: 502 })
    return NextResponse.json({ content: content.trim() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Chat route failed:", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({ error: "Chat request failed" }, { status: 500 })
  }
}
