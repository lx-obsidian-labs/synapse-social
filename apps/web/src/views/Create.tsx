"use client"

import { useState } from "react"
import { Sparkles, Send, Save, Clock, Hash, ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { templates } from "@/store"

export function CreatePage() {
  const [prompt, setPrompt] = useState("")
  const [generated, setGenerated] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    if (!prompt.trim()) return
    setLoading(true)
    setGenerated("")
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      })
      const data = await res.json()
      if (res.ok) {
        setGenerated(data.content)
      } else {
        setGenerated(`Error: ${data.error || "Generation failed"}`)
      }
    } catch {
      setGenerated("Error: Could not reach the server")
    }
    setLoading(false)
  }

  function handleSelectTemplate(t: typeof templates[0]) {
    setPrompt(t.prompt)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create</h1>
        <p className="mt-1 text-sm text-muted-foreground">Generate content with AI</p>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t)}
                  className="inline-flex items-center rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Hash size={12} className="mr-1" />
                  {t.name}
                </button>
              ))}
            </div>
            <Textarea
              placeholder="Describe the post you want to create..."
              className="min-h-[120px] resize-none text-base"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {prompt.length > 0 ? `${prompt.length} characters` : "Write a prompt to get started"}
              </span>
              <Button onClick={handleGenerate} disabled={!prompt.trim() || loading} className="gap-2">
                <Sparkles size={16} />
                {loading ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {generated && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles size={16} className="text-primary" />
              Generated Result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-card p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{generated}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="default" className="gap-2">
                <Send size={14} /> Publish Now
              </Button>
              <Button variant="outline" className="gap-2">
                <Clock size={14} /> Schedule
              </Button>
              <Button variant="outline" className="gap-2">
                <Save size={14} /> Save Draft
              </Button>
              <Button variant="ghost" className="gap-2 text-muted-foreground">
                Regenerate <ArrowRight size={14} />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!generated && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles size={40} className="mb-4 text-muted-foreground/40" />
            <h3 className="text-lg font-medium">Start creating your next post</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Use a template above or write your own prompt to generate engaging content.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
