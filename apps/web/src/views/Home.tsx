"use client"

import { Clock, MessageSquare, TrendingUp, AlertCircle, Sparkles, ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { mockComments, mockPosts, mockInsights } from "@/store"

function StatCard({ label, value, trend }: { label: string; value: string; trend?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold">{value}</span>
          {trend && (
            <span className="flex items-center text-sm text-success">
              <TrendingUp size={14} className="mr-0.5" /> {trend}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Home</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your daily command center</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Page Reach" value={(mockInsights.reach / 1000).toFixed(1) + "K"} trend="+18%" />
        <StatCard label="Engagement" value={(mockInsights.engagement / 1000).toFixed(1) + "K"} trend="+12%" />
        <StatCard label="Followers" value={(mockInsights.followers / 1000).toFixed(1) + "K"} trend="+5.2%" />
        <StatCard label="Posts This Month" value={mockInsights.postsCount.toString()} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare size={16} className="text-primary" />
              Pending Replies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mockComments.filter((c) => !c.resolved).slice(0, 3).map((comment) => (
              <div key={comment.id} className="flex items-start gap-3 rounded-lg bg-muted/50 p-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {comment.author.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{comment.author}</span>
                    <Badge variant={comment.sentiment === "positive" ? "success" : comment.sentiment === "negative" ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
                      {comment.sentiment}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground truncate">{comment.content}</p>
                </div>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
              View all <ArrowRight size={14} className="ml-1" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock size={16} className="text-primary" />
              Content to Publish
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mockPosts.filter((p) => p.status === "scheduled" || p.status === "draft").slice(0, 3).map((post) => (
              <div key={post.id} className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={post.status === "scheduled" ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0">
                    {post.status}
                  </Badge>
                  {post.scheduledAt && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(post.scheduledAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm line-clamp-2">{post.content}</p>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
              Create new post <ArrowRight size={14} className="ml-1" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles size={16} className="text-primary" />
              AI Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 p-3">
              <p className="text-sm font-medium">Boost this post</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Your product launch post is performing well. Consider boosting it for wider reach.</p>
            </div>
            <div className="rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 p-3">
              <p className="text-sm font-medium">Best time to post</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Your audience is most active on Saturdays at 3 PM. Schedule your next post then.</p>
            </div>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
              View all recommendations <ArrowRight size={14} className="ml-1" />
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle size={16} className="text-primary" />
              Performance Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-destructive/5 p-3">
              <p className="text-sm font-medium text-destructive">Engagement drop detected</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Your engagement rate dropped 15% this week compared to last week.</p>
            </div>
            <div className="rounded-lg bg-warning/5 p-3">
              <p className="text-sm font-medium text-warning-foreground">Unresolved comments</p>
              <p className="mt-0.5 text-xs text-muted-foreground">You have {mockComments.filter((c) => !c.resolved).length} comments waiting for a reply.</p>
            </div>
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
              View all alerts <ArrowRight size={14} className="ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
