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

interface Action {
  id: string
  label: string
  icon: string
  action: () => void
}

// --- State ---

let uiContainer: HTMLElement | null = null
let actionPanel: HTMLElement | null = null
let isPanelOpen = false
let currentPageType: PageData['pageType'] = 'unknown'

// --- Init ---

function init() {
  injectGlobalStyles()
  injectSynapseUI()
  updateForPageType()
  setupMutationObserver()
  listenForMessages()
}

// --- Global Styles ---

function injectGlobalStyles() {
  const style = document.createElement('style')
  style.id = 'synapse-styles'
  style.textContent = `
    .synapse-fab {
      position: fixed;
      bottom: 20px; right: 20px; z-index: 999999;
      display: flex; align-items: center; gap: 8px;
      background: #1877F2; color: white;
      border: none; border-radius: 24px;
      padding: 12px 20px;
      font: 600 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer; transition: all 0.2s ease;
      box-shadow: 0 4px 16px rgba(24,119,242,0.4);
    }
    .synapse-fab:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(24,119,242,0.5); }
    .synapse-fab svg { width: 18px; height: 18px; }

    .synapse-panel {
      position: fixed; bottom: 80px; right: 20px; z-index: 999998;
      background: white; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      width: 320px; max-height: 480px; overflow: hidden;
      font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: none; flex-direction: column;
      animation: synapseSlideUp 0.2s ease;
    }
    .synapse-panel.open { display: flex; }
    @keyframes synapseSlideUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .synapse-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px; border-bottom: 1px solid #E4E6EB;
      background: linear-gradient(135deg, #1877F2, #166FE5);
      color: white;
    }
    .synapse-panel-header h3 { font-size: 15px; font-weight: 600; margin: 0; }
    .synapse-panel-header button {
      background: none; border: none; color: white; opacity: 0.8;
      cursor: pointer; font-size: 18px; padding: 2px 6px;
    }
    .synapse-panel-header button:hover { opacity: 1; }

    .synapse-panel-body { flex: 1; overflow-y: auto; padding: 8px; }
    .synapse-panel-footer {
      padding: 10px 16px; border-top: 1px solid #E4E6EB;
      font-size: 11px; color: #65676B; text-align: center;
    }

    .synapse-action {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: 10px;
      cursor: pointer; transition: background 0.15s;
      border: none; background: none; width: 100%; text-align: left;
      font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #050505;
    }
    .synapse-action:hover { background: #F0F2F5; }
    .synapse-action-icon {
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 10px;
      background: #E7F3FF; color: #1877F2; font-size: 16px;
    }
    .synapse-action-label { font-weight: 500; }
    .synapse-action-desc { font-size: 12px; color: #65676B; margin-top: 1px; }

    .synapse-badge {
      position: absolute; top: -4px; right: -4px;
      width: 10px; height: 10px;
      background: #42B72A; border: 2px solid white; border-radius: 50%;
    }

    .synapse-pill {
      display: inline-flex; align-items: center; gap: 4px;
      background: #E7F3FF; color: #1877F2;
      border: none; border-radius: 16px; padding: 4px 12px;
      font: 500 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer; transition: background 0.15s; margin: 2px;
    }
    .synapse-pill:hover { background: #DBE7F5; }

    .synapse-toolbar {
      display: flex; flex-wrap: wrap; gap: 4px;
      padding: 8px 12px; margin: 8px 0;
      background: #F7F8FA; border-radius: 12px;
      border: 1px solid #E4E6EB;
    }
    .synapse-toolbar-label {
      width: 100%; font-size: 11px; font-weight: 600;
      color: #65676B; text-transform: uppercase; letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
  `
  document.head.appendChild(style)
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

// --- Page Actions ---

function getPageActions(): Action[] {
  switch (currentPageType) {
    case 'page':
      return [
        { id: 'analyze', label: 'Analyze Page', icon: '📊', action: () => openSidePanel() },
        { id: 'create-post', label: 'Generate Post', icon: '✍️', action: () => openSidePanel() },
        { id: 'insights', label: 'View Insights', icon: '📈', action: () => openSidePanel() },
        { id: 'comments', label: 'Manage Comments', icon: '💬', action: () => openSidePanel() },
      ]
    case 'post':
      return [
        { id: 'analyze-post', label: 'Analyze Engagement', icon: '📊', action: () => openSidePanel() },
        { id: 'suggest-reply', label: 'AI Reply Suggestions', icon: '🤖', action: () => openSidePanel() },
        { id: 'boost', label: 'Boost Post', icon: '🚀', action: () => openSidePanel() },
      ]
    case 'inbox':
      return [
        { id: 'smart-reply', label: 'Smart Reply', icon: '⚡', action: () => openSidePanel() },
        { id: 'auto-respond', label: 'Auto Respond', icon: '🤖', action: () => openSidePanel() },
        { id: 'summary', label: 'Conversation Summary', icon: '📝', action: () => openSidePanel() },
      ]
    case 'insights':
      return [
        { id: 'ai-analysis', label: 'AI Analysis', icon: '🧠', action: () => openSidePanel() },
        { id: 'recommendations', label: 'Recommendations', icon: '💡', action: () => openSidePanel() },
        { id: 'report', label: 'Generate Report', icon: '📄', action: () => openSidePanel() },
      ]
    case 'group':
      return [
        { id: 'analyze-group', label: 'Analyze Group', icon: '📊', action: () => openSidePanel() },
        { id: 'suggest-content', label: 'Content Ideas', icon: '💡', action: () => openSidePanel() },
      ]
    default:
      return [
        { id: 'open-sidepanel', label: 'Open Synapse', icon: '🔧', action: () => openSidePanel() },
        { id: 'detect-page', label: 'Detect Page Type', icon: '🔍', action: () => openSidePanel() },
      ]
  }
}

function openSidePanel() {
  chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
  closePanel()
}

function closePanel() {
  isPanelOpen = false
  if (actionPanel) actionPanel.classList.remove('open')
}

function togglePanel() {
  isPanelOpen = !isPanelOpen
  if (actionPanel) {
    if (isPanelOpen) {
      renderPanelContent()
      actionPanel.classList.add('open')
    } else {
      actionPanel.classList.remove('open')
    }
  }
}

function renderPanelContent() {
  if (!actionPanel) return
  const body = actionPanel.querySelector('.synapse-panel-body')
  if (!body) return

  const actions = getPageActions()
  const pageTypeLabels: Record<string, string> = {
    page: 'Facebook Page', post: 'Post', inbox: 'Inbox',
    insights: 'Insights', group: 'Group', unknown: 'Facebook',
  }

  body.innerHTML = `
    <div style="padding:4px 0 8px;font-size:12px;color:#65676B;">
      ${pageTypeLabels[currentPageType] || 'Facebook'} · ${actions.length} actions
    </div>
    ${actions.map((a) => `
      <button class="synapse-action" data-action-id="${a.id}">
        <div class="synapse-action-icon">${a.icon}</div>
        <div>
          <div class="synapse-action-label">${a.label}</div>
          <div class="synapse-action-desc">Click to open Synapse panel</div>
        </div>
      </button>
    `).join('')}
  `

  body.querySelectorAll('.synapse-action').forEach((el) => {
    const id = el.getAttribute('data-action-id')
    const action = actions.find((a) => a.id === id)
    if (action) el.addEventListener('click', action.action)
  })
}

// --- Page-Specific Injection ---

function injectPageToolbar() {
  removePageInjections()

  if (currentPageType !== 'page') return

  const targetSelectors = [
    'div[data-page-header]',
    '[data-testid="page_header"]',
    'div[role="banner"]',
  ]

  let target: Element | null = null
  for (const sel of targetSelectors) {
    target = document.querySelector(sel)
    if (target) break
  }

  if (!target) return

  const toolbar = document.createElement('div')
  toolbar.className = 'synapse-toolbar'
  toolbar.id = 'synapse-page-toolbar'
  toolbar.innerHTML = `
    <div class="synapse-toolbar-label">Synapse Quick Actions</div>
    <button class="synapse-pill" data-action="analyze">📊 Analyze</button>
    <button class="synapse-pill" data-action="create-post">✍️ Generate Post</button>
    <button class="synapse-pill" data-action="insights">📈 Insights</button>
    <button class="synapse-pill" data-action="comments">💬 Comments</button>
  `

  toolbar.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => openSidePanel())
  })

  target.parentNode?.insertBefore(toolbar, target.nextSibling)
}

