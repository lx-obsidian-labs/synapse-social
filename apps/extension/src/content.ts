// --- Types ---

interface PageData {
  url: string
  pageTitle: string
  textContent: string
  links: number
  images: number
  videos: number
  buttons: number
  inputs: number
  headings: { tag: string; text: string }[]
}

interface ToolResult {
  success: boolean
  result?: string
  error?: string
  status?: string
}

type ToolFn = (...args: string[]) => ToolResult | Promise<ToolResult>

// --- Shadow DOM helpers ---

function querySelectorDeep(selector, root = document) {
  try {
    const el = root.querySelector(selector)
    if (el) return el
  } catch {}
  const all = root.querySelectorAll('*')
  for (const el of all) {
    if (el.shadowRoot) {
      const found = querySelectorDeep(selector, el.shadowRoot)
      if (found) return found
    }
  }
  return null
}

// --- Visual Cursor ---
// Shows a pulsing ring around the element being interacted with

function flashElement(el) {
  if (!el || !el.getBoundingClientRect) return
  const rect = el.getBoundingClientRect()
  const cursor = document.createElement('div')
  cursor.id = 'synapse-cursor'
  cursor.style.cssText = `
    position:fixed;z-index:2147483647;pointer-events:none;
    left:${rect.left}px;top:${rect.top}px;
    width:${rect.width}px;height:${rect.height}px;
    border:3px solid #1877F2;
    border-radius:${Math.min(rect.width, rect.height) > 20 ? '6px' : '50%'};
    box-shadow:0 0 0 2px rgba(24,119,242,0.2), 0 0 20px rgba(24,119,242,0.3);
    animation:synapse-pulse 1.2s ease-in-out;
    transition:opacity 0.3s;
  `
  document.body.appendChild(cursor)
  setTimeout(() => { cursor.style.opacity = '0'; setTimeout(() => cursor.remove(), 300) }, 1200)
}

// Inject keyframes once
if (!document.getElementById('synapse-cursor-style')) {
  const style = document.createElement('style')
  style.id = 'synapse-cursor-style'
  style.textContent = `@keyframes synapse-pulse{0%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:0.85}100%{transform:scale(1);opacity:0}}`
  document.head.appendChild(style)
}

function querySelectorAllDeep(selector, root = document) {
  let results = []
  try {
    results.push(...root.querySelectorAll(selector))
  } catch {}
  const all = root.querySelectorAll('*')
  for (const el of all) {
    if (el.shadowRoot) {
      results.push(...querySelectorAllDeep(selector, el.shadowRoot))
    }
  }
  return results
}

// --- Observe snapshot caching & cheap page signature ---
// observe_page runs on EVERY agent loop iteration. To avoid re-scanning the
// entire document each time we cache the result and only recompute when the
// page's "signature" changes or the page is explicitly marked dirty.

let _observeCache: { sig: string; data: any } | null = null
let _observeDirty = true

function markPageDirty() { _observeDirty = true }

function pageSignature(): string {
  return (
    location.href +
    '|' +
    document.querySelectorAll('input,button,a,select').length +
    '|' +
    (document.body?.innerText?.length ?? 0)
  )
}

let _dirtyObserverSet = false
function ensureDirtyObserver() {
  if (_dirtyObserverSet || !document.documentElement) return
  _dirtyObserverSet = true
  try {
    const obs = new MutationObserver(() => { _observeDirty = true })
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
  } catch {}
}

