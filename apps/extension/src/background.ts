// --- Types ---

interface SynapseMessage {
  type:
    | 'OPEN_SIDEPANEL'
    | 'CLOSE_SIDEPANEL'
    | 'EXTRACT_PAGE_DATA'
    | 'ANALYZE_PAGE'
    | 'TOGGLE_SYNAPSE'
    | 'GET_AUTH_STATE'
    | 'PAGE_DATA_RESPONSE'
    | 'GET_PAGE_TYPE'
    | 'OPEN_ACTION_PANEL'
    | 'AI_CHAT'
    | 'AI_GENERATE'
    | 'TOOL_EXECUTE'
    | 'BROWSER_TOOL'
  payload?: any
}

// --- State ---

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'

// Secure server-side proxy (Supabase Edge Function) that holds the NVIDIA key.
// Injected at build time from .env (build.mjs replaces this placeholder). When
// set, the extension calls the proxy WITHOUT shipping any API key, so it can be
// distributed publicly. A per-device key (Settings) still overrides this and
// calls NVIDIA directly.
const SUPABASE_PROXY_URL = '__SUPABASE_PROXY_URL__'
// Injected at build time from .env (build.mjs replaces this placeholder). Empty
// at runtime means the extension was built without a key.
const NVIDIA_API_KEY = '__NVIDIA_API_KEY__'

// A per-device API key override stored in chrome.storage.local (set via the
// Settings tab). When present the extension talks to NVIDIA directly with it.
async function getUserApiKey(): Promise<string> {
  try {
    const r = await chrome.storage.local.get('synapse_api_key')
    return ((r && r.synapse_api_key) || '').trim()
  } catch { /* storage unavailable */ }
  return ''
}

// True when a secure Supabase proxy URL was baked in at build time.
function hasProxy(): boolean {
  return /^https?:\/\//.test(SUPABASE_PROXY_URL)
}

// Decide how to reach the model:
//  1. A per-device user key  -> call NVIDIA directly (Authorization header).
//  2. A baked-in proxy URL   -> call the proxy (no key shipped).
//  3. A baked-in NVIDIA key  -> call NVIDIA directly.
//  4. Nothing                -> not configured.
async function resolveEndpoint(): Promise<{ url: string; apiKey: string } | null> {
  const userKey = await getUserApiKey()
  if (userKey) return { url: NVIDIA_API_URL, apiKey: userKey }
  if (hasProxy()) return { url: SUPABASE_PROXY_URL, apiKey: '' }
  if (NVIDIA_API_KEY && !NVIDIA_API_KEY.startsWith('__')) {
    return { url: NVIDIA_API_URL, apiKey: NVIDIA_API_KEY }
  }
  return null
}

// --- Side Panel ---

function openSidePanel() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch((err) =>
        console.error('Failed to open side panel:', err)
      )
    }
  })
}

// --- NVIDIA AI ---

// Model failure cache — skip models that returned 503/network for 60s
const modelFailureCache = new Map<string, number>()
// Models that returned a permanent error (404/403/400) are skipped for the
// whole session — retrying a non-existent/unentitled model just wastes time.
const modelHardFail = new Set<string>()

function isModelAvailable(name: string): boolean {
  if (modelHardFail.has(name)) return false
  const blockedUntil = modelFailureCache.get(name)
  if (!blockedUntil) return true
  if (Date.now() > blockedUntil) { modelFailureCache.delete(name); return true }
  return false
}

function markModelFailed(name: string, status: number) {
  if (status === 429 || status === 503) {
    modelFailureCache.set(name, Date.now() + 60_000) // skip for 60s
    console.log(`[Speed] ${name} blocked for 60s (${status})`)
  } else if (status === 401) {
    // Auth problem — surface once; don't permanently skip (key may be fixed live).
    console.log(`[Auth] ${name} returned 401 — check NVIDIA_API_KEY`)
  } else if (status === 404 || status === 403 || status === 400) {
    modelHardFail.add(name)
    console.log(`[Speed] ${name} permanently skipped (${status})`)
  }
}

// --- Model rotation / fallback ---
// Retry a model up to this many times (on network/timeout/empty/parse failure)
// before force-switching to the next model in the pool. Models are tried in a
// fixed priority order (index 0 = primary), always preferring the highest-
// priority AVAILABLE model so a dead/slow one can never displace a good one.
const MODEL_RETRY_THRESHOLD = 2

