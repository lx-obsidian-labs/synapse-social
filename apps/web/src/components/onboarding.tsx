"use client"

import { useState } from "react"
import { Check, ChevronLeft, ChevronRight, Sparkles, Bot, Globe, User, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAppStore } from "@/store"

const AI_MODELS = [
  "meta/llama-3.1-8b-instruct",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.2-11b-vision-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  "nvidia/nemotron-3-ultra-550b-a55b",
]

const STEPS = ["Welcome", "Connect", "AI Setup", "Your Brand", "Done"]

export function Onboarding() {
  const onboarded = useAppStore((s) => s.onboarded)
  const setOnboarded = useAppStore((s) => s.setOnboarded)
  const aiModel = useAppStore((s) => s.aiModel)
  const setAiModel = useAppStore((s) => s.setAiModel)
  const apiKey = useAppStore((s) => s.apiKey)
  const setApiKey = useAppStore((s) => s.setApiKey)
  const brand = useAppStore((s) => s.brand)
  const setBrand = useAppStore((s) => s.setBrand)

  const [step, setStep] = useState(0)
  const [brandDraft, setBrandDraft] = useState(brand)

  if (onboarded) return null

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))
  const finish = () => {
    setBrand(brandDraft)
    setOnboarded(true)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="border-b bg-gradient-to-r from-primary/10 to-transparent p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              S
            </div>
            <span className="text-base font-semibold">Synapse Social</span>
          </div>
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div
                  className={
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors " +
                    (i < step
                      ? "bg-primary text-primary-foreground"
                      : i === step
                        ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  {i < step ? <Check size={14} /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={"h-0.5 flex-1 rounded " + (i < step ? "bg-primary" : "bg-muted")} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-[260px] p-6">
          {step === 0 && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles size={28} className="text-primary" />
              </div>
              <h2 className="text-xl font-bold">Welcome to Synapse Social</h2>
              <p className="text-sm text-muted-foreground">
                Your AI-powered command center for Facebook Page management. In a few quick steps we&apos;ll
                connect your page, tune your assistant, and learn your brand voice.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Globe size={20} className="text-primary" />
                <h2 className="text-xl font-bold">Connect your Facebook Page</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Install the Synapse Social browser extension and open your Facebook Page. We&apos;ll pull in your
                real posts, comments, and messages automatically.
              </p>
              <ol className="space-y-2 text-sm">
                <li className="flex gap-2"><span className="font-semibold text-primary">1.</span> Add the Chrome extension from the Web Store.</li>
                <li className="flex gap-2"><span className="font-semibold text-primary">2.</span> Navigate to your Facebook Page and click the Synapse button.</li>
              </ol>
              <a
                href="https://chrome.google.com/webstore"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <ExternalLink size={14} /> Get the extension
              </a>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Bot size={20} className="text-primary" />
                <h2 className="text-xl font-bold">Configure your AI</h2>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-model">Model</Label>
                <Select value={aiModel} onValueChange={setAiModel}>
                  <SelectTrigger id="ob-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-key">API Key</Label>
                <Input
                  id="ob-key"
                  type="password"
                  placeholder="nvapi-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  AI calls use the NVIDIA NIM API. Leave the key empty to use the server default.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <User size={20} className="text-primary" />
                <h2 className="text-xl font-bold">Tell us about your brand</h2>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-name">Brand Name</Label>
                <Input
                  id="ob-name"
                  placeholder="e.g. LX Obsidian Portal"
                  value={brandDraft.name}
                  onChange={(e) => setBrandDraft({ ...brandDraft, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-niche">Niche</Label>
                <Input
                  id="ob-niche"
                  placeholder="e.g. Digital Products & Web"
                  value={brandDraft.niche}
                  onChange={(e) => setBrandDraft({ ...brandDraft, niche: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob-audience">Target Audience</Label>
                <Input
                  id="ob-audience"
                  placeholder="e.g. Creators and small businesses"
                  value={brandDraft.audience}
                  onChange={(e) => setBrandDraft({ ...brandDraft, audience: e.target.value })}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
                <Check size={28} className="text-success" />
              </div>
              <h2 className="text-xl font-bold">You&apos;re all set</h2>
              <p className="text-sm text-muted-foreground">
                Synapse Social is ready. Jump in, create content, and let your AI assistant handle the busywork.
                You can fine-tune anything later in Settings.
              </p>
              <a
                href="https://www.lxobsidianportal.co.za"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:underline"
              >
                <ExternalLink size={12} /> Built by LX Obsidian Portal
              </a>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t p-4">
          <Button variant="ghost" onClick={back} disabled={step === 0} className="gap-1">
            <ChevronLeft size={16} /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} className="gap-1">
              Next <ChevronRight size={16} />
            </Button>
          ) : (
            <Button onClick={finish} className="gap-1">
              Finish <Check size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