// Debounce helper (util completeness; not wired into hot paths).
function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any
  return (...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

// --- Generic Page Data ---

function collectPageData(): PageData {
  const headings: { tag: string; text: string }[] = []
  document.querySelectorAll('h1, h2, h3').forEach((h) => {
    const text = h.textContent?.trim()
    if (text && text.length > 0) headings.push({ tag: h.tagName.toLowerCase(), text: text.slice(0, 100) })
  })
  return {
    url: window.location.href,
    pageTitle: document.title,
    textContent: document.body.innerText.slice(0, 3000),
    links: document.querySelectorAll('a[href]').length,
    images: document.querySelectorAll('img[src]').length,
    videos: document.querySelectorAll('video').length,
    buttons: document.querySelectorAll('button, [role="button"]').length,
    inputs: document.querySelectorAll('input, textarea, [contenteditable="true"]').length,
    headings: headings.slice(0, 10),
  }
}

// --- Floating Button ---

function injectFloatingButton() {
  const existing = document.getElementById('synapse-fab')
  if (existing) return

  const fab = document.createElement('div')
  fab.id = 'synapse-fab'
  fab.innerHTML = 'S'
  fab.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:2147483647;
    width:44px;height:44px;border-radius:50%;
    background:linear-gradient(135deg,#1877F2,#0D5AB5);
    color:white;font-weight:800;font-size:18px;
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;box-shadow:0 4px 16px rgba(24,119,242,0.35);
    border:none;font-family:system-ui;
    transition:transform 0.2s, box-shadow 0.2s;
  `
  fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.1)'; fab.style.boxShadow = '0 6px 24px rgba(24,119,242,0.45)' })
  fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; fab.style.boxShadow = '0 4px 16px rgba(24,119,242,0.35)' })
  fab.addEventListener('click', () => {
    try { chrome.runtime.sendMessage({ type: 'TOGGLE_SYNAPSE' }) } catch { /* context invalidated — ignore */ }
  })
  document.body.appendChild(fab)
}

// --- Tool Definitions ---

// --- Reliable chat/composer typing helpers (module scope) ---

function isElementReady(el: Element | null): boolean {
  if (!el || !(el as HTMLElement).isConnected) return false
  const html = el as HTMLElement
  const rect = html.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const style = getComputedStyle(html)
  if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0) return false
  return true
}

// Poll until an input matching one of the candidate selectors is present,
// visible, enabled and attached to the DOM (handles SPA/composer load lag).
async function waitForVisibleInput(candidates: string[], timeoutMs = 10000): Promise<{ el: HTMLElement; selector: string } | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    for (const sel of candidates) {
      try {
        const el = querySelectorDeep(sel) as HTMLElement | null
        if (el && isElementReady(el) && !(el as HTMLInputElement).disabled) {
          return { el, selector: sel }
        }
      } catch { /* invalid selector — skip */ }
    }
    await new Promise(r => setTimeout(r, 250))
  }
  return null
}

// Real mouse click + focus so frameworks (React, etc.) register focus state.
function focusAndClick(el: HTMLElement) {
  try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }) } catch {}
  try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })) } catch {}
  try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window })) } catch {}
  try { el.click() } catch {}
  try { el.focus({ preventScroll: true }) } catch {}
}

// Type character-by-character with a human-like cadence so every keystroke is
// captured by the page (and it resists basic bot-detection).
async function typeInto(el: HTMLElement, text: string) {
  const isCE = el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'searchbox'
  if (isCE) {
    // Insert the ENTIRE prompt in a single operation. Per-keystroke insertion
    // can drop or duplicate characters (garbled/random output); one insertText
    // call reproduces the full text exactly as provided, then fires input so
    // React/frameworks register the change.
    el.focus({ preventScroll: true })
    document.execCommand('insertText', false, text)
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) {
      setter.call(el, text)
      el.dispatchEvent(new InputEvent('input', { bubbles: true }))
    } else {
      ;(el as HTMLInputElement).value = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }
}

async function clearInput(el: HTMLElement) {
  const isCE = el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox' || el.getAttribute('role') === 'searchbox'
  if (isCE) {
    try { document.execCommand('selectAll', false); document.execCommand('delete', false) } catch {}
  } else {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) { setter.call(el, ''); el.dispatchEvent(new InputEvent('input', { bubbles: true })) }
    else { ;(el as HTMLInputElement).value = ''; el.dispatchEvent(new Event('input', { bubbles: true })) }
  }
}

async function submitInput(el: HTMLElement) {
  await new Promise(r => setTimeout(r, 150 + Math.random() * 400))
  const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true } as KeyboardEventInit
  el.dispatchEvent(new KeyboardEvent('keydown', opts))
  el.dispatchEvent(new KeyboardEvent('keypress', opts))
  el.dispatchEvent(new KeyboardEvent('keyup', opts))
}

// --- Auth helpers (generic, works on any site) ---

function findLoginFields() {
  const pw = document.querySelector('input[type="password"]') as HTMLInputElement | null
  if (!pw) return null
  const form = pw.closest('form')
  let user: HTMLInputElement | null = null
  if (form) {
    const inputs = Array.from(form.querySelectorAll('input')).filter(i => (i as HTMLInputElement).type !== 'hidden' && i !== pw) as HTMLInputElement[]
    user = inputs.find(i => /email|user|phone|login|account|mobile|tel|name/i.test(i.id + i.name + i.placeholder + (i.getAttribute('aria-label') || '')))
      || inputs.find(i => i.type === 'email' || i.type === 'text' || i.type === 'tel')
      || inputs[0]
  }
  if (!user) {
    const all = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]')) as HTMLInputElement[]
    user = all.find(i => i.compareDocumentPosition(pw, i) & Node.DOCUMENT_POSITION_FOLLOWING) || all[0] || null
  }
  const submit = Array.from(document.querySelectorAll('button, input[type="submit"]')).find(b => {
    const t = ((b.textContent || '') + (b as HTMLInputElement).value + (b.getAttribute('aria-label') || '')).toLowerCase()
    return /log ?in|sign ?in|sign ?on|continue|submit|next|entrar|anmelden|connexion|s'e?connecter/i.test(t)
  }) as HTMLElement | undefined
  return { user, pw, submit }
}

// Detect a registration/signup form. Scores forms by how many signup signals
// they contain (password + confirm-password + name/email + a "Sign up" button).
function findSignupFields(): { name: HTMLInputElement | null; email: HTMLInputElement | null; pw: HTMLInputElement | null; confirmPw: HTMLInputElement | null; submit: HTMLElement | undefined } | null {
  const forms = Array.from(document.querySelectorAll('form')) as HTMLFormElement[]
  const scoreForm = (f: HTMLFormElement): number => {
    const inputs = Array.from(f.querySelectorAll('input')).filter(i => (i as HTMLInputElement).type !== 'hidden') as HTMLInputElement[]
    if (!inputs.some(i => i.type === 'password')) return 0
    let score = 2
    const has = (re: RegExp) => inputs.some(i => re.test(i.id + i.name + i.placeholder + (i.getAttribute('aria-label') || '') + i.type))
    if (has(/confirm|repeat|retype|verify.*pass/i)) score += 4
    if (has(/email|user|mail/i)) score += 2
    if (has(/first.?name|last.?name|full.?name|your.?name|name/i)) score += 2
    const btn = f.querySelector('button, input[type="submit"]')
    const bt = (((btn as HTMLElement)?.textContent || '') + ((btn as HTMLInputElement)?.value || '')).toLowerCase()
    if (/sign ?up|create ?account|register|join|get ?started/i.test(bt)) score += 3
    return score
  }
  let best: { form: HTMLFormElement; score: number } | null = null
  for (const f of forms) {
    const s = scoreForm(f)
    if (s > 0 && (!best || s > best.score)) best = { form: f, score: s }
  }
  const form = best?.form
  if (!form) return null
  const inputs = Array.from(form.querySelectorAll('input')).filter(i => (i as HTMLInputElement).type !== 'hidden') as HTMLInputElement[]
  const byRe = (re: RegExp) => inputs.find(i => re.test(i.id + i.name + i.placeholder + (i.getAttribute('aria-label') || ''))) || null
  const name = byRe(/first.?name|full.?name|your.?name|name/i)
  const email = byRe(/email|user|mail|login|account/i) || inputs.find(i => i.type === 'email') || null
  const pws = inputs.filter(i => i.type === 'password')
  const pw = pws[0] || null
  const confirmPw = pws[1] || byRe(/confirm|repeat|retype|verify/i) || null
  const submit = Array.from(form.querySelectorAll('button, input[type="submit"]')).find(b => {
    const t = (((b as HTMLElement).textContent || '') + ((b as HTMLInputElement).value || '') + (b.getAttribute('aria-label') || '')).toLowerCase()
    return /sign ?up|create ?account|register|join|get ?started|submit|continue|next/i.test(t)
  }) as HTMLElement | undefined
  return { name, email, pw, confirmPw, submit }
}

// Return only the IMAGES THAT ARE ACTUAL CONTENT in the conversation panel —
// i.e. artwork generated by the AI — and deliberately EXCLUDE UI chrome
// (sidebar logos, avatars, toolbar/composer icons, header graphics). The
// conversation on ChatGPT/clones lives inside <main>, so we scope there and
// drop anything tiny (icons/avatars) or inside navigation/header chrome.
let _imgCache: { sig: string; imgs: any[] } | null = null

function computeContentImages(): { img: HTMLImageElement; src: string; area: number }[] {
  const scope = (document.querySelector('main') as HTMLElement) || document.body
  const imgs = Array.from(scope.querySelectorAll('img')) as HTMLImageElement[]
  const out: { img: HTMLImageElement; src: string; area: number }[] = []
  for (const img of imgs) {
    const src = img.src || (img.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0] || ''
    if (!src) continue
    if (!/^(https?:|blob:|data:image\/(png|jpe?g|webp|gif))/i.test(src)) continue
    // Skip UI chrome: anything inside nav/aside/header/footer/sidebar.
    if (img.closest('nav, aside, header, footer, [role="navigation"], [role="complementary"]')) continue
    // Inline SVG icons (data:image/svg+xml) are UI glyphs, never artwork.
    if (/^data:image\/svg/i.test(src)) continue
    const w = img.naturalWidth || img.width || 0
    const h = img.naturalHeight || img.height || 0
    if (w < 160 || h < 160) continue  // icons & avatars are tiny
    out.push({ img, src, area: w * h })
  }
   return out.sort((a, b) => b.area - a.area)
}

// Memoized wrapper: only re-scan images when the page signature changed.
function getContentImages(): { img: HTMLImageElement; src: string; area: number }[] {
  const sig = pageSignature()
  if (_imgCache && _imgCache.sig === sig) return _imgCache.imgs as any[]
  const imgs: any[] = computeContentImages()
  _imgCache = { sig, imgs }
  return imgs
}

function findErrorText(): string | null {
  const els = Array.from(document.querySelectorAll('[role="alert"], .error, .alert, .form-error, [class*="error"]'))
    .map(e => e.textContent?.trim()).filter(Boolean) as string[]
  const bodyErr = document.body.innerText.match(/(incorrect|invalid|wrong|denied|failed|expired|no account|doesn'?t match)[^\n]{0,80}/i)
  if (els.length) return els.slice(0, 3).join(' | ').slice(0, 300)
  if (bodyErr) return bodyErr[0].slice(0, 300)
  return null
}

const sleepMs = (ms: number) => new Promise(r => setTimeout(r, ms))

const tools: Record<string, ToolFn> = {

  // Navigation
  scroll_to_bottom() {
    markPageDirty()
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    return { success: true, result: 'Scrolled to bottom' }
  },

  scroll_to_top() {
    markPageDirty()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return { success: true, result: 'Scrolled to top' }
  },

  scroll_to_element(args) {
    const selector = args[0]
    if (!selector) return { success: false, error: 'Usage: scroll_to_element: css_selector' }
    try {
      const el = querySelectorDeep(selector)
      if (!el) return { success: false, error: `Element not found: ${selector}` }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      markPageDirty()
      flashElement(el)
      return { success: true, result: `Scrolled to: ${selector}` }
    } catch { return { success: false, error: `Invalid selector: ${selector}` } }
  },

  async scroll_load_more() {
    const maxScrolls = 5
    markPageDirty()
    for (let i = 0; i < maxScrolls; i++) {
      const before = document.body.scrollHeight
      window.scrollTo({ top: before, behavior: 'smooth' })
      await new Promise(r => setTimeout(r, 2000))
      const after = document.body.scrollHeight
      if (after === before) break // No new content loaded
    }
    return { success: true, result: `Scrolled to load more content (${maxScrolls} attempts)` }
  },

  // Click
  click_element(args) {
    markPageDirty()
    let selector = args.join(' ').trim()
    if (!selector) return { success: false, error: 'Usage: click_element: css_selector' }

    // Strip common AI prefix mistakes
    selector = selector.replace(/^(css_selector|text|selector)=/i, '').replace(/^['"]|['"]$/g, '').trim()
    if (!selector) return { success: false, error: 'Usage: click_element: css_selector' }

    const el = querySelectorDeep(selector) as HTMLElement | null
    if (el) { flashElement(el); el.click(); return { success: true, result: `Clicked: ${selector}` } }

    // Fallback: treat input as text to find on page
    const found = tools.findTextAndClick(selector)
    if (found) return { success: true, result: `Clicked element containing text "${selector}"` }
    return { success: false, error: `Element not found: ${selector}` }
  },

  // Shared helper: find a clickable element and click it.
  // Self-healing: matches across visible text, aria-label, title, name,
  // data-testid, placeholder and value, and prefers a visible+enabled element
  // so a structural DOM change (text rewrap, restyled button) won't break it.
  findTextAndClick(text) {
    const q = text.toLowerCase().trim()
    if (!q) return false

    // 1) Exact text-node walk (handles "click the label inside a button")
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
    while (walker.nextNode()) {
      const nodeText = (walker.currentNode.textContent || '').toLowerCase()
      if (nodeText.includes(q) || nodeText.trim() === q) {
        let el = walker.currentNode.parentElement
        while (el) {
          if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.getAttribute('onclick') || el.getAttribute('role') === 'link' || el.getAttribute('role') === 'menuitem' || el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'option') {
            flashElement(el); el.click(); return true
          }
          el = el.parentElement
        }
      }
    }

    // 2) Self-healing candidate scoring across stable attributes
    const CLICKABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="link"], input[type="submit"], input[type="button"], summary, [onclick]'
    let best: { el: HTMLElement; score: number } | null = null
    const consider = (el: HTMLElement) => {
      if (!el) return
      const t = (el.textContent || '').trim().toLowerCase()
      const aria = (el.getAttribute('aria-label') || '').toLowerCase()
      const title = (el.getAttribute('title') || '').toLowerCase()
      const name = (el.getAttribute('name') || '').toLowerCase()
      const testId = (el.getAttribute('data-testid') || '').toLowerCase()
      const ph = (el.getAttribute('placeholder') || '').toLowerCase()
      const val = ((el as HTMLInputElement).value || '').toLowerCase()
      const id = (el.id || '').toLowerCase()
      let score = 0
      if (t === q || aria === q || title === q || name === q || testId === q || ph === q || val === q || id === q) score = 100
      else if (t.includes(q) || aria.includes(q) || title.includes(q) || name.includes(q) || testId.includes(q) || ph.includes(q) || val.includes(q) || id.includes(q)) score = 60
      else if (q.includes(t) && t.length > 1) score = 30
      if (score === 0) return
      const disabled = (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'
      if (disabled) score -= 25
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) score -= 15
      if (!best || score > best.score) best = { el, score }
    }
    document.querySelectorAll<HTMLElement>(CLICKABLE).forEach(consider)
    document.querySelectorAll('iframe').forEach((frame) => {
      try {
        const fDoc = (frame as HTMLIFrameElement).contentDocument || (frame as HTMLIFrameElement).contentWindow?.document
        if (!fDoc) return
        fDoc.querySelectorAll<HTMLElement>('button, a, [role="button"]').forEach(consider)
      } catch {}
    })
    if (best) { flashElement(best.el); best.el.click(); return true }
    return false
  },

  click_all_buttons_matching(args) {
    markPageDirty()
    const text = args.join(' ').toLowerCase()
    if (!text) return { success: false, error: 'Usage: click_all_buttons_matching: text' }
    let clicked = 0
    document.querySelectorAll<HTMLElement>('button, a, [role="button"]').forEach((el) => {
      if (el.textContent?.toLowerCase().includes(text)) { flashElement(el); el.click(); clicked++ }
    })
    return clicked > 0
      ? { success: true, result: `Clicked ${clicked} element(s) containing "${text}"` }
      : { success: false, error: `No elements found containing "${text}"` }
  },

  // Fill / Type

  async fill_input(args) {
    markPageDirty()
    let selector = (args[0] || '').replace(/^(css_selector|selector)=/i, '').replace(/^['"]|['"]$/g, '').trim()
    const text = args.slice(1).join(' ').replace(/^['"]|['"]$/g, '')
    if (!text) return { success: false, error: 'Usage: fill_input: selector | text' }

    // 1. Candidate selectors — ChatGPT composer first, then generic fallbacks.
    // An EMPTY selector means "auto-detect the best input" (used when the agent
    // just wants to type into the open chat composer), so we skip the
    // selector-specific matchers and rely on the generic ones below.
    const chatGptSelectors = [
      '[contenteditable="true"][data-placeholder*="Message" i]',
      '[contenteditable="true"][aria-label*="Message" i]',
      'textarea#prompt-textarea',
      '#prompt-textarea',
      'div[contenteditable="true"][role="textbox"]',
    ]
    const genericFallbacks = selector
      ? [
          selector,
          `[aria-label*="${selector}" i]`,
          `[placeholder*="${selector}" i]`,
          `[data-placeholder*="${selector}" i]`,
          `[name="${selector}"]`,
          'input[type="search"]',
          '[role="searchbox"]',
          'input:not([type="hidden"])',
          'textarea',
          '[role="textbox"]',
          '[contenteditable="true"]',
        ]
      : [
          'input[type="search"]',
          '[role="searchbox"]',
          'input:not([type="hidden"])',
          'textarea',
          '[role="textbox"]',
          '[contenteditable="true"]',
        ]
    const candidates = [...chatGptSelectors, ...genericFallbacks]

    // 2. Wait for the input to be fully visible & attached to the DOM
    const found = await waitForVisibleInput(candidates, 12000)
    if (!found) {
      const available = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]'))
        .slice(0, 8).map(i => `${i.tagName.toLowerCase()}#${i.id || ''} aria="${i.getAttribute('aria-label') || ''}" ph="${i.getAttribute('placeholder') || ''}"`).join(', ')
      return { success: false, error: `Input not ready/visible after 12s. Available: ${available || 'none'}` }
    }
    const el = found.el
    const matched = found.selector

    // 3. Explicitly click to set focus before typing
    focusAndClick(el)
    flashElement(el)
    await new Promise(r => setTimeout(r, 100 + Math.random() * 150))

    // 4. Clear any existing content, then type character-by-character
    await clearInput(el)
    await typeInto(el, text)

    // 5. Submit — auto-press Enter ONLY for chat composers and search boxes.
    // For multi-field forms (login, signup) we must NOT auto-submit, or the
    // form fires before every field is filled. There the agent fills each
    // field then clicks the submit/"Log in" button (or sends key:enter).
    const isComposer = el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox'
    const isSearch = el.getAttribute('role') === 'searchbox' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'search')
    const chatUrl = /(chatgpt|openai\.com|claude\.ai|gemini|bard|copilot|bing\.com\/chat)/i.test(location.href)
    const autoSubmit = isComposer || isSearch || chatUrl
    if (autoSubmit) {
      await submitInput(el)
    }

    return { success: true, result: `Typed "${text}" into ${matched}${autoSubmit ? ' + Enter' : ''}` }
  },

  async simulate_typing(args) {
    if (args.length < 2) return { success: false, error: 'Usage: simulate_typing: selector | text' }
    const selector = args[0]
    const text = args.slice(1).join(' ')
    const found = await waitForVisibleInput([selector, `[aria-label*="${selector}" i]`, `[placeholder*="${selector}" i]`, 'input', 'textarea', '[contenteditable="true"]'], 12000)
    if (!found) return { success: false, error: `Element not found/visible: ${selector}` }
    const el = found.el
    focusAndClick(el)
    flashElement(el)
    await clearInput(el)
    await typeInto(el, text)
    return { success: true, result: `Typed "${text}" into ${found.selector} (${text.length} chars)` }
  },

  // Log in to ANY site. Detects the auth form generically, fills the
  // username/email + password, submits, then reports the outcome so the agent
  // (or user) can handle 2FA. args: [username/email, password]
  async login_to_site(args) {
    markPageDirty()
    const username = (args[0] || '').trim()
    const password = (args[1] || '').trim()
    if (!username || !password) return { success: false, error: 'Usage: login_to_site: <email/username> <password>' }

    const fields = findLoginFields()
    if (!fields || !fields.pw) return { success: false, error: 'No login form (password field) detected on this page.' }

    try {
      if (fields.user) { focusAndClick(fields.user); await clearInput(fields.user); await typeInto(fields.user, username) }
      focusAndClick(fields.pw); await clearInput(fields.pw); await typeInto(fields.pw, password)
    } catch (e) {
      return { success: false, error: 'Could not fill the login fields: ' + (e as Error).message }
    }

    if (fields.submit) {
      flashElement(fields.submit)
      ;(fields.submit as HTMLElement).click()
    } else {
      // No submit button found — fall back to Enter on the password field
      fields.pw.focus()
      fields.pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    }

    await sleepMs(2600)

    // Still a login form? Then either 2FA is needed or it failed.
    if (document.querySelector('input[type="password"]')) {
      const txt = document.body.innerText
      if (/verification|one.?time|2fa|two.?factor|enter the code|security code|authentication code|otp|passcode/i.test(txt)) {
        return { success: true, status: '2fa_required', result: 'Credentials accepted — a 2FA / verification code is now required. Ask the user for the code, then type it into the code field on this page.' }
      }
      const err = findErrorText()
      return { success: false, status: 'login_failed', error: err || 'Still on the login page after submitting — credentials may be incorrect or an unexpected field is required.' }
    }
    return { success: true, status: 'logged_in', result: 'Login succeeded — you are now authenticated on this site.' }
  },

  // Create a NEW account on ANY site. Detects the registration form generically
  // (name + email/username + password + confirm password + "Sign up"/"Create
  // account" submit), optionally clicks a "Sign up" entry point first, fills the
  // fields, submits, then reports the outcome. args: [email/username, password]
  // — the password may carry an optional display name after a pipe:
  //   create_account: you@site.com P@ssw0rd | Jane Doe
  async create_account(args) {
    markPageDirty()
    const email = (args[0] || '').trim()
    const raw = (args[1] || '').trim()
    if (!email || !raw) return { success: false, error: 'Usage: create_account: <email/username> <password> [|Full Name]' }
    let password = raw
    let name = ''
    const pipe = raw.indexOf('|')
    if (pipe > 0) { password = raw.slice(0, pipe).trim(); name = raw.slice(pipe + 1).trim() }

    // If we are NOT yet on a signup form but a "Sign up"/"Create account" entry
    // point exists, click it to reach the registration form.
    const signupLink = Array.from(document.querySelectorAll('a, button, [role="button"]')).find(b => {
      const t = ((b.textContent || '') + (b.getAttribute('aria-label') || '')).toLowerCase()
      return /sign ?up|create ?account|register|join ?(for|now)?|get ?started/i.test(t)
    }) as HTMLElement | undefined
    if (!findSignupFields() && signupLink) {
      flashElement(signupLink); signupLink.click()
      await sleepMs(2200)
    }

    const fields = findSignupFields() || findLoginFields()
    if (!fields || !fields.pw) return { success: false, error: 'No signup/registration form detected on this page. Navigate to the site\'s sign-up page first.' }

    try {
      const displayName = name || email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      if (fields.name && displayName) { focusAndClick(fields.name); await clearInput(fields.name); await typeInto(fields.name, displayName) }
      if (fields.email) { focusAndClick(fields.email); await clearInput(fields.email); await typeInto(fields.email, email) }
      focusAndClick(fields.pw); await clearInput(fields.pw); await typeInto(fields.pw, password)
      if (fields.confirmPw) { focusAndClick(fields.confirmPw); await clearInput(fields.confirmPw); await typeInto(fields.confirmPw, password) }
    } catch (e) {
      return { success: false, error: 'Could not fill the registration fields: ' + (e as Error).message }
    }

    if (fields.submit) { flashElement(fields.submit); (fields.submit as HTMLElement).click() }
    else { fields.pw.focus(); fields.pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })) }

    await sleepMs(3200)

    const txt = document.body.innerText
    if (/confirm your email|verify your email|check your (email|inbox)|verification link|activate your account|confirmation|almost there/i.test(txt)) {
      return { success: true, status: 'verification_required', result: 'Account created — a verification/confirmation email was sent. Ask the user to confirm their email before the account is fully active.' }
    }
    if (/phone|sms|text message|mobile number/i.test(txt) && /verif|confirm|code/i.test(txt)) {
      return { success: true, status: 'verification_required', result: 'Account created — a phone/SMS verification is required. Ask the user for the code.' }
    }
    if (document.querySelector('input[type="password"]')) {
      const err = findErrorText()
      return { success: false, status: 'creation_failed', error: err || 'Still on a signup form after submitting — the account may not have been created (email already taken, weak password, or a required field is missing).' }
    }
    return { success: true, status: 'account_created', result: 'Account created and registered successfully — you are now signed in.' }
  },

  // Extract
  get_page_text() {
    const text = document.body.innerText
    const truncated = text.length > 5000 ? text.slice(0, 5000) + '...' : text
    return { success: true, result: truncated }
  },

  observe_page() {
    const sig = pageSignature()
    if (_observeCache && _observeCache.sig === sig && !_observeDirty) {
      return _observeCache.data
    }
    ensureDirtyObserver()

    const url = window.location.href
    const title = document.title
    const inputs: any[] = []
    const buttons: any[] = []
    const links: any[] = []
    const headings: any[] = []
    const selects: any[] = []
    const dialogs: any[] = []
    const iframes: any[] = []

    // Build a single label map up front (one query) instead of one
    // querySelector per input (removes N DOM queries in the input loop).
    const labelMap = new Map<string, string>()
    document.querySelectorAll('label[for]').forEach((l) => {
      const forAttr = l.getAttribute('for')
      if (forAttr) labelMap.set(forAttr, l.textContent?.trim() || '')
    })

    // --- Inputs (text fields, textareas, contenteditable, role=textbox) ---
    // Emit stable locators (role, name, data-testid, aria-label) so the agent
    // can target elements resiliently instead of relying on brittle text.
    document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"]').forEach((el) => {
      const e = el as HTMLElement
      const label = e.id ? (labelMap.get(e.id) || '') : ''
      const ariaLabel = e.getAttribute('aria-label') || ''
      inputs.push({
        type: e.getAttribute('type') || (e.tagName.toLowerCase() === 'textarea' ? 'textarea' : e.getAttribute('role') || 'text'),
        placeholder: e.getAttribute('placeholder') || ariaLabel || e.getAttribute('data-placeholder') || '',
        enabled: !(e as HTMLInputElement).disabled && !e.getAttribute('aria-disabled'),
        label: label || ariaLabel,
        role: e.getAttribute('role') || e.tagName.toLowerCase(),
        name: e.getAttribute('name') || '',
        testId: e.getAttribute('data-testid') || '',
      })
    })

    // --- Buttons (include icon-only buttons by aria-label) ---
    document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"]').forEach((el) => {
      const e = el as HTMLElement
      const text = e.textContent?.trim() || e.getAttribute('aria-label') || e.getAttribute('title') || ''
      if (text || e.getAttribute('aria-label')) {
        buttons.push({
          text: text.slice(0, 80) || e.getAttribute('aria-label')?.slice(0, 40) || '[icon]',
          enabled: !(el as HTMLButtonElement).disabled && e.getAttribute('aria-disabled') !== 'true',
          role: e.getAttribute('role') || e.tagName.toLowerCase(),
          name: (el as HTMLButtonElement).name || e.getAttribute('name') || '',
          testId: e.getAttribute('data-testid') || '',
        })
      }
    })
    // Also add <a> elements that look like buttons (have button classes or role=button)
    document.querySelectorAll('a[href].btn, a[href][role="button"], a[href].button, a[href][class*="btn"]').forEach((el) => {
      const text = el.textContent?.trim() || ''
      if (text && !buttons.some(b => b.text === text.slice(0, 80))) {
        buttons.push({ text: text.slice(0, 80), enabled: true, role: 'link-button' })
      }
    })

    // --- Links ---
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href
      const text = a.textContent?.trim() || a.getAttribute('aria-label') || ''
      if (href && !href.startsWith('javascript:') && !href.startsWith('#') && text) {
        links.push({ text: text.slice(0, 80), href: href.slice(0, 120) })
      }
    })

    // --- Headings ---
    document.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
      const text = h.textContent?.trim()
      if (text) headings.push({ tag: h.tagName.toLowerCase(), text: text.slice(0, 120) })
    })

    // --- Select / Dropdown ---
    document.querySelectorAll('select').forEach((s) => {
      const e = s as HTMLSelectElement
      const options = Array.from(e.options).map(o => o.text).filter(Boolean).slice(0, 10)
      selects.push({
        id: e.id || '',
        name: e.name || '',
        label: (e.id ? (labelMap.get(e.id) || '') : '') || e.getAttribute('aria-label') || '',
        options,
        value: e.value,
        enabled: !e.disabled,
      })
    })

    // --- Dialogs / Modals / Overlays ---
    document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, .modal, .modal-dialog, [class*="overlay"]').forEach((d) => {
      const text = (d as HTMLElement).textContent?.trim().slice(0, 200) || ''
      if (text) dialogs.push({ role: d.getAttribute('role') || 'dialog', text })
    })

    // --- Iframes (count and list origins) ---
    document.querySelectorAll('iframe').forEach((f) => {
      const frame = f as HTMLIFrameElement
      iframes.push({ src: frame.src?.slice(0, 80) || 'about:blank', id: frame.id || '' })
    })

    // --- Page text summary ---
    const bodyText = document.body.innerText
    // Keep BOTH the head (context) and the TAIL of the page. On chat
    // interfaces the latest assistant reply sits at the end of the DOM,
    // directly above the composer — so the tail is what the agent must read
    // to follow up. A long user prompt must not push the reply out of view.
    const head = bodyText.slice(0, 900)
    const tail = bodyText.length > 900 ? '\n…\n' + bodyText.slice(-2000) : ''
    const textSummary = (head + tail)

    // --- Loading / Streaming ---
    const loading = document.querySelector('[aria-busy="true"], .loading, .spinner, [role="progressbar"], .progress-bar') !== null
    const streamingEl = document.querySelector('[role="status"][aria-label*="stream"], [aria-label*="generating"]')
    const streaming = streamingEl !== null

    // --- Image count: only COUNT artwork generated in the conversation panel
    // (not UI icons/avatars) so the planner knows when real images exist. ---
    const imgCount = getContentImages().length

    const data: any = {
      success: true,
      result: JSON.stringify({
        url,
        title,
        loading,
        streaming,
        textSummary: textSummary.slice(0, 3200),
        inputs: inputs.slice(0, 12),
        buttons: buttons.slice(0, 20),
        links: links.slice(0, 12),
        headings: headings.slice(0, 8),
        selects: selects.slice(0, 6),
        dialogs: dialogs.slice(0, 3),
        iframes: iframes.slice(0, 3),
        elementCount: {
          inputs: inputs.length,
          buttons: buttons.length,
          links: links.length,
          selects: selects.length,
        },
        imgCount,
      }),
    }
    _observeCache = { sig, data }
    _observeDirty = false
    return data
  },

  // Keep a light text fallback for debugging
  get_visible_text() {
    const text = document.body.innerText
    const truncated = text.length > 3000 ? text.slice(0, 3000) + '...' : text
    return { success: true, result: truncated }
  },

  copy_all_text() {
    const text = document.body.innerText
    navigator.clipboard.writeText(text).then(() => {})
    return { success: true, result: `Copied ${text.length} characters to clipboard` }
  },

  extract_images() {
    const urls: string[] = []
    document.querySelectorAll('img[src]').forEach((img) => {
      const src = (img as HTMLImageElement).src
      if (src && src.startsWith('http') && !urls.includes(src)) urls.push(src)
    })
    return urls.length > 0
      ? { success: true, result: `Found ${urls.length} image(s):\n${urls.slice(0, 15).join('\n')}` + (urls.length > 15 ? `\n...and ${urls.length - 15} more` : '') }
      : { success: false, error: 'No images found' }
  },

  // Download images from the current page — used to SAVE graphics that an AI
  // (e.g. ChatGPT image generation) produced. ONLY targets artwork rendered in
  // the conversation panel (see getContentImages) — never UI icons/avatars —
  // and picks the largest first. args: [count | "all"] (default 1, largest only).
  download_image(args) {
    const arg = (args[0] || '').trim()
    const max = /^\d+$/.test(arg) ? parseInt(arg, 10) : (arg === 'all' ? 50 : 1)
    const candidates = getContentImages()
    if (!candidates.length) return { success: false, error: 'No generated artwork images found in the chat conversation. (Icons/avatars are ignored — wait for ChatGPT to actually generate an image.)' }
    const pick = candidates.slice(0, Math.max(1, max))
    const saved: string[] = []
    pick.forEach((c, i) => {
      try {
        const a = document.createElement('a')
        a.href = c.src
        const ext = c.src.startsWith('data:image/png') ? 'png'
          : c.src.startsWith('data:image/webp') ? 'webp'
          : c.src.startsWith('data:image/jpeg') ? 'jpg'
          : 'png'
        a.download = `synapse-image-${Date.now()}-${i + 1}.${ext}`
        document.body.appendChild(a)
        a.click()
        a.remove()
        flashElement(c.img)
        saved.push(a.download)
      } catch {}
    })
    return saved.length
      ? { success: true, status: 'downloaded', result: `Downloaded ${saved.length} image(s):\n${saved.join('\n')}` }
      : { success: false, error: 'Found images but the browser blocked the download (use the save action with a direct image URL instead).' }
  },

  extract_links() {
    const links: { text: string; href: string }[] = []
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = (a as HTMLAnchorElement).href
      const text = (a.textContent || '').trim()
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        links.push({ text: text.slice(0, 60), href })
      }
    })
    const unique = links.filter((l, i, a) => a.findIndex(x => x.href === l.href) === i)
    return unique.length > 0
      ? { success: true, result: `Found ${unique.length} link(s):\n${unique.slice(0, 20).map(l => `${l.text ? `"${l.text}" → ` : ''}${l.href}`).join('\n')}` + (unique.length > 20 ? `\n...and ${unique.length - 20} more` : '') }
      : { success: false, error: 'No links found' }
  },

  extract_video_sources() {
    const urls: string[] = []
    document.querySelectorAll('video').forEach((v, i) => {
      const src = (v as HTMLVideoElement).src
      if (src && src.startsWith('http') && !urls.includes(src)) urls.push(`#${i + 1}: ${src}`)
      v.querySelectorAll('source').forEach((s, j) => {
        const src2 = (s as HTMLSourceElement).src
        if (src2 && src2.startsWith('http') && !urls.some(u => u.includes(src2))) urls.push(`#${i + 1}:${j + 1} ${src2}`)
      })
    })
    return urls.length > 0
      ? { success: true, result: `Found ${urls.length} video source(s):\n${urls.join('\n')}` }
      : { success: false, error: 'No video elements found on this page' }
  },

  // Highlight
  highlight_elements(args) {
    const selector = args[0] || 'h1, h2, h3, button, a, [role="button"], img, video'
    const els = document.querySelectorAll(selector)
    els.forEach((el, i) => {
      ;(el as HTMLElement).style.outline = '3px solid #1877F2'
      ;(el as HTMLElement).style.outlineOffset = '2px'
      const badge = document.createElement('div')
      badge.className = 'synapse-badge'
      badge.style.cssText = 'position:absolute;top:-18px;left:0;background:#1877F2;color:white;padding:1px 6px;border-radius:4px;font-size:10px;z-index:999;'
      badge.textContent = `${i + 1}`
      ;(el as HTMLElement).style.position = 'relative'
      el.appendChild(badge)
    })
    setTimeout(() => {
      els.forEach((el) => {
        ;(el as HTMLElement).style.outline = ''
        ;(el as HTMLElement).style.outlineOffset = ''
        const badges = el.querySelectorAll('.synapse-badge')
        badges.forEach((b) => b.remove())
      })
    }, 5000)
    return { success: true, result: `Highlighted ${els.length} elements for 5s` }
  },

  // Count
  count_elements(args) {
    const selector = args[0] || 'h1, h2, h3, p, a, button, img, video, input'
    const els = document.querySelectorAll(selector)
    return { success: true, result: `Found ${els.length} element(s) matching "${selector}"` }
  },

  get_page_stats() {
    const els = (sel: string) => document.querySelectorAll(sel).length
    return {
      success: true,
      result: `Page Stats:
📄 Title: ${document.title.slice(0, 60)}
🔗 Links: ${els('a[href]')}
🖼️ Images: ${els('img[src]')}
🎬 Videos: ${els('video')}
🔘 Buttons: ${els('button, [role="button"]')}
📝 Inputs: ${els('input, textarea')}
📰 Paragraphs: ${els('p')}
#️⃣ Headings: ${els('h1, h2, h3')}
📏 Height: ${Math.round(document.body.scrollHeight / window.innerHeight * 10) / 10}x viewport`,
    }
  },

  // Hide / Layout
  hide_element(args) {
    const selector = args.join(' ')
    if (!selector) return { success: false, error: 'Usage: hide_element: css_selector' }
    const els = querySelectorAllDeep(selector)
    els.forEach((el) => { (el as HTMLElement).style.display = 'none' })
    return els.length > 0
      ? { success: true, result: `Hidden ${els.length} element(s): ${selector}` }
      : { success: false, error: `No elements found: ${selector}` }
  },

  // --- Facebook Post Tools ---

  async post_to_facebook(args) {
    markPageDirty()
    const text = args.join(' ')
    if (!text) return { success: false, error: 'Usage: post_to_facebook: generated post text' }

    const selectors = [
      '[contenteditable="true"][aria-label*="post"i]',
      '[contenteditable="true"][aria-label*="write"i]',
      '[contenteditable="true"][aria-label*="what"i]',
      '[contenteditable="true"][aria-label*="think"i]',
      '[role="dialog"] [contenteditable="true"]',
      '[data-pagelet*="Composer"] [contenteditable="true"]',
      'form [contenteditable="true"]',
      'div[role="presentation"] [contenteditable="true"]',
    ]

    let composer: HTMLElement | null = null
    for (const sel of selectors) {
      composer = document.querySelector(sel)
      if (composer) break
    }

    if (!composer) {
      const allEditable = document.querySelectorAll<HTMLElement>('[contenteditable="true"]')
      for (const el of allEditable) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 200 && rect.height > 50) { composer = el; break }
      }
    }

    if (!composer) return { success: false, error: 'No Facebook post composer found on this page. Make sure you are on Facebook with the composer visible.' }

    flashElement(composer)
    composer.focus()
    composer.innerText = ''

    document.execCommand('insertText', false, text)

    composer.dispatchEvent(new Event('input', { bubbles: true }))
    composer.dispatchEvent(new Event('change', { bubbles: true }))

    setTimeout(() => {
      composer?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    }, 100)

    return { success: true, result: `Post content filled into Facebook composer (${text.length} chars). Review and publish manually.` }
  },

  async post_to_facebook_and_publish(args) {
    markPageDirty()
    const text = args.join(' ')
    if (!text) return { success: false, error: 'Usage: post_to_facebook_and_publish: generated post text' }
    const result = await tools.post_to_facebook([text]) as ToolResult
    if (!result.success) return result

    setTimeout(() => {
      const publishBtns = document.querySelectorAll<HTMLElement>(
        '[aria-label*="post"i][role="button"], [aria-label*="share"i][role="button"], ' +
        '[data-pagelet*="Composer"] button[type="submit"], ' +
        'div[role="button"]:not([aria-label*="photo"]):not([aria-label*="video"]):not([aria-label*="tag"])'
      )
      for (const btn of publishBtns) {
        const text = btn.textContent?.toLowerCase() || ''
        if (text.includes('post') || text.includes('share') || text.includes('publish')) {
          btn.click()
          break
        }
      }
    }, 500)

    return { success: true, result: 'Post content filled and publish button clicked.' }
  },

  detect_facebook_page_type() {
    const url = window.location.href.toLowerCase()
    const path = new URL(url).pathname

    if (path.match(/^\/(pages\/)?[^/]+\/?$/) || path.includes('/profile')) return { success: true, result: 'page' }
    if (path.includes('/posts/') || path.includes('/photos/') || path.includes('/videos/')) return { success: true, result: 'post' }
    if (path.includes('/groups/')) return { success: true, result: 'group' }
    if (path.includes('/messages/') || path.includes('/inbox')) return { success: true, result: 'inbox' }
    if (path.includes('/insights') || path.includes('/analytics')) return { success: true, result: 'insights' }
    if (path.includes('/marketplace')) return { success: true, result: 'marketplace' }

    const meta = document.querySelector('meta[property="og:site_name"]')
    if (meta?.getAttribute('content')?.toLowerCase().includes('facebook')) return { success: true, result: 'facebook' }

    return { success: true, result: 'unknown' }
  },

  extract_facebook_page_style() {
    const pageName = document.querySelector('h1, [data-pageheader] h1, [data-testid="page_header"] h1, meta[property="og:title"]')?.textContent?.trim()
      || (document.querySelector('meta[property="og:title"]') as HTMLMetaElement)?.getAttribute('content')?.trim()
      || document.title.replace(' | Facebook', '').trim() || ''

    const pageDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim()
      || document.querySelector('[data-testid="page_header"] ~ div p')?.textContent?.trim()
      || ''

    const recentPosts: string[] = []
    document.querySelectorAll('[role="article"], article, [data-pagelet^="FeedUnit"]').forEach((el) => {
      const text = (el as HTMLElement).textContent?.trim()
      if (text && text.length > 20 && text.length < 1000) {
        recentPosts.push(text.slice(0, 300))
      }
    })

    const styleSummary = `
Page Name: ${pageName}
Description: ${pageDesc}
Recent Posts (${Math.min(recentPosts.length, 5)} samples):
${recentPosts.slice(0, 5).map((p, i) => `[Post ${i + 1}]: ${p}`).join('\n')}
`.trim()

    return {
      success: true,
      result: styleSummary,
    }
  },

  find_facebook_composer() {
    const selectors = [
      '[contenteditable="true"][aria-label*="post"i]',
      '[contenteditable="true"][aria-label*="write"i]',
      '[contenteditable="true"][aria-label*="what"i]',
      '[role="dialog"] [contenteditable="true"]',
      '[data-pagelet*="Composer"] [contenteditable="true"]',
      'form [contenteditable="true"]',
    ]

    let composer: HTMLElement | null = null
    for (const sel of selectors) {
      composer = document.querySelector(sel)
      if (composer) break
    }

    if (!composer) {
      const allEditable = document.querySelectorAll<HTMLElement>('[contenteditable="true"]')
      for (const el of allEditable) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 200 && rect.height > 50) { composer = el; break }
      }
    }

    if (!composer) return { success: false, error: 'No Facebook composer found' }
    return { success: true, result: 'Facebook composer found on this page' }
  },

  // --- Gmail Tools (read / compose / reply / forward / search / organize) ---

  // Wait for + fill a Gmail field by a list of candidate selectors.
  async gmailFillField(args) {
    const selectors = args[0]
    const text = args[1] || ''
    const found = await waitForVisibleInput(selectors, args[2] || 12000)
    if (!found) return null
    const el = found.el
    focusAndClick(el)
    flashElement(el)
    await sleepMs(120)
    await clearInput(el)
    await typeInto(el, text)
    return el
  },

  // Click the first enabled button whose text/aria-label matches the regex.
  gmailClickButton(args) {
    const re = args[0]
    const btns = Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]')) as HTMLElement[]
    for (const b of btns) {
      const t = (b.textContent || '').trim().toLowerCase()
      const al = (b.getAttribute('aria-label') || '').toLowerCase()
      if (!t && !al) continue
      if ((b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true') continue
      if (re.test(t) || re.test(al)) { flashElement(b); focusAndClick(b); return true }
    }
    return false
  },

  // Open (and read) a thread. If a query is given, search first then open the
  // first matching row; otherwise open the first row in the current list.
  async gmail_open(args) {
    markPageDirty()
    const query = (args[0] || '').trim()
    if (query) {
      const ok = await tools.gmail_search([query])
      if (!ok.success) return ok
      await sleepMs(2500)
    }
    const row = document.querySelector('div[role="row"], tr[role="row"], [role="listitem"]') as HTMLElement | null
    if (row) { flashElement(row); row.click(); await sleepMs(2000) }
    return tools.gmail_read([])
  },

  // Read the currently open thread's text.
  gmail_read(args) {
    const items = Array.from(document.querySelectorAll('div[role="listitem"]')) as HTMLElement[]
    let text = items.map(i => (i.innerText || '').trim()).filter(Boolean).join('\n\n— — —\n\n')
    if (!text) {
      const main = document.querySelector('[role="main"], div[gh="default"]') as HTMLElement | null
      text = (main ? main.innerText : document.body.innerText) || ''
    }
    const trimmed = text.trim()
    if (!trimmed) return { success: false, error: 'No email thread appears to be open. Open an email first (gmail: open).' }
    return { success: true, result: `📧 Email content:\n${trimmed.slice(0, 6000)}` }
  },

  // Compose + send. args: [to, subject, body]
  async gmail_compose(args) {
    markPageDirty()
    const to = (args[0] || '').trim()
    const subject = (args[1] || '').trim()
    const body = (args.slice(2).join(' | ') || '').trim()
    if (!to && !body) return { success: false, error: 'Usage: gmail compose: to | subject | body' }
    if (!tools.gmailClickButton([/compose/i])) return { success: false, error: 'Compose button not found on this Gmail page.' }
    await sleepMs(1200)
    if (to) {
      const toEl = await tools.gmailFillField([['input[aria-label*="To" i]', 'textarea[aria-label*="To" i]', 'input[name="to"]'], to])
      if (!toEl) return { success: false, error: 'Could not find the Gmail "To" field.' }
    }
    if (subject) await tools.gmailFillField([['input[aria-label*="Subject" i]', 'input[name="subject"]'], subject])
    if (body) {
      const bodyEl = await tools.gmailFillField([['div[aria-label*="Message Body" i][contenteditable="true"]', 'div[role="textbox"][aria-label*="Message Body" i]', '[contenteditable="true"][aria-label*="Body" i]'], body])
      if (!bodyEl) return { success: false, error: 'Could not find the Gmail message body field.' }
    }
    await sleepMs(400)
    if (!tools.gmailClickButton([/^send$/i])) return { success: false, error: 'Compose window opened and filled, but the "Send" button was not found — the email was NOT sent. Finish it manually.' }
    return { success: true, result: `📤 Email composed and Send clicked (to: ${to || '(none)'}, subject: ${subject || '(none)'}).` }
  },

  // Reply to the open thread. args: [body]
  async gmail_reply(args) {
    markPageDirty()
    const body = (args[0] || '').trim()
    if (!body) return { success: false, error: 'Usage: gmail reply: your reply text' }
    if (!tools.gmailClickButton([/reply/i])) return { success: false, error: 'No open thread or "Reply" button not found.' }
    await sleepMs(1000)
    const bodyEl = await tools.gmailFillField([['div[aria-label*="Message Body" i][contenteditable="true"]', 'div[role="textbox"][aria-label*="Message Body" i]'], body])
    if (!bodyEl) return { success: false, error: 'Reply window opened but the body field was not found.' }
    await sleepMs(400)
    tools.gmailClickButton([/^send$/i])
    return { success: true, result: '📤 Reply written and Send clicked.' }
  },

  // Forward the open thread. args: [to, note]
  async gmail_forward(args) {
    markPageDirty()
    const to = (args[0] || '').trim()
    const note = (args.slice(1).join(' | ') || '').trim()
    if (!tools.gmailClickButton([/forward/i])) return { success: false, error: 'No open thread or "Forward" button not found.' }
    await sleepMs(1000)
    if (to) await tools.gmailFillField([['input[aria-label*="To" i]', 'textarea[aria-label*="To" i]'], to])
    if (note) await tools.gmailFillField([['div[aria-label*="Message Body" i][contenteditable="true"]', 'div[role="textbox"][aria-label*="Message Body" i]'], note])
    await sleepMs(400)
    tools.gmailClickButton([/^send$/i])
    return { success: true, result: '📤 Forward written and Send clicked.' }
  },

  // Search Gmail. args: [query]
  async gmail_search(args) {
    markPageDirty()
    const q = (args.join(' ') || '').trim()
    if (!q) return { success: false, error: 'Usage: gmail search: query' }
    const box = await tools.gmailFillField([['textarea[aria-label*="Search mail" i]', 'input[aria-label*="Search mail" i]', '[aria-label*="Search mail" i]'], q])
    if (!box) return { success: false, error: 'Gmail search box not found.' }
    await sleepMs(200)
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    box.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    return { success: true, result: `🔎 Searched Gmail for: ${q}` }
  },

  gmail_archive() {
    markPageDirty()
    return tools.gmailClickButton([/archive/i])
      ? { success: true, result: '🗄️ Email archived.' }
      : { success: false, error: 'Archive button not found.' }
  },

  gmail_trash() {
    markPageDirty()
    return tools.gmailClickButton([/delete|trash/i])
      ? { success: true, result: '🗑️ Email moved to Trash.' }
      : { success: false, error: 'Delete/Trash button not found.' }
  },

  gmail_snooze() {
    markPageDirty()
    return tools.gmailClickButton([/snooze/i])
      ? { success: true, result: '⏰ Email snoozed.' }
      : { success: false, error: 'Snooze button not found.' }
  },

  gmail_mark_read(args) {
    markPageDirty()
    const unread = /unread/i.test(args[0] || '')
    if (!tools.gmailClickButton([/more/i])) return { success: false, error: 'Could not find the "More" menu.' }
    return tools.findTextAndClick(unread ? 'Mark as unread' : 'Mark as read')
      ? { success: true, result: `✉️ Marked as ${unread ? 'unread' : 'read'}.` }
      : { success: false, error: 'Mark as read/unread menu item not found.' }
  },

  gmail_label(args) {
    markPageDirty()
    const label = (args[0] || '').trim()
    if (!label) return { success: false, error: 'Usage: gmail label: LabelName' }
    if (!tools.gmailClickButton([/label/i])) return { success: false, error: 'Labels button not found.' }
    return tools.findTextAndClick(label)
      ? { success: true, result: `🏷️ Applied label "${label}".` }
      : { success: false, error: `Label "${label}" not found in the menu.` }
  },

  // List the visible inbox/list threads (sender | subject | snippet | date).
  gmail_list(args) {
    const max = parseInt(args[0]) || 10
    const rows = Array.from(document.querySelectorAll('tr[role="row"], div[role="row"]'))
      .filter((r) => r.querySelector && r.querySelector('input[type="checkbox"]')) as HTMLElement[]
    const threads = rows
      .map((r) => (r.innerText || '').replace(/\n+/g, ' | ').replace(/\s{2,}/g, ' ').trim())
      .filter((t) => t.length > 4 && /[a-zA-Z]/.test(t))
      .slice(0, max)
    if (!threads.length) return { success: false, error: 'No email rows found. Make sure you are on the Gmail inbox/list view.' }
    return { success: true, result: `📋 Mail list (${threads.length}):\n` + threads.map((t, i) => `#${i + 1}: ${t}`).join('\n') }
  },

  // Toggle the star on the open thread.
  gmail_star() {
    markPageDirty()
    return tools.gmailClickButton([/star/i])
      ? { success: true, result: '⭐ Starred / unstarred the thread.' }
      : { success: false, error: 'Star button not found (open a thread first).' }
  },

  // Toggle "important" on the open thread.
  gmail_important() {
    markPageDirty()
    return tools.gmailClickButton([/important/i])
      ? { success: true, result: '⚠️ Marked important / not important.' }
      : { success: false, error: 'Important button not found (open a thread first).' }
  },

  // Report the open thread as spam (moves it to Spam).
  gmail_spam() {
    markPageDirty()
    return tools.gmailClickButton([/report spam|spam/i])
      ? { success: true, result: '🚩 Reported as spam / moved to Spam.' }
      : { success: false, error: 'Spam / Report spam button not found.' }
  },

  // Reply-all to the open thread. args: [body]
  async gmail_reply_all(args) {
    markPageDirty()
    const body = (args[0] || '').trim()
    if (!body) return { success: false, error: 'Usage: gmail reply_all: your reply text' }
    if (!tools.gmailClickButton([/reply all/i])) return { success: false, error: 'No open thread or "Reply all" button not found.' }
    await sleepMs(1000)
    const bodyEl = await tools.gmailFillField([['div[aria-label*="Message Body" i][contenteditable="true"]', 'div[role="textbox"][aria-label*="Message Body" i]'], body])
    if (!bodyEl) return { success: false, error: 'Reply-all window opened but the body field was not found.' }
    await sleepMs(400)
    tools.gmailClickButton([/^send$/i])
    return { success: true, result: '📤 Reply-all written and Send clicked.' }
  },

  // Compose and save as a draft (Gmail auto-saves; leave the window open).
  async gmail_draft(args) {
    markPageDirty()
    const to = (args[0] || '').trim()
    const subject = (args[1] || '').trim()
    const body = (args.slice(2).join(' | ') || '').trim()
    if (!to && !body) return { success: false, error: 'Usage: gmail draft: to | subject | body' }
    if (!tools.gmailClickButton([/compose/i])) return { success: false, error: 'Compose button not found on this Gmail page.' }
    await sleepMs(1200)
    if (to) {
      const e = await tools.gmailFillField([['input[aria-label*="To" i]', 'textarea[aria-label*="To" i]', 'input[name="to"]'], to])
      if (!e) return { success: false, error: 'Could not find the Gmail "To" field.' }
    }
    if (subject) await tools.gmailFillField([['input[aria-label*="Subject" i]', 'input[name="subject"]'], subject])
    if (body) {
      const b = await tools.gmailFillField([['div[aria-label*="Message Body" i][contenteditable="true"]', 'div[role="textbox"][aria-label*="Message Body" i]'], body])
      if (!b) return { success: false, error: 'Could not find the Gmail message body field.' }
    }
    await sleepMs(800)
    return { success: true, result: '📝 Draft composed and auto-saved by Gmail (it is kept under Drafts). Close the window to keep it.' }
  },

  // Move the open thread to a label/folder. args: [destination]
  async gmail_move(args) {
    markPageDirty()
    const dest = (args[0] || '').trim()
    if (!dest) return { success: false, error: 'Usage: gmail move: LabelOrFolder' }
    if (!tools.gmailClickButton([/move to/i])) return { success: false, error: '"Move to" button not found.' }
    await sleepMs(600)
    return tools.findTextAndClick(dest)
      ? { success: true, result: `📂 Moved to "${dest}".` }
      : { success: false, error: `Destination "${dest}" not found in the Move-to menu.` }
  },

  // Compose and schedule send (picks the first preset slot).
  async gmail_schedule(args) {
    markPageDirty()
    const to = (args[0] || '').trim()
    const subject = (args[1] || '').trim()
    const body = (args.slice(2).join(' | ') || '').trim()
    if (!to && !body) return { success: false, error: 'Usage: gmail schedule: to | subject | body' }
    if (!tools.gmailClickButton([/compose/i])) return { success: false, error: 'Compose button not found on this Gmail page.' }
    await sleepMs(1200)
    if (to) {
      const e = await tools.gmailFillField([['input[aria-label*="To" i]', 'textarea[aria-label*="To" i]', 'input[name="to"]'], to])
      if (!e) return { success: false, error: 'Could not find the Gmail "To" field.' }
    }
    if (subject) await tools.gmailFillField([['input[aria-label*="Subject" i]', 'input[name="subject"]'], subject])
    if (body) {
      const b = await tools.gmailFillField([['div[aria-label*="Message Body" i][contenteditable="true"]', 'div[role="textbox"][aria-label*="Message Body" i]'], body])
      if (!b) return { success: false, error: 'Could not find the Gmail message body field.' }
    }
    await sleepMs(400)
    if (!tools.gmailClickButton([/schedule send/i])) return { success: false, error: 'Compose filled, but "Schedule send" button not found.' }
    await sleepMs(600)
    const picked = tools.findTextAndClick('Tomorrow morning') || tools.findTextAndClick('Monday morning') || tools.findTextAndClick('Pick date')
    return picked ? { success: true, result: '⏰ Email scheduled to send later.' } : { success: true, result: '⏰ Opened the schedule menu (no preset slot auto-picked — choose a time manually).' }
  },

  // List (or download) attachments of the open thread.
  gmail_attachments(args) {
    markPageDirty()
    const download = /download/i.test(args[0] || '')
    const links = Array.from(document.querySelectorAll('a[href*="view=att"], a[href*="&attid="], a[aria-label*="Download"]')) as HTMLAnchorElement[]
    const found = links.filter((a) => (a.href || '').includes('att') || /download/i.test(a.getAttribute('aria-label') || ''))
    if (!found.length) return { success: false, error: 'No attachments found in the open thread.' }
    if (download) {
      found.forEach((a) => { try { a.click() } catch {} })
      return { success: true, result: `⬇️ Downloading ${found.length} attachment(s).` }
    }
    const names = found.map((a) => (a.getAttribute('aria-label') || a.textContent || a.href).replace(/\s+/g, ' ').trim()).filter(Boolean)
    return { success: true, result: `📎 ${found.length} attachment(s):\n${names.slice(0, 20).join('\n')}` }
  },

  // Unsubscribe from the open (promotional) email.
  gmail_unsubscribe() {
    markPageDirty()
    if (tools.gmailClickButton([/unsubscribe/i])) return { success: true, result: '🔕 Clicked Unsubscribe.' }
    const link = Array.from(document.querySelectorAll('a')).find((a) => /unsubscribe/i.test(a.textContent || ''))
    if (link) { (link as HTMLElement).click(); return { success: true, result: '🔕 Clicked the unsubscribe link.' } }
    return { success: false, error: 'No unsubscribe control found in this email.' }
  },

  // Mark every message as read (via the list "More" menu).
  gmail_mark_all_read() {
    markPageDirty()
    if (!tools.gmailClickButton([/more/i])) return { success: false, error: 'Could not find the "More" menu.' }
    return tools.findTextAndClick('Mark all as read')
      ? { success: true, result: '✅ Marked all messages as read.' }
      : { success: false, error: '"Mark all as read" option not found.' }
  },

  // Find and click by text
  find_and_click(args) {
    markPageDirty()
    const text = args.join(' ').trim()
    if (!text) return { success: false, error: 'Usage: find_and_click: text to find' }
    const found = tools.findTextAndClick(text)
    if (found) return { success: true, result: `Clicked element containing "${text}"` }
    return { success: false, error: `No clickable element found containing "${text}"` }
  },

  // Download a video by URL
  async download_video_from_url(args) {
    const url = args.join(' ')
    if (!url || !url.startsWith('http')) return { success: false, error: 'Usage: download_video_from_url: full_video_url' }
    try {
      const response = await fetch(url, { mode: 'cors' })
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` }
      const blob = await response.blob()
      const ext = blob.type.includes('mp4') ? '.mp4' : blob.type.includes('webm') ? '.webm' : '.mp4'
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl; a.download = `video_${Date.now()}${ext}`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)
      return { success: true, result: `Downloading video (${Math.round(blob.size / 1024)} KB)...` }
    } catch { return { success: false, error: 'Failed to download. The URL may be blocked.' } }
  },

  // Wait / Delay
  async wait(args) {
    const ms = Math.min(parseInt(args[0]) || 2000, 30000)
    await new Promise(r => setTimeout(r, ms))
    return { success: true, result: `Waited ${ms}ms` }
  },

  async wait_until(args) {
    // wait_until: selector | condition — condition is "visible", "enabled", "gone"
    // Example: wait_until: button[type="submit"] | enabled
    // Example: wait_until: textarea | visible
    // Example: wait_until: .spinner | gone
    const selector = (args[0] || '').trim()
    const condition = (args[1] || 'visible').toLowerCase()
    const timeout = Math.min(parseInt(args[2]) || 15000, 30000)
    if (!selector) return { success: false, error: 'Usage: wait_until: css_selector | condition(visible|enabled|gone) | timeout_ms' }
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const el = querySelectorDeep(selector)
      if (condition === 'gone') {
        if (!el) { markPageDirty(); return { success: true, result: `"${selector}" is gone (disappeared)` } }
      } else if (condition === 'enabled') {
        if (el && !(el as HTMLButtonElement).disabled) { markPageDirty(); return { success: true, result: `"${selector}" is enabled` } }
      } else {
        // visible
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) { markPageDirty(); return { success: true, result: `"${selector}" is visible` } }
        }
      }
      await new Promise(r => setTimeout(r, 300))
    }
    return { success: false, error: `Timed out waiting for "${selector}" to be ${condition} (${timeout}ms)` }
  },

  // Sequence
  async run_sequence(args) {
    const steps = args.join(' ')
    if (!steps) return { success: false, error: 'Usage: run_sequence: tool1 | arg1 | tool2 | arg2 ...' }
    const parsed: { tool: string; args: string[] }[] = []
    const parts = steps.split('|').map(s => s.trim())
    for (let i = 0; i < parts.length - 1; i += 2) {
      parsed.push({ tool: parts[i], args: parts[i + 1] ? parts[i + 1].split(' ').filter(Boolean) : [] })
    }
    if (parts.length % 2 !== 0) parsed.push({ tool: parts[parts.length - 1], args: [] })

    const out: string[] = []
    for (const step of parsed) {
      const toolFn = tools[step.tool]
      if (!toolFn) { out.push(`❌ Unknown tool: ${step.tool}`); continue }
      await new Promise(r => setTimeout(r, 1000))
      const res = await Promise.resolve(toolFn(step.args))
      out.push(res.success ? `✅ ${step.tool}: ${res.result || 'Done'}` : `❌ ${step.tool}: ${res.error || 'Failed'}`)
    }
    return { success: true, result: out.join('\n') }
  },

  // --- Content Creator Tools ---

  extract_visible_comments() {
    const comments: { author: string; text: string }[] = []
    const seen = new Set<string>()

    const commentSelectors = [
      '[role="article"] [role="comment"]',
      '[data-testid="UFI2Comment"]',
      '[data-commentid]',
      '.comment',
      '[data-pagelet^="Comment"]',
    ]

    for (const sel of commentSelectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const author = el.querySelector('a[href*="/user/"], a[href*="/profile.php"], [data-hovercard]')?.textContent?.trim()
          || el.querySelector('strong, b')?.textContent?.trim() || 'Unknown'
        const text = el.textContent?.trim() || ''
        if (text.length > 5 && !seen.has(text.slice(0, 50))) {
          seen.add(text.slice(0, 50))
          comments.push({ author, text: text.slice(0, 500) })
        }
      })
    }

    if (comments.length === 0) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
      const segments: string[] = []
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent?.trim()
        if (t && t.length > 20 && t.length < 1000) segments.push(t)
      }
      const lines = segments.join('\n').split('\n').filter(l => l.trim().length > 20)
      lines.slice(0, 20).forEach((line, i) => {
        comments.push({ author: `Commenter #${i + 1}`, text: line.slice(0, 500) })
      })
    }

    const summary = comments.slice(0, 30).map((c, i) =>
      `[${i + 1}] ${c.author}: ${c.text}`
    ).join('\n\n')

    return comments.length > 0
      ? { success: true, result: `Found ${comments.length} comment(s):\n\n${summary}` }
      : { success: false, error: 'No comments found on this page' }
  },

  get_page_hashtags() {
    const freq: Record<string, number> = {}

    const hashtagLinks = document.querySelectorAll('a[href*="/hashtag/"]')
    hashtagLinks.forEach((a) => {
      const tag = a.textContent?.trim()
      if (tag && tag.startsWith('#')) {
        freq[tag.toLowerCase()] = (freq[tag.toLowerCase()] || 0) + 1
      }
    })

    const text = document.body.innerText
    const regex = /#(\w+)/g
    let match
    while ((match = regex.exec(text)) !== null) {
      const tag = `#${match[1].toLowerCase()}`
      freq[tag] = (freq[tag] || 0) + 1
    }

    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 30)

    if (top.length === 0) return { success: false, error: 'No hashtags found on this page' }

    const result = top.map(([tag, count]) =>
      `${tag} ×${count}`
    ).join('\n')

    return {
      success: true,
      result: `Found ${sorted.length} unique hashtag(s). Top ${top.length}:\n\n${result}`,
    }
  },

  analyze_post_engagement() {
    const posts: { text: string; likes: string; comments: string; shares: string; author: string }[] = []

    document.querySelectorAll('[role="article"], article, [data-pagelet^="FeedUnit"]').forEach((el) => {
      const text = (el as HTMLElement).textContent?.trim() || ''
      if (text.length < 20) return

      const likeEl = el.querySelector('[aria-label*="Like"i], a[href*="reactions"], [data-testid*="like"]')
      const commentEl = el.querySelector('[aria-label*="Comment"i], a[href*="comment"]')
      const shareEl = el.querySelector('[aria-label*="Share"i]')
      const authorEl = el.querySelector('[data-hovercard] a, a[href*="/user/"], a[href*="/profile.php"], strong')

      posts.push({
        text: text.slice(0, 200),
        likes: likeEl?.textContent?.trim() || '—',
        comments: commentEl?.textContent?.trim() || '—',
        shares: shareEl?.textContent?.trim() || '—',
        author: authorEl?.textContent?.trim() || 'Unknown',
      })
    })

    if (posts.length === 0) return { success: false, error: 'No posts detected on this page' }

    const totalLikes = posts.reduce((sum, p) => {
      const n = parseInt(p.likes.replace(/[^0-9]/g, ''))
      return sum + (isNaN(n) ? 0 : n)
    }, 0)

    const totalComments = posts.reduce((sum, p) => {
      const n = parseInt(p.comments.replace(/[^0-9]/g, ''))
      return sum + (isNaN(n) ? 0 : n)
    }, 0)

    const lines = posts.slice(0, 10).map((p, i) =>
      `Post #${i + 1} by ${p.author}\n❤️ ${p.likes}  💬 ${p.comments}  🔄 ${p.shares}\n"${p.text}"`
    ).join('\n\n---\n\n')

    return {
      success: true,
      result: `📊 Engagement Overview — ${posts.length} post(s)\n👍 Total likes: ${totalLikes}\n💬 Total comments: ${totalComments}\n\n${lines}`,
    }
  },

  get_page_hashtag_suggestions(args) {
    const topic = args.join(' ').toLowerCase()
    const allTags = new Set<string>()

    document.querySelectorAll('a[href*="/hashtag/"]').forEach((a) => {
      const tag = a.textContent?.trim()
      if (tag) allTags.add(tag)
    })

    const text = document.body.innerText.toLowerCase()
    const regex = /#(\w+)/g
    let match
    while ((match = regex.exec(text)) !== null) {
      allTags.add(`#${match[1]}`)
    }

    const related = Array.from(allTags)
      .filter(t => !topic || t.includes(topic))
      .slice(0, 20)

    const popular = Array.from(allTags).slice(0, 30)

    const suggestions = related.length > 0
      ? `Related to "${topic}":\n${related.join(', ')}`
      : `Popular on this page:\n${popular.join(', ')}`

    return {
      success: true,
      result: suggestions,
    }
  },

  extract_page_niche_keywords() {
    const title = document.title.toLowerCase()
    const metaKeywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content')?.toLowerCase() || ''
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content')?.toLowerCase() || ''
    const ogTitle = (document.querySelector('meta[property="og:title"]') as HTMLMetaElement)?.getAttribute('content')?.toLowerCase() || ''
    const ogDesc = (document.querySelector('meta[property="og:description"]') as HTMLMetaElement)?.getAttribute('content')?.toLowerCase() || ''

    const text = document.body.innerText.toLowerCase().slice(0, 5000)

    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'this', 'that', 'these', 'those', 'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their', 'i', 'me', 'my', 'he', 'she', 'him', 'her', 'his', 'not', 'no', 'nor', 'so', 'very', 'just', 'about', 'above', 'after', 'again', 'all', 'also', 'any', 'because', 'been', 'before', 'being', 'between', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'that', 'there', 'these', 'this', 'those', 'through', 'too', 'under', 'up', 'into', 'over', 'then', 'once', 'here', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom'])

    const words = text.split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w))
    const freq: Record<string, number> = {}
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1 })

    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
    const topKeywords = sorted.slice(0, 20).map(([w, c]) => `${w} (×${c})`).join('\n')

    const combined = [title, metaKeywords, metaDesc, ogTitle, ogDesc].filter(Boolean).join(' · ')

    return {
      success: true,
      result: `📌 Page Niche: ${title.split('|')[0].trim() || title}\n\n🏷️ Keywords: ${metaKeywords || 'None found'}\n📝 Description: ${metaDesc || ogDesc || 'None'}\n\n📊 Top keywords from content:\n${topKeywords}`,
    }
  },

  analyze_best_posting_time() {
    const posts: { text: string; timestamp: string; likes: number; comments: number }[] = []

    document.querySelectorAll('[role="article"], article, [data-pagelet^="FeedUnit"]').forEach((el) => {
      const text = (el as HTMLElement).textContent?.trim() || ''
      if (text.length < 20) return

      const timeEl = el.querySelector('time, [data-utime], abbr')
      const likeEl = el.querySelector('[aria-label*="Like"i], a[href*="reactions"]')
      const commentEl = el.querySelector('[aria-label*="Comment"i]')

      let timestamp = ''
      if (timeEl) {
        timestamp = timeEl.getAttribute('datetime') || timeEl.getAttribute('data-utime') || timeEl.textContent?.trim() || ''
      }

      const likes = parseInt((likeEl?.textContent?.trim() || '0').replace(/[^0-9]/g, '')) || 0
      const comments = parseInt((commentEl?.textContent?.trim() || '0').replace(/[^0-9]/g, '')) || 0

      posts.push({ text: text.slice(0, 100), timestamp, likes, comments })
    })

    if (posts.length === 0) return { success: false, error: 'No posts detected to analyze' }

    const hourEngagement: Record<number, { count: number; totalEng: number }> = {}
    for (const p of posts) {
      let hour = -1
      if (p.timestamp) {
        const d = new Date(p.timestamp)
        if (!isNaN(d.getTime())) hour = d.getHours()
      }
      if (hour >= 0) {
        if (!hourEngagement[hour]) hourEngagement[hour] = { count: 0, totalEng: 0 }
        hourEngagement[hour].count++
        hourEngagement[hour].totalEng += p.likes + p.comments
      }
    }

    const sortedHours = Object.entries(hourEngagement)
      .map(([h, d]) => ({ hour: parseInt(h), avgEng: d.totalEng / d.count, count: d.count }))
      .sort((a, b) => b.avgEng - a.avgEng)

    const bestTimes = sortedHours.slice(0, 3)
    const worstTimes = sortedHours.slice(-3).reverse()

    const timeStr = (h: number) => {
      const period = h >= 12 ? 'PM' : 'AM'
      const hour12 = h % 12 || 12
      return `${hour12}${period}`
    }

    let result = `📊 Post Timing Analysis — ${posts.length} posts analyzed\n\n`

    if (bestTimes.length > 0) {
      result += `✅ Best times to post:\n`
      bestTimes.forEach(t => result += `   ${timeStr(t.hour)} — avg ${Math.round(t.avgEng)} engagements (${t.count} posts)\n`)
    }

    result += `\n📈 Engagement range per post: ${Math.min(...posts.filter(p => p.likes + p.comments > 0).map(p => p.likes + p.comments))} – ${Math.max(...posts.map(p => p.likes + p.comments))}\n`
    result += `📝 Total posts found: ${posts.length}`

    return { success: true, result }
  },

  extract_single_post(args) {
    const index = parseInt(args[0]) || 1
    const posts = document.querySelectorAll('[role="article"], article, [data-pagelet^="FeedUnit"]')

    if (posts.length === 0) return { success: false, error: 'No posts found' }

    const idx = Math.min(index - 1, posts.length - 1)
    const post = posts[idx] as HTMLElement

    const text = post.textContent?.trim() || ''
    const images: string[] = []
    post.querySelectorAll('img[src]').forEach((img) => {
      const src = (img as HTMLImageElement).src
      if (src.startsWith('http') && !src.includes('emoji')) images.push(src)
    })
    const author = post.querySelector('[data-hovercard] a, a[href*="/user/"], a[href*="/profile.php"], strong')?.textContent?.trim() || 'Unknown'

    return {
      success: true,
      result: `📄 Post #${idx + 1} by ${author}\n\n${text.slice(0, 1000)}${text.length > 1000 ? '...' : ''}${images.length > 0 ? `\n\n🖼️ ${images.length} image(s) in post` : ''}`,
    }
  },

  // ── Advanced Capabilities ──

  dismiss_dialog() {
    markPageDirty()
    const dismissButtons = document.querySelectorAll<HTMLElement>(
      '[aria-label="Close"], [aria-label="Dismiss"], [aria-label="Accept"], [aria-label="Got it"], .close-button, .modal-close, [data-dismiss], .cookie-accept, .accept-cookies, .cc-btn, button:has-text("Accept"), button:has-text("Got it"), button:has-text("Close"), button:has-text("Dismiss")'
    )
    let dismissed = 0
    dismissButtons.forEach(el => { el.click(); dismissed++ })
    // Also try clicking overlays
    if (dismissed === 0) {
      const overlay = document.querySelector<HTMLElement>('[role="dialog"] [aria-label="Close"], dialog .close, .modal-header .close')
      if (overlay) { overlay.click(); dismissed++ }
    }
    return { success: true, result: dismissed > 0 ? `Dismissed ${dismissed} dialog(s)` : 'No dialogs found to dismiss' }
  },

  switch_to_iframe(args) {
    markPageDirty()
    const query = args.join(' ').trim().toLowerCase()
    if (!query) return { success: false, error: 'Usage: switch_to_iframe: iframe src, id, or index number' }
    const frames = document.querySelectorAll('iframe')
    let target: HTMLIFrameElement | null = null
    if (/^\d+$/.test(query)) {
      const idx = parseInt(query) - 1
      target = frames[idx] as HTMLIFrameElement || null
    } else {
      for (const f of frames) {
        const frame = f as HTMLIFrameElement
        if (frame.src?.toLowerCase().includes(query) || frame.id?.toLowerCase().includes(query) || frame.name?.toLowerCase().includes(query)) {
          target = frame
          break
        }
      }
    }
    if (!target) {
      const available = Array.from(frames).map((f, i) => `${i + 1}: ${(f as HTMLIFrameElement).src?.slice(0, 60) || 'about:blank'}`).join('\n')
      return { success: false, error: `Iframe not found. Available:\n${available || 'none'}` }
    }
    // Scroll to iframe and flash it
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flashElement(target)
    return { success: true, result: `Switched to iframe: ${target.src?.slice(0, 60) || target.id || 'unnamed'}` }
  },

  get_structured_data(args) {
    const type = (args[0] || '').toLowerCase()
    if (type === 'tables' || !type) {
      const tables = document.querySelectorAll('table')
      const tableData = Array.from(tables).slice(0, 3).map((t, i) => {
        const rows = Array.from(t.querySelectorAll('tr')).slice(0, 8)
        const headers = rows[0] ? Array.from(rows[0].querySelectorAll('th, td')).map(c => c.textContent?.trim() || '') : []
        const data = rows.slice(1).map(r => Array.from(r.querySelectorAll('td, th')).map(c => c.textContent?.trim() || ''))
        return { table: i + 1, headers, rows: data.length, preview: data.slice(0, 3) }
      })
      return { success: true, result: JSON.stringify(tableData.length > 0 ? tableData : 'No tables found') }
    }
    if (type === 'lists') {
      const lists = document.querySelectorAll('ul, ol')
      const items = Array.from(lists).slice(0, 5).map(l => {
        const children = Array.from(l.querySelectorAll('li')).slice(0, 10).map(li => li.textContent?.trim() || '')
        return { type: l.tagName.toLowerCase(), items: children }
      })
      return { success: true, result: JSON.stringify(items) }
    }
    if (type === 'json' || type === 'ld+json') {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]')
      const data = Array.from(scripts).map(s => { try { return JSON.parse(s.textContent || '{}') } catch { return null } }).filter(Boolean)
      return { success: true, result: data.length > 0 ? JSON.stringify(data[0]).slice(0, 2000) : 'No structured data found' }
    }
    return { success: false, error: 'Usage: get_structured_data: tables | lists | json' }
  },

  extract_contacts() {
    const text = document.body.innerText
    const emails = new Set<string>()
    const phones = new Set<string>()
    // Emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    let m
    while ((m = emailRegex.exec(text)) !== null) emails.add(m[0])
    // Phones (various formats)
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g
    while ((m = phoneRegex.exec(text)) !== null) {
      const p = m[0].trim()
      if (p.length >= 8 && p.length <= 20) phones.add(p)
    }
    // Social links
    const socials: string[] = []
    document.querySelectorAll('a[href*="linkedin.com"], a[href*="twitter.com"], a[href*="github.com"], a[href*="facebook.com"]').forEach(a => {
      socials.push(`${(a as HTMLAnchorElement).href}`)
    })
    const result = []
    if (emails.size > 0) result.push(`📧 Emails (${emails.size}): ${Array.from(emails).slice(0, 10).join(', ')}`)
    if (phones.size > 0) result.push(`📞 Phones (${phones.size}): ${Array.from(phones).slice(0, 10).join(', ')}`)
    if (socials.length > 0) result.push(`🔗 Social: ${socials.slice(0, 5).join('\n    ')}`)
    return {
      success: true,
      result: result.length > 0 ? result.join('\n') : 'No contacts found on this page',
    }
  },

  parse_search_results() {
    const url = window.location.href.toLowerCase()
    const results: { title: string; url: string; snippet: string }[] = []

    // Google
    if (url.includes('google.com/search')) {
      document.querySelectorAll('#search .g, #rso .g, [data-hveid]').forEach((el) => {
        const a = el.querySelector('a[href^="http"]')
        const title = a?.querySelector('h3')?.textContent?.trim() || a?.getAttribute('aria-label') || ''
        const href = (a as HTMLAnchorElement)?.href || ''
        const snippet = el.querySelector('.VwiC3b, .lEBKkf, [data-sncf], span.aCOpRe')?.textContent?.trim() || ''
        if (title && href) results.push({ title: title.slice(0, 100), url: href.slice(0, 150), snippet: snippet.slice(0, 200) })
      })
    }
    // DuckDuckGo
    if (url.includes('duckduckgo.com')) {
      document.querySelectorAll('article[data-testid="result"], .result, .results--main article').forEach((el) => {
        const a = el.querySelector('a[href^="http"]')
        const title = a?.textContent?.trim() || el.querySelector('h2')?.textContent?.trim() || ''
        const href = (a as HTMLAnchorElement)?.href || ''
        const snippet = el.querySelector('.snippet, .result__snippet')?.textContent?.trim() || ''
        if (title && href) results.push({ title: title.slice(0, 100), url: href.slice(0, 150), snippet: snippet.slice(0, 200) })
      })
    }
    // Bing
    if (url.includes('bing.com/search')) {
      document.querySelectorAll('#b_results > li, .b_algo').forEach((el) => {
        const a = el.querySelector('a[href^="http"]')
        const title = a?.textContent?.trim() || el.querySelector('h2')?.textContent?.trim() || ''
        const href = (a as HTMLAnchorElement)?.href || ''
        const snippet = el.querySelector('.b_caption p, .b_lineclamp2')?.textContent?.trim() || ''
        if (title && href) results.push({ title: title.slice(0, 100), url: href.slice(0, 150), snippet: snippet.slice(0, 200) })
      })
    }

    if (results.length === 0) {
      // Fallback: try generic result extraction
      document.querySelectorAll('a[href^="http"]').forEach((a) => {
        const title = a.textContent?.trim()
        const href = (a as HTMLAnchorElement).href
        if (title && title.length > 5 && !href.includes('google.com') && !href.includes('bing.com')) {
          results.push({ title: title.slice(0, 100), url: href.slice(0, 150), snippet: '' })
        }
      })
    }

    const resultStr = results.slice(0, 10).map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || '(no preview)'}`
    ).join('\n\n')
    return {
      success: true,
      result: results.length > 0
        ? `📊 ${results.length} search results:\n\n${resultStr}`
        : 'No search results found on this page. Try extract first.',
    }
  },

  extract_article() {
    // Extract main article content using readability-like heuristics
    const article = document.querySelector('article, [role="main"], main, .post-content, .entry-content, .article-body, #content, .content')
    if (!article) return { success: false, error: 'No article content found on this page' }
    const title = document.querySelector('h1')?.textContent?.trim() || document.title
    const byline = document.querySelector('.author, .byline, [rel="author"]')?.textContent?.trim() || ''
    const text = article.textContent?.trim() || ''
    const paragraphs = Array.from(article.querySelectorAll('p, h2, h3, h4, li, blockquote'))
      .map(el => el.textContent?.trim())
      .filter(Boolean)
      .join('\n\n')
    const result = `# ${title}${byline ? `\n*By ${byline}*` : ''}\n\n${paragraphs || text.slice(0, 5000)}`
    return {
      success: true,
      result: result.slice(0, 8000) + (result.length > 8000 ? '\n\n...(truncated)' : ''),
    }
  },

  // ── Human-like Browser Interaction Tools ──

  select_option(args) {
    markPageDirty()
    let selector = args[0] || ''
    const optionText = args.slice(1).join(' ').trim()
    if (!selector || !optionText) return { success: false, error: 'Usage: select_option: select_selector | option_text_or_value' }

    // Find select element using same fallback chain as fill_input
    const trySelectors = (sel: string): HTMLElement | null => querySelectorDeep(sel) as HTMLElement | null
    let el = trySelectors(selector)
    if (!el) {
      const fallbacks = [selector, `[name="${selector}"]`, `[aria-label="${selector}"]`, 'select']
      for (const fb of fallbacks) { el = trySelectors(fb); if (el) break }
    }
    if (!el || el.tagName.toLowerCase() !== 'select') return { success: false, error: `Select element not found: ${selector}` }

    const select = el as HTMLSelectElement
    const options = Array.from(select.options)
    const match = options.find(o =>
      o.text.toLowerCase() === optionText.toLowerCase() ||
      o.value.toLowerCase() === optionText.toLowerCase() ||
      o.text.toLowerCase().includes(optionText.toLowerCase())
    )
    if (!match) {
      const available = options.map(o => `"${o.text}" (value: ${o.value})`).join(', ')
      return { success: false, error: `Option "${optionText}" not found. Available: ${available}` }
    }
    select.value = match.value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flashElement(select)
    return { success: true, result: `Selected "${match.text}" in dropdown` }
  },

  toggle_checkbox(args) {
    markPageDirty()
    let selector = args[0] || ''
    if (!selector) return { success: false, error: 'Usage: toggle_checkbox: selector' }
    const trySelectors = (sel: string): HTMLElement | null => querySelectorDeep(sel) as HTMLElement | null
    let el = trySelectors(selector)
    if (!el) {
      const fallbacks = [selector, `[name="${selector}"]`, `[aria-label="${selector}"]`, 'input[type="checkbox"]', 'input[type="radio"]', '[role="checkbox"]', '[role="radio"]']
      for (const fb of fallbacks) { el = trySelectors(fb); if (el) break }
    }
    if (!el) return { success: false, error: `Checkbox/radio not found: ${selector}` }
    const tag = el.tagName.toLowerCase()
    const type = el.getAttribute('type')
    const role = el.getAttribute('role')
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      (el as HTMLInputElement).checked = !(el as HTMLInputElement).checked
      el.dispatchEvent(new Event('change', { bubbles: true }))
    } else if (role === 'checkbox' || role === 'radio') {
      el.click()
    } else {
      el.click()
    }
    flashElement(el)
    const nowChecked = tag === 'input' ? (el as HTMLInputElement).checked : true
    return { success: true, result: `Toggled ${selector} (now: ${nowChecked ? 'checked' : 'unchecked'})` }
  },

  upload_file(args) {
    markPageDirty()
    let selector = args[0] || ''
    const filePath = args.slice(1).join(' ').trim()
    if (!selector || !filePath) return { success: false, error: 'Usage: upload_file: file_input_selector | file_path' }
    const trySelectors = (sel: string): HTMLElement | null => querySelectorDeep(sel) as HTMLElement | null
    let el = trySelectors(selector)
    if (!el) {
      const fallbacks = [selector, `[name="${selector}"]`, `[aria-label="${selector}"]`, 'input[type="file"]']
      for (const fb of fallbacks) { el = trySelectors(fb); if (el) break }
    }
    if (!el || el.tagName.toLowerCase() !== 'input' || (el as HTMLInputElement).type !== 'file') {
      return { success: false, error: `File input not found: ${selector}` }
    }
    const input = el as HTMLInputElement
    // Create a File object from the path (just store path info — browser security restricts programmatic file setting)
    try {
      const dt = new DataTransfer()
      const file = new File([''], filePath.split('/').pop()?.split('\\').pop() || filePath, { type: 'application/octet-stream' })
      dt.items.add(file)
      input.files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      flashElement(input)
      return { success: true, result: `File selected: ${filePath}` }
    } catch {
      return { success: false, error: `Cannot set file programmatically. Use click to open file dialog.` }
    }
  },

  press_key(args) {
    markPageDirty()
    const key = (args[0] || '').trim().toLowerCase()
    const selector = args.slice(1).join(' ').trim()
    if (!key) return { success: false, error: 'Usage: press_key: key_name [selector]. Keys: enter, escape, tab, up, down, left, right, space, backspace, delete, home, end, pageup, pagedown' }

    const targetEl: HTMLElement = selector ? (querySelectorDeep(selector) as HTMLElement) || document.body : document.body
    targetEl.focus()

    const keyMap: Record<string, { key: string; code: string }> = {
      'enter': { key: 'Enter', code: 'Enter' },
      'escape': { key: 'Escape', code: 'Escape' },
      'esc': { key: 'Escape', code: 'Escape' },
      'tab': { key: 'Tab', code: 'Tab' },
      'up': { key: 'ArrowUp', code: 'ArrowUp' },
      'down': { key: 'ArrowDown', code: 'ArrowDown' },
      'left': { key: 'ArrowLeft', code: 'ArrowLeft' },
      'right': { key: 'ArrowRight', code: 'ArrowRight' },
      'space': { key: ' ', code: 'Space' },
      'backspace': { key: 'Backspace', code: 'Backspace' },
      'delete': { key: 'Delete', code: 'Delete' },
      'home': { key: 'Home', code: 'Home' },
      'end': { key: 'End', code: 'End' },
      'pageup': { key: 'PageUp', code: 'PageUp' },
      'pagedown': { key: 'PageDown', code: 'PageDown' },
    }
    const mapped = keyMap[key]
    if (!mapped) return { success: false, error: `Unknown key: "${key}". Use: ${Object.keys(keyMap).join(', ')}` }

    targetEl.dispatchEvent(new KeyboardEvent('keydown', { key: mapped.key, code: mapped.code, bubbles: true, cancelable: true }))
    targetEl.dispatchEvent(new KeyboardEvent('keypress', { key: mapped.key, code: mapped.code, bubbles: true, cancelable: true }))
    targetEl.dispatchEvent(new KeyboardEvent('keyup', { key: mapped.key, code: mapped.code, bubbles: true, cancelable: true }))
    flashElement(targetEl)
    return { success: true, result: `Pressed ${mapped.key}${selector ? ` on ${selector}` : ''}` }
  },

  copy_to_clipboard(args) {
    const text = args.join(' ')
    if (!text) {
      // Copy selected text
      const selected = window.getSelection()?.toString()
      if (selected) {
        navigator.clipboard.writeText(selected)
        return { success: true, result: `Copied selected text (${selected.length} chars)` }
      }
      return { success: false, error: 'Usage: copy_to_clipboard: text_to_copy (or select text on page first)' }
    }
    navigator.clipboard.writeText(text)
    return { success: true, result: `Copied "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" to clipboard` }
  },

  find_in_page(args) {
    const query = args.join(' ')
    if (!query) return { success: false, error: 'Usage: find_in_page: search_text' }
    const matches = document.body.innerText.match(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))
    const count = matches?.length || 0
    // Highlight matches
    if (count > 0) {
      const range = document.createRange()
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false)
      let node: Text | null
      let found = false
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent?.toLowerCase().includes(query.toLowerCase())) {
          range.selectNodeContents(node)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          flashElement(node.parentElement as HTMLElement)
          found = true
          break
        }
      }
    }
    return { success: true, result: `Found ${count} match(es) for "${query}"` }
  },

  set_zoom(args) {
    const level = parseFloat(args[0])
    if (isNaN(level) || level < 0.1 || level > 5) return { success: false, error: 'Usage: set_zoom: level (0.1-5.0, e.g. 1.5 for 150%)' }
    document.body.style.zoom = String(level)
    return { success: true, result: `Zoom set to ${Math.round(level * 100)}%` }
  },

  // Full page scan for style analysis
  async full_page_scan() {
    const allPosts: string[] = []
    const allHashtags: Record<string, number> = {}
    const postLengths: number[] = []
    let totalEngagements = 0
    let postCount = 0

    // Scroll 5 times to load content
    for (let s = 0; s < 5; s++) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
      await new Promise(r => setTimeout(r, 2000))

      // Extract posts after each scroll
      const posts = document.querySelectorAll('[role="article"], article, [data-pagelet^="FeedUnit"]')
      posts.forEach((el) => {
        const text = (el as HTMLElement).textContent?.trim() || ''
        if (text.length < 20) return
        const key = text.slice(0, 80)
        if (allPosts.some(p => p.includes(key))) return

        allPosts.push(text.slice(0, 500))

        // Extract hashtags
        const tagMatches = text.match(/#(\w+)/g)
        if (tagMatches) {
          tagMatches.forEach(t => {
            const lower = t.toLowerCase()
            allHashtags[lower] = (allHashtags[lower] || 0) + 1
          })
        }

        // Estimate engagement
        const likeText = el.querySelector('[aria-label*="Like"i]')?.textContent?.trim() || ''
        const commentText = el.querySelector('[aria-label*="Comment"i]')?.textContent?.trim() || ''
        const likes = parseInt(likeText.replace(/[^0-9]/g, '')) || 0
        const comments = parseInt(commentText.replace(/[^0-9]/g, '')) || 0
        totalEngagements += likes + comments
        postLengths.push(text.length)
        postCount++
      })
    }

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' })

    if (allPosts.length === 0) {
      return { success: false, error: 'No posts found to analyze. Make sure you are on a Facebook page with visible posts.' }
    }

    // Calculate average engagement
    const avgEngagement = postCount > 0 ? Math.round(totalEngagements / postCount) : 0
    const avgLength = postLengths.length > 0 ? Math.round(postLengths.reduce((a, b) => a + b, 0) / postLengths.length) : 0

    // Top hashtags
    const sortedTags = Object.entries(allHashtags).sort((a, b) => b[1] - a[1]).slice(0, 10)

    // Detect dominant tone based on content patterns
    const allText = allPosts.join(' ').toLowerCase()
    const exclamationCount = (allText.match(/!/g) || []).length
    const questionCount = (allText.match(/\?/g) || []).length
    const emojiCount = (allText.match(/[\u{1F600}-\u{1F9FF}]/gu) || []).length
    const avgPostLength = Math.round(allText.length / allPosts.length)

    const tone = exclamationCount > postCount * 2 ? 'energetic/excited' :
                 questionCount > postCount ? 'conversational/engaging' :
                 emojiCount > postCount ? 'casual/emotive' :
                 avgPostLength > 300 ? 'detailed/informative' :
                 'concise/direct'

    const samplePosts = allPosts.slice(0, 8).map((p, i) => `[Post ${i + 1}]: ${p.slice(0, 250)}`).join('\n\n')

    const result = `📊 Full Page Content Analysis
━━━━━━━━━━━━━━━━━━━━━━━━
📝 Total posts analyzed: ${allPosts.length}
📏 Avg post length: ${avgLength} chars
🎭 Detected tone: ${tone}
❤️ Avg engagement/post: ${avgEngagement}
🏷️ Top hashtags: ${sortedTags.map(([t, c]) => `${t}(${c}x)`).join(', ') || 'None'}
📰 Sample posts (${Math.min(allPosts.length, 8)} of ${allPosts.length}):
${samplePosts}

📋 Notable patterns:
• ${exclamationCount > postCount ? 'Uses exclamation points frequently (high energy)' : 'Measured use of exclamation points (calm tone)'}
• ${questionCount > postCount * 0.5 ? 'Asks questions to drive engagement' : 'Mostly statement-based posts'}
• ${emojiCount > postCount * 2 ? 'Heavy emoji usage (casual/relatable style)' : 'Moderate emoji usage'}
• ${avgPostLength < 150 ? 'Short-form content (quick, scannable posts)' : avgPostLength < 300 ? 'Medium-form content (balanced posts)' : 'Long-form content (detailed posts)'}`

    return { success: true, result }
  },
}