// Rotate through the model pool. Each candidate is retried up to the threshold;
// on exhaustion we advance the cursor to the next available model. `validate`
// lets callers reject responses that fail completion criteria (e.g. unparsable
// actions), which also triggers a rotation instead of a silent retry.
async function routeModelCall(
  buildMessages: (model: SynapseModel) => any[],
  opts: { pool?: (m: SynapseModel) => boolean; timeoutMs?: number; stream?: boolean; maxTokens?: number; validate?: (c: string) => boolean } = {}
): Promise<{ success: boolean; content?: string; error?: string }> {
  const filter = opts.pool ?? (() => true)
  // Fixed priority order (index 0 = primary/proven model). We always try the
  // highest-priority AVAILABLE model first, so a dead/slow downstream model can
  // never displace the good one. Models temporarily marked failed (503/timeout)
  // are simply skipped until their cooldown clears — no cursor wandering.
  const pool = MODELS.map((_, i) => i).filter(i => filter(MODELS[i]))
  let lastError = ''
  const maxIters = pool.length * (MODEL_RETRY_THRESHOLD + 1)
  for (let guard = 0; guard < maxIters; guard++) {
    const idx = pool.find(i => isModelAvailable(MODELS[i].name))
    if (idx === undefined) {
      // Every candidate in the pool is either temporarily failed OR permanently
      // hard-failed (404/403). If all are permanently unavailable there is
      // nothing left to try — bail out with a clear message instead of looping.
      if (pool.every(i => modelHardFail.has(MODELS[i].name))) {
        return { success: false, error: lastError || 'All AI models are unavailable (check NVIDIA API key / model entitlement)' }
      }
      // Every candidate is temporarily failed — pause, flush the cooldowns, retry.
      await new Promise(r => setTimeout(r, 3000))
      modelFailureCache.clear()
      continue
    }
    const model = MODELS[idx]
    let ok = false
    let content = ''
    let err = ''
    let usedModel = ''
    for (let attempt = 0; attempt < MODEL_RETRY_THRESHOLD && !ok; attempt++) {
      const res = await nvidiaChat(model, buildMessages(model), opts)
      if (res.success && res.content && (!opts.validate || opts.validate(res.content))) {
        ok = true
        content = res.content
        usedModel = model.name
      } else {
        err = res.error || `${model.name}: empty/invalid response`
        if (!isModelAvailable(model.name)) break // rate-limited/timeout → skip this one
      }
    }
    if (ok) return { success: true, content, model: usedModel }
    lastError = err
  }
  // If the dominant failure is a network error (no model ever returned an HTTP
  // response), report a clear connectivity error instead of "all models failed".
  const low = (lastError || '').toLowerCase()
  if (low.includes('failed to fetch') || low.includes('network') || low.includes('unreachable')) {
    return { success: false, error: 'Network error: could not reach the NVIDIA API. Check your internet connection and API key.' }
  }
  return { success: false, error: lastError || 'All AI models failed' }
}

// Model configs for parallel racing. The NVIDIA NIM endpoint
// (https://integrate.api.nvidia.com/v1) is OpenAI-compatible. `thinking` models
// send `chat_template_kwargs.enable_thinking` + `reasoning_budget` and stream
// `reasoning_content` deltas alongside `content`. `vision` marks multimodal
// models used by the vision path.
interface SynapseModel {
  name: string
  maxTokens: number
  temperature: number
  topP: number
  thinking?: boolean
  reasoningBudget?: number
  vision?: boolean
  stream?: boolean
  extraParams?: Record<string, any>
}

const MODELS: SynapseModel[] = [
  // --- Primary tier: small/mid models reliably available on the NVIDIA NIM
  // free/public tier. Tried first so the agent works even when the huge MoE
  // models are unentitled or down. 8B is confirmed working (used by the web app).
  { name: 'meta/llama-3.1-8b-instruct',            maxTokens: 8192, temperature: 0.7, topP: 0.95 },
  { name: 'meta/llama-3.3-70b-instruct',          maxTokens: 8192, temperature: 0.7, topP: 0.95 },
  // Vision-capable NIM models (used by the vision path). Smaller + more likely
  // entitled than the giant MoE vision models.
  { name: 'meta/llama-3.2-11b-vision-instruct',   maxTokens: 8192, temperature: 0.7, topP: 0.95, vision: true },
  { name: 'meta/llama-3.2-90b-vision-instruct',   maxTokens: 8192, temperature: 0.7, topP: 0.95, vision: true },
  // --- Last-resort fallbacks: huge MoE models. These require special
  // entitlement on NVIDIA NIM and are slow; only reached if everything above
  // fails. A 404/403 marks them permanently skipped for the session.
  { name: 'nvidia/nemotron-3-ultra-550b-a55b', maxTokens: 8192, temperature: 1.0, topP: 0.95, thinking: true, reasoningBudget: 4096 },
  { name: 'z-ai/glm-5.2',                maxTokens: 8192, temperature: 1.0, topP: 1.0, vision: true, stream: true, extraParams: { seed: 42 } },
  { name: 'minimaxai/minimax-m3',          maxTokens: 8192, temperature: 1.0, topP: 0.95, vision: true, stream: false },
  { name: 'qwen/qwen3.5-397b-a17b', maxTokens: 8192, temperature: 0.6, topP: 0.95, vision: true, stream: false, extraParams: { top_k: 20, presence_penalty: 0, repetition_penalty: 1 } },
  { name: 'qwen/qwen3.5-122b-a10b',       maxTokens: 8192, temperature: 0.6, topP: 0.95, vision: true, stream: false },
]

