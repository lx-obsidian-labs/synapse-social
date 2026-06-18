"use client"

import { TrendingUp, TrendingDown, Users, Eye, Heart, Share2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ConnectPrompt } from "@/components/connect-prompt"
import { isExtensionContext } from "@/lib/extension-bridge"
import { mockInsights, weeklyReach, engagementData } from "@/store"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts"

const COLORS = ["#1877F2", "#42B72A", "#F7B928", "#FA3E3E"]

function MetricCard({ icon, label, value, change, positive }: { icon: React.ReactNode; label: string; value: string; change: string; positive: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
          <span className={`flex items-center text-sm ${positive ? "text-success" : "text-destructive"}`}>
            {positive ? <TrendingUp size={14} className="mr-0.5" /> : <TrendingDown size={14} className="mr-0.5" />}
            {change}
          </span>
        </div>
        <div className="mt-3">
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}

export function InsightsPage() {
  const inExtension = isExtensionContext()

  if (!inExtension) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">Analytics and performance metrics</p>
        <ConnectPrompt />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="mt-1 text-sm text-muted-foreground">Analytics and performance metrics</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={<Eye size={18} />} label="Page Reach" value={(mockInsights.reach / 1000).toFixed(1) + "K"} change="+18.2%" positive />
        <MetricCard icon={<Heart size={18} />} label="Engagement" value={(mockInsights.engagement / 1000).toFixed(1) + "K"} change="+12.4%" positive />
        <MetricCard icon={<Users size={18} />} label="Followers" value={(mockInsights.followers / 1000).toFixed(1) + "K"} change="+5.2%" positive />
        <MetricCard icon={<Share2 size={18} />} label="Posts" value={mockInsights.postsCount.toString()} change="-3.1%" positive={false} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekly Reach</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyReach}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="value" fill="#1877F2" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Engagement Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={engagementData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {engagementData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
