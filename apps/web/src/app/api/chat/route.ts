import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "Messages array is required" }, { status: 400 })
    }

    const apiKey = process.env.NVIDIA_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "NVIDIA API key not configured" }, { status: 500 })
    }

    const systemPrompt =
      "You are Synapse, an AI assistant specialized in Facebook Page management. Help users create content, analyze performance, manage comments, and optimize their social media strategy. Be concise, practical, and data-driven. You have access to the user's Facebook Page data and can provide insights based on it."

    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "meta/llama-3.1-8b-instruct",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error("NVIDIA API error:", res.status, errText)
      return NextResponse.json({ error: "AI response failed" }, { status: 502 })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() || ""

    return NextResponse.json({ content })
  } catch (err) {
    console.error("Chat API error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