function removePageInjections() {
  document.querySelectorAll('#synapse-page-toolbar').forEach((el) => el.remove())
}

// --- Synapse UI Injection ---

function injectSynapseUI() {
  if (uiContainer) return

  uiContainer = document.createElement('div')
  uiContainer.id = 'synapse-container'

  // Action panel
  actionPanel = document.createElement('div')
  actionPanel.className = 'synapse-panel'
  actionPanel.innerHTML = `
    <div class="synapse-panel-header">
      <h3>Synapse Social</h3>
      <button id="synapse-close-panel">✕</button>
    </div>
    <div class="synapse-panel-body"></div>
    <div class="synapse-panel-footer">Powered by NVIDIA NIM</div>
  `
  uiContainer.appendChild(actionPanel)

  // FAB button
  const fab = document.createElement('button')
  fab.className = 'synapse-fab'
  fab.id = 'synapse-fab'
  fab.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
    <span>Synapse</span>
    <div class="synapse-badge"></div>
  `
  fab.addEventListener('click', togglePanel)
  uiContainer.appendChild(fab)

  // Close button
  actionPanel.querySelector('#synapse-close-panel')?.addEventListener('click', closePanel)

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (isPanelOpen && uiContainer && !uiContainer.contains(e.target as Node)) {
      closePanel()
    }
  })

  document.body.appendChild(uiContainer)
}

// --- Update for Page Type ---

function updateForPageType() {
  currentPageType = detectFacebookPage()
  injectPageToolbar()
  broadcastPageData()
}

// --- Data Extraction ---

function extractPageName(): string | null {
  for (const sel of ['h1', '[data-page-header] h1', 'meta[property="og:title"]', 'title']) {
    const el = document.querySelector(sel)
    if (el) {
      if (el instanceof HTMLMetaElement) return el.getAttribute('content')
      return el.textContent?.trim() || null
    }
  }
  return null
}

function extractFollowerCount(): string | null {
  const match = document.body.innerText.match(/([\d,.KMBTkmbt]+)\s*(follower|like|member)s?/i)
  return match ? match[0].trim() : null
}

function extractCategory(): string | null {
  for (const sel of ['[data-page-category]', '[data-testid="page_category"]']) {
    const el = document.querySelector(sel)
    if (el) return el.textContent?.trim() || null
  }
  return null
}

function extractPosts(): PostData[] {
  const posts: PostData[] = []
  const articles = document.querySelectorAll('[role="article"], article, [data-pagelet^="FeedUnit"]')
  articles.forEach((el, i) => {
    const contentEl = el.querySelector('[data-ad-comet-preview], .xdj266r, .x1n2onr6')
    const likeEl = el.querySelector('[aria-label*="Like"i], a[href*="reactions"]')
    const commentEl = el.querySelector('[aria-label*="Comment"i], a[href*="comment"]')
    const shareEl = el.querySelector('[aria-label*="Share"i]')
    const imgEl = el.querySelector('img[alt]:not([alt=""])')
    const timeEl = el.querySelector('time, [data-utime], abbr')
    posts.push({
      id: `p_${i}`,
      content: contentEl?.textContent?.trim() || '',
      image: imgEl?.getAttribute('src') || null,
      likes: likeEl?.textContent?.trim() || '0',
      comments: commentEl?.textContent?.trim() || '0',
      shares: shareEl?.textContent?.trim() || '0',
      timestamp: timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '',
    })
  })
  return posts
}

function extractComments(): CommentData[] {
  const comments: CommentData[] = []
  document.querySelectorAll('[data-commentid], [role="article"] [data-comment-body]').forEach((el) => {
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
  let count = 0
  document.querySelectorAll('[aria-label*="message"i], [aria-label*="inbox"i], [data-pagelet*="Inbox"]').forEach((el) => {
    const num = el.textContent?.match(/(\d+)/)
    if (num) count += parseInt(num[1], 10)
  })
  return count
}

function extractNotifications(): number {
  let count = 0
  document.querySelectorAll('[aria-label*="notification"i], [data-pagelet*="Notifications"]').forEach((el) => {
    const num = el.textContent?.match(/(\d+)/)
    if (num) count += parseInt(num[1], 10)
  })
  return count
}

function extractPageId(): string | null {
  for (const sel of ['[data-pageid]', 'meta[property="al:android:url"]', '[data-testid="page_id"]']) {
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
    pageType: currentPageType,
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

// --- Mutation Observer ---

function setupMutationObserver() {
  let lastUrl = window.location.href
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href
      updateForPageType()
    }
  })
  observer.observe(document, { subtree: true, childList: true })
}

function broadcastPageData() {
  chrome.runtime.sendMessage({ type: 'PAGE_DATA_RESPONSE', payload: collectPageData() })
}

// --- Messaging ---

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'EXTRACT_PAGE_DATA':
        sendResponse({ success: true, data: collectPageData() })
        break
      case 'TOGGLE_SYNAPSE':
        isPanelOpen = !isPanelOpen
        if (actionPanel) {
          isPanelOpen ? (renderPanelContent(), actionPanel.classList.add('open')) : actionPanel.classList.remove('open')
        }
        sendResponse({ success: true, active: isPanelOpen })
        break
      case 'SYNAPSE_PING':
        sendResponse({ success: true, active: true })
        break
      case 'GET_PAGE_TYPE':
        sendResponse({ pageType: currentPageType })
        break
      case 'OPEN_ACTION_PANEL':
        togglePanel()
        sendResponse({ success: true })
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
