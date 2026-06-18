"use client"

import { useState } from "react"
import { User, Globe, Shield, Palette, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"

export function SettingsPage() {
  const [notifications, setNotifications] = useState(true)
  const [autoReply, setAutoReply] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User size={16} className="text-primary" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
              N
            </div>
            <div>
              <p className="font-medium">Nathan</p>
              <p className="text-sm text-muted-foreground">Page Admin</p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto">Change Photo</Button>
          </div>
          <Separator />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input id="name" defaultValue="Nathan" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" defaultValue="nathan@synapse.so" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Input id="bio" defaultValue="Facebook Page Admin at Synapse Social" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe size={16} className="text-primary" />
            Workspace
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Connected Pages</p>
              <p className="text-xs text-muted-foreground">Manage your Facebook Pages</p>
            </div>
            <Badge variant="secondary">1 Connected</Badge>
          </div>
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                S
              </div>
              <div>
                <p className="text-sm font-medium">Synapse Social Page</p>
                <p className="text-xs text-muted-foreground">Connected · Admin</p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground">
                Manage <ChevronRight size={14} className="ml-1" />
              </Button>
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2">
            + Connect New Page
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield size={16} className="text-primary" />
            Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Push Notifications</p>
              <p className="text-xs text-muted-foreground">Receive notifications for new comments and messages</p>
            </div>
            <Switch checked={notifications} onCheckedChange={setNotifications} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">AI Auto-Reply</p>
              <p className="text-xs text-muted-foreground">Allow AI to suggest and send replies automatically</p>
            </div>
            <Switch checked={autoReply} onCheckedChange={setAutoReply} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">AI Tone</p>
              <p className="text-xs text-muted-foreground">Set the default tone for AI-generated content</p>
            </div>
            <Select defaultValue="professional">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="casual">Casual</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="humorous">Humorous</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette size={16} className="text-primary" />
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Dark Mode</p>
              <p className="text-xs text-muted-foreground">Switch between light and dark themes</p>
            </div>
            <Switch checked={darkMode} onCheckedChange={setDarkMode} />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Language</p>
              <p className="text-xs text-muted-foreground">Choose your interface language</p>
            </div>
            <Select defaultValue="en">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="es">Spanish</SelectItem>
                <SelectItem value="fr">French</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