async function nvidiaChat(
  model: SynapseModel,
  messages: any[],
  opts: { timeoutMs?: number; stream?: boolean; maxTokens?: number } = {}
): Promise<{ success: boolean; content?: string; error?: string }> {
  const endpoint = await resolveEndpoint()
  if (!endpoint) {
    return { success: false, error: 'AI service not configured — add your NVIDIA API key in Settings' }
  }
  if (!isModelAvailable(model.name)) {
    return { success: false, error: `${model.name}: skipped (rate-limited)` }
  }
  // Non-streaming requests hold the connection until the FULL completion is
  // ready — large MoE models (especially with vision input) can take minutes,
  // so default those to a long timeout instead of the short streaming one.
  const useStream = opts.stream ?? model.stream ?? true
  // Non-streaming requests hold the connection until the FULL completion is
  // ready — large MoE models (especially with vision input) can take minutes,
  // so default those to a long timeout instead of the short streaming one.
  const timeoutMs = opts.timeoutMs ?? (useStream ? 30_000 : 180_000)
  const maxTokens = opts.maxTokens ?? model.maxTokens
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const body: any = {
    model: model.name,
    messages,
    max_tokens: maxTokens,
    temperature: model.temperature,
    top_p: model.topP,
    stream: useStream,
  }
  if (model.thinking) {
    body.chat_template_kwargs = { enable_thinking: true }
    body.reasoning_budget = model.reasoningBudget ?? 4096
  }
  if (model.extraParams) Object.assign(body, model.extraParams)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      markModelFailed(model.name, res.status)
      const t = await res.text().catch(() => '')
      console.log(`Model ${model.name} ${res.status} — ${t.slice(0, 200)}`)
      return { success: false, error: `${model.name}: ${res.status}` }
    }
    if (!useStream || !res.body) {
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content?.trim() || ''
      return content ? { success: true, content } : { success: false, error: `${model.name}: empty response` }
    }
    // Streaming SSE — accumulate final content only (reasoning_content ignored).
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta
          if (delta?.content) content += delta.content
        } catch {
          // skip malformed / partial chunk
        }
      }
    }
    const finalContent = content.trim()
    return finalContent
      ? { success: true, content: finalContent }
      : { success: false, error: `${model.name}: empty response` }
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : String(err)
    const is503 = msg.includes('503') || msg.includes('ResourceExhausted') || msg.includes('Too Many Requests')
    const isAbort = msg.includes('abort') || msg.includes('AbortError') || msg.includes('DOMException') || msg.includes('without reason')
    const isNetwork = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network') || msg.includes('ECONN') || msg.includes('socket') || msg.includes('ERR_')
    // Treat an abort/timeout/network failure like a transient failure: skip this
    // model for 60s so the router stops re-hanging on a slow/stuck/unreachable
    // endpoint and moves on to a working one instead of retrying it repeatedly.
    if (is503 || isAbort || isNetwork) markModelFailed(model.name, 503)
    const tag = is503 ? 'rate-limited' : isAbort ? 'timeout' : isNetwork ? 'network error' : 'network error'
    const detail = isAbort ? `timed out after ${Math.round(timeoutMs / 1000)}s` : isNetwork ? 'network unreachable (Failed to fetch)' : msg.slice(0, 160)
    console.error(`Model ${model.name} ${tag}:`, detail)
    return { success: false, error: `${model.name}: ${detail}` }
  }
}

