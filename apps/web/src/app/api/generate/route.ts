import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
    }

    const apiKey = process.env.NVIDIA_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "NVIDIA API key not configured" }, { status: 500 })
    }

    const systemPrompt =
      "You are a social media content creator for a Facebook Page. Generate engaging, well-formatted Facebook posts based on the user's request. Use emojis sparingly. Include relevant hashtags. Keep posts concise (under 200 words). Return only the post content, no explanations."

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
          { role: "user", content: prompt },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error("NVIDIA API error:", res.status, errText)
      return NextResponse.json({ error: "AI generation failed" }, { status: 502 })
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() || ""

    return NextResponse.json({ content })
  } catch (err) {
    console.error("Generate API error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
