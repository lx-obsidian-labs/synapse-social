import { create } from "zustand"

export type PageId = "home" | "create" | "inbox" | "insights" | "ai" | "settings"

export interface Post {
  id: string
  content: string
  image?: string
  status: "draft" | "scheduled" | "published"
  scheduledAt?: string
  createdAt: string
  engagement: number
}

export interface Comment {
  id: string
  postId: string
  author: string
  avatar: string
  content: string
  timestamp: string
  sentiment: "positive" | "negative" | "neutral"
  resolved: boolean
}

export interface Conversation {
  id: string
  name: string
  avatar: string
  lastMessage: string
  unread: number
  timestamp: string
  messages: Message[]
}

export interface Message {
  id: string
  content: string
  sender: "user" | "page"
  timestamp: string
}

export interface InsightData {
  reach: number
  engagement: number
  followers: number
  growth: number
  postsCount: number
}

interface AppState {
  currentPage: PageId
  setCurrentPage: (page: PageId) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: "home",
  setCurrentPage: (page) => set({ currentPage: page }),
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))

export const mockPosts: Post[] = [
  { id: "1", content: "Excited to announce our new product launch! 🚀 Stay tuned for more details coming soon.", status: "published", createdAt: "2026-06-17T10:00:00Z", engagement: 234 },
  { id: "2", content: "Behind the scenes of our latest photoshoot. Our team worked really hard to make this happen!", image: "/placeholder.jpg", status: "published", createdAt: "2026-06-16T15:30:00Z", engagement: 189 },
  { id: "3", content: "We're hiring! Join our growing team and help us shape the future of social media management.", status: "scheduled", scheduledAt: "2026-06-20T09:00:00Z", createdAt: "2026-06-15T12:00:00Z", engagement: 0 },
  { id: "4", content: "Thank you to everyone who attended our webinar! The recording is now available.", status: "draft", createdAt: "2026-06-18T08:00:00Z", engagement: 0 },
  { id: "5", content: "New blog post: 5 Tips for Better Social Media Engagement in 2026.", status: "scheduled", scheduledAt: "2026-06-21T14:00:00Z", createdAt: "2026-06-14T16:00:00Z", engagement: 0 },
]

export const mockComments: Comment[] = [
  { id: "1", postId: "1", author: "Sarah Johnson", avatar: "", content: "This looks amazing! Can't wait to try it out!", timestamp: "2026-06-17T14:23:00Z", sentiment: "positive", resolved: false },
  { id: "2", postId: "1", author: "Mike Chen", avatar: "", content: "When will it be available?", timestamp: "2026-06-17T15:10:00Z", sentiment: "neutral", resolved: false },
  { id: "3", postId: "2", author: "Emily Davis", avatar: "", content: "The quality of your content keeps getting better!", timestamp: "2026-06-16T18:45:00Z", sentiment: "positive", resolved: true },
  { id: "4", postId: "1", author: "Alex Rivera", avatar: "", content: "I've been waiting for this!", timestamp: "2026-06-17T16:30:00Z", sentiment: "positive", resolved: false },
  { id: "5", postId: "2", author: "Jordan Lee", avatar: "", content: "Not impressed. Expected more.", timestamp: "2026-06-16T20:00:00Z", sentiment: "negative", resolved: false },
]

export const mockConversations: Conversation[] = [
  {
    id: "1", name: "Sarah Johnson", avatar: "", lastMessage: "Thanks for the quick response!", unread: 2, timestamp: "2026-06-18T11:30:00Z",
    messages: [
      { id: "m1", content: "Hi! I saw your new product and I'm very interested.", sender: "user", timestamp: "2026-06-18T10:00:00Z" },
      { id: "m2", content: "Thank you Sarah! Would you like to know more details?", sender: "page", timestamp: "2026-06-18T10:05:00Z" },
      { id: "m3", content: "Yes please! What's the pricing?", sender: "user", timestamp: "2026-06-18T10:10:00Z" },
      { id: "m4", content: "We have three tiers starting at $29/month. I can send you the full pricing sheet!", sender: "page", timestamp: "2026-06-18T10:15:00Z" },
      { id: "m5", content: "That would be great! Thank you.", sender: "user", timestamp: "2026-06-18T11:00:00Z" },
      { id: "m6", content: "Sent! Check your messages. Let me know if you have any other questions.", sender: "page", timestamp: "2026-06-18T11:05:00Z" },
      { id: "m7", content: "Thanks for the quick response!", sender: "user", timestamp: "2026-06-18T11:30:00Z" },
    ]
  },
  {
    id: "2", name: "Mike Chen", avatar: "", lastMessage: "When will the next update be?", unread: 0, timestamp: "2026-06-17T15:10:00Z",
    messages: [
      { id: "m8", content: "When will the next update be?", sender: "user", timestamp: "2026-06-17T15:10:00Z" },
      { id: "m9", content: "We're releasing v2.0 next week! I'll keep you posted.", sender: "page", timestamp: "2026-06-17T15:20:00Z" },
    ]
  },
  {
    id: "3", name: "Emily Davis", avatar: "", lastMessage: "Absolutely love your content!", unread: 0, timestamp: "2026-06-16T18:45:00Z",
    messages: [
      { id: "m10", content: "The quality of your content keeps getting better!", sender: "user", timestamp: "2026-06-16T18:45:00Z" },
      { id: "m11", content: "That means so much to us Emily! Thank you ❤️", sender: "page", timestamp: "2026-06-16T19:00:00Z" },
    ]
  },
  {
    id: "4", name: "Alex Rivera", avatar: "", lastMessage: "How do I sign up?", unread: 1, timestamp: "2026-06-18T09:00:00Z",
    messages: [
      { id: "m12", content: "I've been waiting for this!", sender: "user", timestamp: "2026-06-17T16:30:00Z" },
      { id: "m13", content: "How do I sign up?", sender: "user", timestamp: "2026-06-18T09:00:00Z" },
    ]
  },
]

export const mockInsights: InsightData = {
  reach: 45231,
  engagement: 8923,
  followers: 12347,
  growth: 12.5,
  postsCount: 87,
}

export const weeklyReach = [
  { name: "Mon", value: 5200 },
  { name: "Tue", value: 6800 },
  { name: "Wed", value: 4900 },
  { name: "Thu", value: 7200 },
  { name: "Fri", value: 6100 },
  { name: "Sat", value: 8500 },
  { name: "Sun", value: 7800 },
]

export const engagementData = [
  { name: "Likes", value: 4520 },
  { name: "Comments", value: 2100 },
  { name: "Shares", value: 1230 },
  { name: "Clicks", value: 1073 },
]

export const suggestedReplies = [
  "Thank you so much! We really appreciate your support 🙏",
  "Great question! Let me look into this and get back to you.",
  "We're glad you enjoyed it! Stay tuned for more updates.",
  "Could you please send us a direct message with more details?",
]

export const templates = [
  { id: "1", name: "Product Launch", prompt: "Create a post announcing a new product launch. Include excitement and key features." },
  { id: "2", name: "Engagement", prompt: "Create a question-based post to drive engagement and comments." },
  { id: "3", name: "Promotion", prompt: "Create a promotional post with a special offer or discount." },
  { id: "4", name: "Event", prompt: "Create a post inviting people to an upcoming event or webinar." },
  { id: "5", name: "Milestone", prompt: "Create a post celebrating a milestone or achievement." },
]