async function handleAIChat(messages: any[]): Promise<{ success: boolean; content?: string; error?: string }> {
  const systemPrompt = `You are Synapse, a browser automation agent built on a state-machine architecture. You do NOT control the browser directly — you output ONE structured action per turn, and the system executes it.

## Architecture
You run in an observe→plan→execute→verify loop:
1. The system observes the page and gives you a structured JSON state (inputs, buttons, links, URL)
2. You plan exactly ONE action based on that state
3. The system executes your action
4. The system verifies the result, then shows you the new state

You never call APIs directly. You never manipulate the DOM. You never write code. You only output actions.

## Your Action Vocabulary
Output EXACTLY ONE action per turn as a JSON object. Never output multiple actions.

{
  "type": "click | type | navigate | scroll | wait | extract | observe | done | search | back | forward | key | select | check | upload | save | copy | find | reload | print | zoom | dismiss | iframe | data | parse | read | summarize | translate | contacts | tabs | export | clean | design | login | create_account | download_image | gmail",
  "target": "visible element text or URL or placeholder",
  "value": "text to type or ms to wait"
}

### click
Use to click buttons, links, tabs, or any clickable element. Read the page state's buttons[] and links[] arrays. Set target to the exact visible text of the element (e.g. "New chat", "Sign in", "Send"). NEVER use CSS selectors.

### type
Use to fill text inputs, textareas, contenteditable fields, or search boxes. Read the page state's inputs[] array. Set target to the input's placeholder or label text. Set value to the full text to enter. Examples: target="Search..." value="hello world", target="Message ChatGPT" value="Write a poem".

### navigate
Use to navigate to a new URL. Set target to the domain or full URL (e.g. "github.com", "https://chatgpt.com"). The system adds https:// automatically.

### scroll
Use to scroll the page. Set target to "bottom", "top", or text of an element to scroll to.

### wait
Use to wait for page loading or streaming to finish. Set value to milliseconds (e.g. "3000").

### observe
Use to refresh the page state. Call this after navigation or when the page changes.

### extract
Use to get visible text content from the current page. Good for reading article content or search results.

### done
Use only when the full objective is complete. Never use this prematurely.

### design
Create a new Canva design. Set target to the design type (post, instagram, facebook, twitter, tiktok, youtube, pinterest, presentation, poster, flyer, logo, card, document, resume, social, banner, letterhead, ebook). Optionally set value to search for a template by keyword. Examples: target="instagram" value="quote", target="poster" value="cat meme". The system navigates to Canva and opens the appropriate template page.

## Canva Design Knowledge

## How to Read Page State
The system gives you a JSON object with the current page state:
{
  "url": "https://...",
  "title": "Page Title",
  "loading": false,
  "streaming": false,
  "inputs": [ { "type": "textarea", "placeholder": "Message ChatGPT", "enabled": true, "id": "...", "label": "..." } ],
  "buttons": [ { "text": "New chat", "enabled": true } ],
  "links": [ { "text": "About", "href": "https://..." } ],
  "headings": [ { "tag": "h1", "text": "..." } ]
}

Use inputs[] to find which fields exist and their placeholder/label text — use those as type targets.
Use buttons[] to find clickable elements and their visible text — use those as click targets.
Use loading/streaming flags — if true, wait before taking action.

## Behavior Rules
- NEVER ask the user what to do. Just decide and act.
- If an action fails, the system will retry and observe. Your next turn will have fresh page state.
- If you cannot find the right element, try observe first, then scroll, then try again.
- For modern web apps (ChatGPT, GitHub, etc.) inputs are often role="textbox" or contenteditable. The system handles this.
- After navigation, always let observe run first before planning the next action.
- If the page is streaming (streaming: true), wait until it finishes.
- If you see a "Continue generating" button, click it.
- Be persistent. If one approach fails, try another. Never give up after one failure.
- Use the page state JSON to pick targets — don't guess or invent element names.
- One action per turn. Never output multiple actions.

## Site-Specific Knowledge

### ChatGPT (chat.openai.com, chatgpt.com) — current 2026
- Composer: main input placeholder "Message ChatGPT" (role='textbox' / contenteditable) at the TOP of the conversation. Type there.
- Model picker: a dropdown at the TOP of the composer. Modes: Auto (flagship), Instant (fast), Thinking (deeper reasoning), Pro (research-grade). CLICK the picker to choose a mode — you cannot type a model name. Use "Thinking" for hard/creative/research tasks.
- Buttons: "Send", "Stop", "Regenerate", "Edit" (inline-edit a sent message), "Copy", "Share" → "Copy link", "New chat", "Explore" (GPT Store), "Projects", and per-message "Good/Bad response" feedback.
- NEVER click "New chat"/"New conversation", and NEVER navigate to start a fresh chat, while a chat is already open. A chat is "already open" if you are on a chat site, already sent messages, or a composer input is visible.
- When a chat is already open: locate the composer and TYPE the instruction directly. Do not restart. Only start a NEW chat if explicitly asked.
- File uploads: click the attach/paperclip in the composer (or use "Recent files"/Library); up to 512MB/file. Then reference the file in your message.
- Image generation: ChatGPT produces images when you ask — TYPE a detailed visual prompt; no special button.
- Canvas: it can open a collaboratve doc/code surface; ask it to "put the final version in Canvas".
- After typing, Enter is auto-pressed. If a "Continue generating" button appears (truncated answer), CLICK it.
- Long responses: Wait for streaming to finish before next action.
- To share: Click "Share" → "Copy link"; for files use Canvas/Download.

### GitHub
- Inputs: Search box with placeholder "Search or type project name", file editor with role='textbox'
- Buttons: "Commit", "Pull request", "Push", "Sign up", "Sign in", "Fork", "Star", "Watch"
- Navigation: "Code", "Issues", "Pull requests", "Actions", "Wiki", "Settings" tabs
- For commits: Stage changes (click checkboxes), type commit message, click "Commit changes"
- For issues: Click "New issue", fill title and description, submit
- PR workflow: Click "Compare & pull request", fill details, submit

### Gmail (mail.google.com)
- LAYOUT: list/thread SPA. Left sidebar: Compose, Inbox, Starred, Snooze, Sent, Drafts, and custom Labels. The email LIST is a scrollable table of rows (sender, subject, snippet, time). Clicking a row opens the THREAD (conversation view).
- COMPOSE: click the "Compose" button (div[role="button"][aria-label*="Compose"], also div[gh="cm"]). A pop-out window opens with: To field (input/textarea, aria-label contains "To"), Subject field (input, aria-label contains "Subject"), and Body (div[role="textbox"][aria-label*="Message Body"], contenteditable). Fill each, then click "Send" (div[role="button"][aria-label*="Send"] — do NOT press Enter in the To/Subject fields, only the body is a composer).
- REPLY / REPLY ALL / FORWARD: with a thread open, click the "Reply" / "Reply all" / "Forward" button (aria-label contains the word). A compose window opens prefilled with the original; type into the body and click Send.
- SEARCH: the search box has aria-label "Search mail" (recently a textarea). Click it, type the query, then press Enter (or click the Search button). Supports operators: from:, to:, subject:, after:, before:, has:attachment, label:, is:unread, is:starred, in:spam, in:trash. After results load, the list rows are the matches — click one to open it.
- READ: open a thread (click its row in the list). The conversation messages appear as listitems (div[role="listitem"]); the body text is readable. Read the sender, subject, and message body from the open thread.
- ORGANIZE: with a thread (or a row) selected, the top toolbar has Archive (aria-label contains "Archive"), Delete/Trash (aria-label contains "Delete" or "Trash"), and Snooze (aria-label contains "Snooze"). The "Labels" button (aria-label contains "Label") opens a menu to apply a label; the "More" menu (aria-label contains "More") has "Mark as read" / "Mark as unread".
- RULES: For SENDING, fill To → Subject → Body, then click Send (never rely on Enter in compose fields other than the body). For READING, open the thread first, then read its text. For SEARCH, use the search box + Enter. Stick to visible aria-labels — never guess element IDs.
- MANAGE AT SCALE via the dedicated "gmail" action (target one of: open, read, list, summarize, compose, reply, reply_all, forward, search, archive, label, move, mark_read, star, important, spam, draft, schedule, attachments, unsubscribe, trash, snooze, mark_all_read). Examples: gmail open (value = optional "from:boss@co.com is:unread" filter) reads mail; gmail list shows recent threads; gmail summarize gives an AI recap; gmail reply_all replies to all; gmail draft saves a draft; gmail schedule sends later; gmail move/label organizes; gmail star/important/spam flag or report; gmail attachments lists/downloads files; gmail unsubscribe opts out; gmail mark_all_read clears the inbox.

### YouTube
- Inputs: Search box (placeholder "Search"), comment box (contenteditable)
- Buttons: "Search", "Upload", "Subscribe", "Like", "Dislike", "Share", "Save"
- Navigation: "Home", "Shorts", "Subscriptions", "Library" sidebar items
- For comments: Find comment box, type, press Enter
- For search: Type query, press Enter, results load dynamically

### Twitter/X
- Inputs: Tweet box (contenteditable), search box (placeholder "Search Twitter")
- Buttons: "Tweet", "Reply", "Retweet", "Like", "Quote", "Share"
- Navigation: "Home", "Explore", "Notifications", "Messages", "Profile", "More"
- For tweeting: Find tweet box, type, click Tweet button
- For search: Type query in search box, press Enter

### Google Search
- Input: Search box with placeholder "Search Google or type a URL"
- Buttons: "Google Search", "I'm Feeling Lucky"
- Navigation: Click "Search" after typing query
- Results: Use parse action to extract structured results (titles, URLs, snippets)

### Canva
- Inputs: Template search box (placeholder "Search templates"), design text elements (contenteditable)
- Buttons: "Create a design", "Templates", "Elements", "Uploads", "Share", "Download"
- Design types: Instagram post, Facebook post, YouTube thumbnail, Presentation, Poster, Flyer, Logo, etc.
- Navigation: Click "Create a design" or use design action
- For templates: Search by keyword, click template thumbnail
- For editing: Click elements to select, type to edit text, drag to move
- Export: Click "Share" -> "Download", select format, click "Download"

### LinkedIn
- Inputs: "Search jobs", "Connect with people", message boxes
- Buttons: "Easy Apply", "Save job", "Apply", "Connect", "Message", "More"
- Navigation: "Jobs", "My Network", "Post", "Notifications", "Me"
- For messaging: Find message box, type, press Enter
- For applications: Click job, review details, click "Easy Apply"

### Facebook
- Inputs: "Write something...", search box, comment boxes
- Buttons: "Post", "Like", "Comment", "Share", "Save", "Follow"
- Navigation: "Home", "Watch", "Marketplace", "Groups", "Games", "Friends", "Profile"
- For posting: Find "Write something..." box, type, press Enter or click Post
- For comments: Find comment box below post, type, press Enter

### General Web Patterns
- Forms: Look for form elements with inputs, selects, textareas. Submit with click on submit button.
- Modals/Dialogs: Often have role='dialog' or appear as overlays. Use dismiss action to close.
- Loading states: If loading: true, wait before taking action.
- Pagination: Look for "Next", "Previous", page numbers, or "Load more" buttons.
- Infinite scroll: Scroll to bottom to load more content.
- Tables: Use data action with target "tables" to extract structured data.`

  // Rotate through the model pool with a per-model retry threshold. If a model
  // errors or returns an unparsable response, the next pool member is tried.
  // 120s gives larger fallback models room to stream; a 4k token cap keeps the
  // agent loop fast (it only needs a single action JSON).
  return routeModelCall(
    (model) => [{ role: 'system', content: systemPrompt }, ...messages],
    { timeoutMs: 120_000, maxTokens: 4096 }
  )
}