// --- Execute ---

async function executeTool(toolName: string, args: string[]): Promise<ToolResult> {
  const fn = tools[toolName]
  if (!fn) return { success: false, error: `Unknown tool: ${toolName}. Available: ${Object.keys(tools).join(', ')}` }
  try { return await Promise.resolve(fn(args)) }
  catch (err) { return { success: false, error: `Tool ${toolName} failed: ${err}` } }
}

// --- Messaging ---

function listenForMessages() {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'EXTRACT_PAGE_DATA':
        sendResponse({ success: true, data: collectPageData() })
        break
      case 'SYNAPSE_PING':
        sendResponse({ success: true, active: true })
        break
      case 'TOOL_EXECUTE': {
        const { tool, args } = message.payload || {}
        executeTool(tool || '', args || []).then(sendResponse)
        return true
      }
    }
  })
}

// --- Public handshake (so websites can detect the extension) ---
// Any page can postMessage({ type: 'SYNAPSE_PROBE' }) and we reply with the
// installed version. This lets the public site show "Update" vs "Download".
function listenForPublicProbe() {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as any
    if (!data || data.type !== 'SYNAPSE_PROBE') return
    try {
      const manifest = chrome.runtime.getManifest()
      window.postMessage(
        { type: 'SYNAPSE_PROBE_RESPONSE', version: manifest.version, id: chrome.runtime.id },
        '*'
      )
    } catch {
      /* ignore */
    }
  })
}

// --- Init ---

function init() {
  injectFloatingButton()
  listenForMessages()
  listenForPublicProbe()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
