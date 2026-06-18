// --- Types ---

interface PageData {
  url: string
  pageTitle: string
  pageType: 'page' | 'post' | 'group' | 'inbox' | 'insights' | 'unknown'
  pageId: string | null
  postContent: string | null
  comments: CommentData[]
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
  detectFacebookPage()
  injectSynapseButton()
  setupMutationObserver()
  listenForMessages()
}

// --- Facebook Page Detection ---

function detectFacebookPage(): PageData['pageType'] {
  const url = window.location.href
  const path = new URL(url).pathname

  if (path.match(/^\/(pages\/)?[^/]+\/?$/)) return 'page'
  if (path.includes('/posts/') || path.includes('/photos/')) return 'post'
  if (path.includes('/groups/')) return 'group'
  if (path.includes('/messages/') || path.includes('/inbox')) return 'inbox'
  if (path.includes('/insights') || path.includes('/analytics')) return 'insights'

  return 'unknown'
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
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
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
      onUrlChange()
    }
  })
  observer.observe(document, { subtree: true, childList: true })
}

function onUrlChange() {
  const pageType = detectFacebookPage()
  chrome.runtime.sendMessage({
    type: 'PAGE_DATA_RESPONSE',
    payload: {
      url: window.location.href,
      pageTitle: document.title,
      pageType,
      pageId: extractPageId(),
    },
  })
}

// --- Page ID Extraction ---

function extractPageId(): string | null {
  const meta = document.querySelector('meta[property="al:android:app_name"]')
  if (meta) {
    const fbMeta = document.querySelector('[data-pageid]')
    if (fbMeta) return fbMeta.getAttribute('data-pageid')
  }
  return null
}

// --- Comment Extraction ---

function extractComments(): CommentData[] {
  const comments: CommentData[] = []
  const commentElements = document.querySelectorAll('[data-commentid]')
  commentElements.forEach((el) => {
    const authorEl = el.querySelector('[data-hovercard]')
    const contentEl = el.querySelector('[data-comment-body]')
    comments.push({
      id: el.getAttribute('data-commentid') || '',
      author: authorEl?.textContent?.trim() || 'Unknown',
      content: contentEl?.textContent?.trim() || '',
      timestamp: '',
    })
  })
  return comments
}

// --- Messaging ---

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'EXTRACT_PAGE_DATA':
        sendResponse({
          success: true,
          data: {
            url: window.location.href,
            pageTitle: document.title,
            pageType: detectFacebookPage(),
            pageId: extractPageId(),
            comments: extractComments(),
          },
        })
        break

      case 'TOGGLE_SYNAPSE':
        isSynapseActive = !isSynapseActive
        sendResponse({ success: true, active: isSynapseActive })
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