async function handleAIGenerate(prompt: string): Promise<{ success: boolean; content?: string; error?: string }> {
  const GEN_SYSTEM = 'You are a creative content partner. Generate engaging, well-formatted social media posts, emails, landing pages, or any written content the user requests. Adapt your tone and style to the platform and audience. Use emojis sparingly and naturally. Include exactly 3 relevant hashtags at the end for social posts — no more. Keep posts concise (under 150 words unless asked for longer). When a creator profile is provided, stay 100% true to their voice, audience, and content themes. When page context is provided, mirror the tone and style patterns found in those examples. Return ONLY the content — no explanations, no introductions.'
  return routeModelCall(
    () => [
      { role: 'system', content: GEN_SYSTEM },
      { role: 'user', content: prompt },
    ],
    { stream: false, timeoutMs: 180_000, maxTokens: 2048 }
  )
}

async function handleAIVision(imageBase64: string, prompt: string): Promise<{ success: boolean; content?: string; error?: string }> {
  return routeModelCall(
    () => [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        { type: 'text', text: prompt },
      ],
    }],
    // Only multimodal models; long timeout for big vision runs.
    { pool: (m) => m.vision, timeoutMs: 180_000 }
  )
}

// --- Forward to Content Script ---

function forwardToContentScript(type: string, sendResponse: (response: any) => void, payload?: any, retryCount = 0) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      sendResponse({ success: false, error: 'No active tab found' })
      return
    }
    chrome.tabs.sendMessage(tabs[0].id, { type, payload }, async (response) => {
      if (chrome.runtime.lastError) {
        if (retryCount === 0) {
          // Content script not injected — inject it programmatically
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              files: ['content.js'],
            })
          } catch (err) {
            sendResponse({ success: false, error: 'Synapse not active on this page. Try refreshing.' })
            return
          }
        }
        // Retry with exponential backoff (500ms, 1s, 2s, 4s — max 4 retries)
        if (retryCount < 4) {
          const delay = retryCount === 0 ? 800 : Math.min(1000 * Math.pow(2, retryCount - 1), 4000)
          setTimeout(() => {
            forwardToContentScript(type, sendResponse, payload, retryCount + 1)
          }, delay)
        } else {
          sendResponse({ success: false, error: 'Synapse content script not responding. Try refreshing the page.' })
        }
        return
      }
      sendResponse(response || { success: false, error: 'No response from page' })
    })
  })
}

