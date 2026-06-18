// --- Types ---

interface PageData {
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

interface PostData {
  id: string
  content: string
  image: string | null
  likes: string
  comments: string
  shares: string
  timestamp: string
}

interface CommentData {
  id: string
  author: string
  content: string
  timestamp: string
}

// --- State ---

let synapseButton: HTMLElement | null = null
let isSynapseActive = false

// --- Init ---

function init() {
  injectSynapseButton()
  setupMutationObserver()
  listenForMessages()
}

// --- Facebook Page Detection ---

function detectFacebookPage(): PageData['pageType'] {
  const url = window.location.href
  const path = new URL(url).pathname

  if (path.match(/^\/(pages\/)?[^/]+\/?$/)) return 'page'
  if (path.includes('/posts/') || path.includes('/photos/') || path.includes('/videos/')) return 'post'
  if (path.includes('/groups/')) return 'group'
  if (path.includes('/messages/') || path.includes('/inbox')) return 'inbox'
  if (path.includes('/insights') || path.includes('/analytics')) return 'insights'

  return 'unknown'
}

// --- Page Data Extraction ---

function extractPageName(): string | null {
  const selectors = [
    'h1',
    '[data-page-header] h1',
    'meta[property="og:title"]',
    'title',
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) {
      if (el instanceof HTMLMetaElement) return el.getAttribute('content')
      return el.textContent?.trim() || null
    }
  }
  return null
}

function extractFollowerCount(): string | null {
  const patterns = /([\d,.KMBTkmbt]+)\s*(follower|like|member)s?/i
  const textNodes = document.body.innerText
  const match = textNodes.match(patterns)
  return match ? match[0].trim() : null
}

function extractCategory(): string | null {
  const selectors = [
    '[data-page-category]',
    '[data-testid="page_category"]',
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) return el.textContent?.trim() || null
  }
  return null
}

function extractPosts(): PostData[] {
  const posts: PostData[] = []
  const articleSelectors = [
    '[role="article"]',
    'article',
    '[data-ad-preview]',
    '[data-pagelet^="FeedUnit"]',
  ]

  let articles: NodeListOf<Element> | null = null
  for (const sel of articleSelectors) {
    const found = document.querySelectorAll(sel)
    if (found.length > 0) {
      articles = found
      break
    }
  }

  if (articles) {
    articles.forEach((el, i) => {
      const contentEl = el.querySelector('[data-ad-comet-preview], [data-ad-preview], .xdj266r, .x1n2onr6, .x1iyjqo2')
      const likeEl = el.querySelector('[aria-label*="Like"], [aria-label*="like"i], a[href*="reactions"]')
      const commentEl = el.querySelector('[aria-label*="Comment"], [aria-label*="comment"i], a[href*="comment"]')
      const shareEl = el.querySelector('[aria-label*="Share"], [aria-label*="share"i]')
      const imgEl = el.querySelector('img[alt]:not([alt=""])')
      const timeEl = el.querySelector('time, [data-utime], abbr')

      posts.push({
        id: `post_${i}_${Date.now()}`,
        content: contentEl?.textContent?.trim() || '',
        image: imgEl?.getAttribute('src') || null,
        likes: likeEl?.textContent?.trim() || '0',
        comments: commentEl?.textContent?.trim() || '0',
        shares: shareEl?.textContent?.trim() || '0',
        timestamp: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '',
      })
    })
  }

  return posts
}

function extractComments(): CommentData[] {
  const comments: CommentData[] = []
  const commentBlocks = document.querySelectorAll('[data-commentid], [role="article"] [data-comment-body]')

  commentBlocks.forEach((el) => {
    const authorEl = el.querySelector('[data-hovercard], [data-testid="comment-author"], a[href*="/user/"]')
    const contentEl = el.querySelector('[data-comment-body], [data-testid="comment-body"], .xdj266r')
    comments.push({
      id: el.getAttribute('data-commentid') || `c_${comments.length}`,
      author: authorEl?.textContent?.trim() || 'Unknown',
      content: contentEl?.textContent?.trim() || '',
      timestamp: '',
    })
  })

  return comments
}

function extractInboxCount(): number {
  const badgeEls = document.querySelectorAll('[aria-label*="message"], [aria-label*="inbox"], [data-pagelet*="Inbox"]')
  let count = 0
  badgeEls.forEach((el) => {
    const num = el.textContent?.match(/(\d+)/)
    if (num) count += parseInt(num[1], 10)
  })
  return count
}

function extractNotifications(): number {
  const badgeEls = document.querySelectorAll('[aria-label*="notification"], [data-pagelet*="Notifications"]')
  let count = 0
  badgeEls.forEach((el) => {
    const num = el.textContent?.match(/(\d+)/)
    if (num) count += parseInt(num[1], 10)
  })
  return count
}

function extractPageId(): string | null {
  const selectors = [
    '[data-pageid]',
    'meta[property="al:android:url"]',
    '[data-testid="page_id"]',
  ]
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) {
      if (el instanceof HTMLMetaElement) {
        const match = el.getAttribute('content')?.match(/(\d+)/)
        if (match) return match[1]
      }
      return el.getAttribute('data-pageid') || el.textContent?.trim() || null
    }
  }
  return null
}

function collectPageData(): PageData {
  return {
    url: window.location.href,
    pageTitle: document.title,
    pageType: detectFacebookPage(),
    pageId: extractPageId(),
    pageName: extractPageName(),
    followerCount: extractFollowerCount(),
    category: extractCategory(),
    posts: extractPosts(),
    comments: extractComments(),
    inboxCount: extractInboxCount(),
    notifications: extractNotifications(),
  }
}

// --- Synapse Button Injection ---

function injectSynapseButton() {
  if (synapseButton) return

  synapseButton = document.createElement('div')
  synapseButton.id = 'synapse-social-button'
  synapseButton.innerHTML = `
    <style>
      #synapse-social-button {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
      #synapse-social-button .synapse-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #1877F2;
        color: white;
        border: none;
        border-radius: 20px;
        padding: 10px 18px;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(24, 119, 242, 0.4);
        cursor: pointer;
        transition: all 0.2s ease;
      }
      #synapse-social-button .synapse-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 6px 16px rgba(24, 119, 242, 0.5);
      }
      #synapse-social-button .synapse-btn svg {
        width: 18px;
        height: 18px;
      }
      #synapse-social-button .synapse-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 10px;
        height: 10px;
        background: #42B72A;
        border: 2px solid white;
        border-radius: 50%;
      }
    </style>
    <button class="synapse-btn" id="synapse-trigger">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span>Synapse</span>
    </button>
    <div class="synapse-badge"></div>
  `

  document.body.appendChild(synapseButton)

  const trigger = synapseButton.querySelector('#synapse-trigger')
  trigger?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
  })
}

// --- Mutation Observer for SPA Navigation ---

function setupMutationObserver() {
  let lastUrl = window.location.href
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href
      broadcastPageData()
    }
  })
  observer.observe(document, { subtree: true, childList: true })
}

function broadcastPageData() {
  chrome.runtime.sendMessage({
    type: 'PAGE_DATA_RESPONSE',
    payload: collectPageData(),
  })
}

// --- Messaging ---

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'EXTRACT_PAGE_DATA':
        sendResponse({ success: true, data: collectPageData() })
        break

      case 'TOGGLE_SYNAPSE':
        isSynapseActive = !isSynapseActive
        sendResponse({ success: true, active: isSynapseActive })
        break

      case 'SYNAPSE_PING':
        sendResponse({ success: true, active: true })
        break
    }
  })
}

// --- Start ---

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
