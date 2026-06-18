"use client"

export interface PageData {
  url: string
  pageTitle: string
  pageType: 'page' | 'post' | 'group' | 'inbox' | 'insights' | 'unknown'
  pageId: string | null
  pageName: string | null
  followerCount: string | null
  category: string | null
  posts: PostData[]
  comments: CommentData[]
  inboxCount: number
  notifications: number
}

export interface PostData {
  id: string
  content: string
  image: string | null
  likes: string
  comments: string
  shares: string
  timestamp: string
}

export interface CommentData {
  id: string
  author: string
  content: string
  timestamp: string
}

export function isExtensionContext(): boolean {
  return typeof window !== "undefined" && !!(window as any).chrome?.runtime?.id
}

export function sendExtensionMessage(type: string, payload?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!isExtensionContext()) {
      reject(new Error("Not in extension context"))
      return
    }
    const chrome = (window as any).chrome
    chrome.runtime.sendMessage({ type, payload }, (response: any) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve(response)
      }
    })
  })
}

export function getPageData(): Promise<{ success: boolean; data: PageData; error?: string }> {
  return sendExtensionMessage("EXTRACT_PAGE_DATA")
}

export function openSidePanel(): Promise<any> {
  return sendExtensionMessage("OPEN_SIDEPANEL")
}

export function listenForExtensionMessages(
  handler: (message: any) => void
): () => void {
  if (!isExtensionContext()) return () => {}

  const chrome = (window as any).chrome
  const listener = (message: any) => handler(message)
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