// --- Browser Tools (handled directly in background) ---

function cleanArg(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '')
}

function normalizeUrl(raw: string): string {
  let u = cleanArg(raw)
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u
  if (u.startsWith('https://https://')) u = u.slice(8) // fix double protocol
  return u
}

function waitForTabLoad(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    const onUpdated = (id: number, info: any) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve() }, timeoutMs)
  })
}

const BROWSER_TOOLS: Record<string, (args: string[]) => Promise<{ success: boolean; result?: string; error?: string }>> = {

  async navigate_to(args) {
    let url = args[0]
    if (!url) return { success: false, error: 'Usage: navigate_to: url (e.g. youtube.com or https://youtube.com)' }
    url = normalizeUrl(url)
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }

      await chrome.tabs.update(tabs[0].id, { url })
      await waitForTabLoad(tabs[0].id)

      return { success: true, result: `Navigated to ${url}` }
    } catch { return { success: false, error: `Failed to navigate to ${url}` } }
  },

  async open_tab(args) {
    let url = args[0]
    if (!url) return { success: false, error: 'Usage: open_tab: url (e.g. youtube.com or https://youtube.com)' }
    url = normalizeUrl(url)
    try {
      const tab = await chrome.tabs.create({ url })
      await waitForTabLoad(tab.id)

      return { success: true, result: `Opened new tab: ${url} (tab ${tab.index + 1})` }
    } catch { return { success: false, error: `Failed to open ${url}` } }
  },

  async switch_tab(args) {
    const query = args.join(' ').toLowerCase()
    if (!query) return { success: false, error: 'Usage: switch_tab: tab title or URL part' }
    try {
      const tabs = await chrome.tabs.query({})
      const match = tabs.find(t => t.title?.toLowerCase().includes(query) || t.url?.toLowerCase().includes(query))
      if (match?.id) {
        await chrome.tabs.update(match.id, { active: true })
        await chrome.windows.update(match.windowId, { focused: true })
        return { success: true, result: `Switched to tab: "${match.title || match.url}"` }
      }
      return { success: false, error: `No tab found matching "${query}"` }
    } catch { return { success: false, error: 'Failed to switch tab' } }
  },

  async close_tab(args) {
    const query = args.join(' ').toLowerCase()
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabs[0]?.id) {
        // If query matches current tab title/url or no query given, close it
        if (!query || tabs[0].title?.toLowerCase().includes(query) || tabs[0].url?.toLowerCase().includes(query)) {
          await chrome.tabs.remove(tabs[0].id)
          return { success: true, result: 'Tab closed' }
        }
      }
      // Try to find and close a matching tab
      const allTabs = await chrome.tabs.query({})
      const match = allTabs.find(t => t.title?.toLowerCase().includes(query) || t.url?.toLowerCase().includes(query))
      if (match?.id) { await chrome.tabs.remove(match.id); return { success: true, result: `Closed tab: "${match.title}"` } }
      return { success: false, error: `No tab found matching "${query}"` }
    } catch { return { success: false, error: 'Failed to close tab' } }
  },

  async list_tabs() {
    try {
      const tabs = await chrome.tabs.query({})
      const list = tabs.map((t, i) => `#${i + 1}: ${t.title || '(no title)'} — ${t.url?.slice(0, 80) || '(no url)'}`).join('\n')
      return { success: true, result: `📑 ${tabs.length} open tab(s):\n${list}` }
    } catch { return { success: false, error: 'Failed to list tabs' } }
  },

  async download_url(args) {
    let url = args[0]
    const filename = args[1] || ''
    if (!url) return { success: false, error: 'Usage: download_url: url (e.g. example.com/file.pdf)' }
    url = normalizeUrl(url)
    try {
      const downloadId = await chrome.downloads.download({ url, filename: filename || undefined })
      return { success: true, result: `Download started (ID: ${downloadId}): ${url}` }
    } catch { return { success: false, error: `Failed to download from ${url}. URL may be restricted.` } }
  },

  async list_downloads() {
    try {
      const downloads = await chrome.downloads.search({ limit: 10, orderBy: ['-startTime'] })
      if (downloads.length === 0) return { success: true, result: 'No recent downloads' }
      const list = downloads.map((d, i) =>
        `#${i + 1}: ${d.filename?.split('\\').pop()?.split('/').pop() || 'unknown'} — ${(d.fileSize / 1024 / 1024).toFixed(1)}MB — ${d.state}`
      ).join('\n')
      return { success: true, result: `📥 Recent downloads:\n${list}` }
    } catch { return { success: false, error: 'Failed to list downloads' } }
  },

  async multi_step(args) {
    // Multi-step workflow — args arrive as pipe-split segments from parseToolCalls
    if (args.length === 0) return { success: false, error: 'Usage: multi_step: "step1 | step2 | step3" where each step is "tool: arg1 | arg2"' }
    // Each arg is a step like "navigate_to: https://site.com" or "fill_input: #search | text"
    // Steps are processed sequentially with delays
    const results: string[] = []
    for (const step of args) {
      const [toolName, ...stepArgs] = step.split(':').map(s => s.trim())
      if (!toolName) continue
      const fn = BROWSER_TOOLS[toolName] || BROWSER_TOOLS[toolName.toLowerCase()]
      if (!fn) { results.push(`❌ Unknown step: ${toolName}`); continue }
      const toolArgs = (stepArgs.join(':') || '').split('|').map(s => s.trim()).filter(Boolean)
      await new Promise(r => setTimeout(r, 1200))
      const res = await fn(toolArgs)
      results.push(res.success ? `✅ ${toolName}: ${res.result}` : `❌ ${toolName}: ${res.error}`)
    }
    return { success: true, result: results.join('\n') }
  },

  async capture_screenshot() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }
      const dataUrl = await chrome.tabs.captureVisibleTab(tabs[0].windowId, { format: 'png' })
      return { success: true, result: dataUrl }
    } catch (err) {
      return { success: false, error: `Screenshot failed: ${err}` }
    }
  },

  async go_back() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }
      await chrome.tabs.goBack(tabs[0].id)
      await waitForTabLoad(tabs[0].id)
      return { success: true, result: 'Navigated back' }
    } catch { return { success: false, error: 'Failed to go back' } }
  },

  async go_forward() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }
      await chrome.tabs.goForward(tabs[0].id)
      await waitForTabLoad(tabs[0].id)
      return { success: true, result: 'Navigated forward' }
    } catch { return { success: false, error: 'Failed to go forward' } }
  },

  async search_web(args) {
    const full = args.join(' ').trim()
    if (!full) return { success: false, error: 'Usage: search_web: query or "engine: query" (engine: google, bing, duckduckgo, wikipedia)' }

    let engine = 'google'
    let query = full
    const engineMatch = full.match(/^(google|bing|duckduckgo|wikipedia|wiki):\s*(.+)/i)
    if (engineMatch) {
      engine = engineMatch[1].toLowerCase()
      query = engineMatch[2]
    }

    const searchUrls: Record<string, string> = {
      google: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`,
      bing: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
      duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(query.replace(/\s+/g, '_'))}`,
      wiki: `https://en.wikipedia.org/wiki/${encodeURIComponent(query.replace(/\s+/g, '_'))}`,
    }

    const url = searchUrls[engine]
    if (!url) return { success: false, error: `Unknown search engine: ${engine}. Use: google, bing, duckduckgo, wikipedia` }

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }
      await chrome.tabs.update(tabs[0].id, { url })
      await waitForTabLoad(tabs[0].id)
      return { success: true, result: `Searched ${engine} for "${query}"` }
    } catch { return { success: false, error: 'Search failed' } }
  },

  async reload_page() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }
      await chrome.tabs.reload(tabs[0].id)
      await waitForTabLoad(tabs[0].id)
      return { success: true, result: 'Page reloaded' }
    } catch { return { success: false, error: 'Failed to reload page' } }
  },

  async print_page() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => { window.print() },
      })
      return { success: true, result: 'Print dialog opened' }
    } catch { return { success: false, error: 'Failed to open print dialog' } }
  },

  async export_results(args) {
    const content = args.join(' ').trim()
    if (!content) return { success: false, error: 'Usage: export_results: content to save' }
    try {
      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const downloadId = await chrome.downloads.download({
        url,
        filename: `synapse-export-${Date.now()}.txt`,
      })
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      return { success: true, result: `Exported to downloads (ID: ${downloadId})` }
    } catch (err) { return { success: false, error: `Export failed: ${err}` } }
  },

  async get_all_tabs() {
    try {
      const allTabs = await chrome.tabs.query({ currentWindow: true })
      const list = allTabs.map((t, i) =>
        `#${i + 1}: ${t.title || '(no title)'} — ${t.url?.slice(0, 80) || '(no url)'}${t.active ? ' [ACTIVE]' : ''}`
      ).join('\n')
      return { success: true, result: `📑 ${allTabs.length} tab(s):\n${list}` }
    } catch { return { success: false, error: 'Failed to list tabs' } }
  },

  async close_other_tabs() {
    try {
      const allTabs = await chrome.tabs.query({ currentWindow: true })
      const activeTab = allTabs.find(t => t.active)
      const toRemove = allTabs.filter(t => !t.active && t.id).map(t => t.id!)
      if (toRemove.length > 0) await chrome.tabs.remove(toRemove)
      return { success: true, result: `Closed ${toRemove.length} tab(s), keeping "${activeTab?.title || 'active'}"` }
    } catch { return { success: false, error: 'Failed to close tabs' } }
  },

  async design_canva(args) {
    const [designType, templateQuery] = args
    if (!designType) return { success: false, error: 'Usage: design_canva: design_type [template_query]' }

    const designTypes: Record<string, string> = {
      'post': 'https://www.canva.com/posts/',
      'instagram': 'https://www.canva.com/create/instagram-posts/',
      'facebook': 'https://www.canva.com/create/facebook-posts/',
      'twitter': 'https://www.canva.com/create/twitter-posts/',
      'tiktok': 'https://www.canva.com/create/tiktok-thumbnails/',
      'youtube': 'https://www.canva.com/create/youtube-thumbnails/',
      'pinterest': 'https://www.canva.com/create/pinterest/',
      'presentation': 'https://www.canva.com/create/presentations/',
      'poster': 'https://www.canva.com/create/posters/',
      'flyer': 'https://www.canva.com/create/flyers/',
      'logo': 'https://www.canva.com/create/logos/',
      'card': 'https://www.canva.com/create/cards/',
      'document': 'https://www.canva.com/create/documents/',
      'resume': 'https://www.canva.com/create/resumes/',
      'social': 'https://www.canva.com/create/social-media/',
      'banner': 'https://www.canva.com/create/banner/',
      'letterhead': 'https://www.canva.com/create/letterheads/',
      'ebook': 'https://www.canva.com/create/ebooks/',
    }

    const normalizedType = designType.toLowerCase()
    const baseUrl = designTypes[normalizedType] || designTypes['social']

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tabs[0]?.id) return { success: false, error: 'No active tab' }

      let url = baseUrl

      // If template query provided, search for templates
      if (templateQuery) {
        const searchUrl = `https://www.canva.com/design/${encodeURIComponent(templateQuery)}`
        url = searchUrl
      }

      await chrome.tabs.update(tabs[0].id, { url })
      await waitForTabLoad(tabs[0].id)

      return { success: true, result: `Opened Canva ${designType} design${templateQuery ? ` with template: ${templateQuery}` : ''}` }
    } catch (err) {
      return { success: false, error: `Failed to open Canva: ${err}` }
    }
  },
}

