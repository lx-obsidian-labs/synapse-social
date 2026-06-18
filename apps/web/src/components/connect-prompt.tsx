"use client"

import { Download, ExternalLink } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function ConnectPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <Download size={36} className="text-primary" />
      </div>
      <h2 className="text-xl font-bold">Connect Your Facebook Page</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Install the Synapse Social Chrome extension and navigate to your Facebook Page to see your real data here.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 text-left">
            <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white text-xs font-bold">
              1
            </div>
            <h3 className="text-sm font-medium">Install Extension</h3>
            <p className="mt-1 text-xs text-muted-foreground">Add the Chrome extension from the Chrome Web Store.</p>
          </CardContent>
        </Card>
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 text-left">
            <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white text-xs font-bold">
              2
            </div>
            <h3 className="text-sm font-medium">Open Facebook</h3>
            <p className="mt-1 text-xs text-muted-foreground">Go to your Facebook Page and click the Synapse button.</p>
          </CardContent>
        </Card>
      </div>
      <div className="mt-6 flex gap-3">
        <Button variant="default" className="gap-2" asChild>
          <a href="https://chrome.google.com/webstore" target="_blank" rel="noreferrer">
            <Download size={16} /> Install Extension
          </a>
        </Button>
        <Button variant="outline" className="gap-2" onClick={() => window.open("https://facebook.com", "_blank")}>
          <ExternalLink size={16} /> Open Facebook
        </Button>
      </div>
    </div>
  )
}