async function handleBrowserTool(tool: string, args: string[]): Promise<{ success: boolean; result?: string; error?: string }> {
  const fn = BROWSER_TOOLS[tool]
  if (!fn) return { success: false, error: `Unknown browser tool: ${tool}. Available: ${Object.keys(BROWSER_TOOLS).join(', ')}` }
  try { return await fn(args) }
  catch (err) { return { success: false, error: `Browser tool ${tool} failed: ${err}` } }
}

// --- Messaging ---

chrome.runtime.onMessage.addListener(
  (message: SynapseMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'OPEN_SIDEPANEL':
      case 'TOGGLE_SYNAPSE':
        openSidePanel()
        sendResponse({ success: true })
        break

      case 'EXTRACT_PAGE_DATA':
        forwardToContentScript('EXTRACT_PAGE_DATA', sendResponse)
        return true

      case 'AI_CHAT': {
        const messages = message.payload?.messages || []
        handleAIChat(messages).then(sendResponse)
        return true
      }

      case 'AI_GENERATE': {
        const prompt = message.payload?.prompt || ''
        handleAIGenerate(prompt).then(sendResponse)
        return true
      }

      case 'AI_VISION': {
        const { image, prompt } = message.payload || {}
        if (!image || !prompt) { sendResponse({ success: false, error: 'AI_VISION requires image and prompt' }); return }
        handleAIVision(image, prompt).then(sendResponse)
        return true
      }

      case 'PING_AI': {
        const { model } = message.payload || {}
        const m = MODELS.find(x => x.name === model) || MODELS[0]
        nvidiaChat(m, [{ role: 'user', content: 'ping' }], { timeoutMs: 20000, maxTokens: 1, stream: false })
          .then(r => sendResponse({ success: r.success, model: m.name, error: r.error }))
        return true
      }

      case 'TOOL_EXECUTE': {
        const { tool, args } = message.payload || {}
        // Check if it's a browser tool first
        if (tool && BROWSER_TOOLS[tool]) {
          handleBrowserTool(tool, args || []).then(sendResponse)
          return true
        }
        forwardToContentScript('TOOL_EXECUTE', sendResponse, message.payload)
        return true
      }

      case 'BROWSER_TOOL': {
        const { tool, args } = message.payload || {}
        handleBrowserTool(tool || '', args || []).then(sendResponse)
        return true
      }

      default:
        sendResponse({ success: false, error: 'Unknown message type' })
    }
  }
)

// --- Extension Lifecycle ---

chrome.runtime.onInstalled.addListener(() => {
  console.log('Synapse AI extension installed')
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  } catch (e) {
    console.error('Failed to set panel behavior:', e)
  }
})

chrome.runtime.onSuspend.addListener(() => {
  console.log('Synapse AI background service worker suspending')
})
