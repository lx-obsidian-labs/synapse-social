// --- Core Architecture Types ---

const AgentState = {
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  WAITING: 'WAITING',
  VERIFYING: 'VERIFYING',
  FAILED: 'FAILED',
  DONE: 'DONE',
}

// --- Agent State Machine ---

let agentState = AgentState.IDLE
let agentMission = null        // current Mission object
let agentContext = {           // minimal context for LLM
  url: '',
  title: '',
  objective: '',
  completedTasks: [],
  currentTask: null,
  lastError: null,
  isStreaming: false,
  useVision: false,            // set to true after first vision fallback
  steps: 0,
  chatTurns: 0,                // how many messages we've sent into the current chat
  maxSteps: 500,
  plan: [],                    // decomposed step checklist for the current objective
  planDone: [],                // indices of plan steps marked complete
}

let memoryCount = 0            // total learned entries (for HUD)
let agentPaused = false        // user toggled pause during a run
let agentStopRequested = false // user requested an immediate stop
let sessionCompanyBrief = null // real company/services details gathered this session (for tailored designs)
let awaitingCompanyBrief = false // true after we asked the user for company details and are waiting for their reply

function transition(newState) {
  const prev = agentState
  agentState = newState
  console.log(`[Agent] ${prev} → ${newState}`)
  renderHud()
  updateHudVisibility()
  updateRunControls()
}

// --- Agent HUD (visual "at work" indicator) ---
const HUD_STATES = {
  PLANNING:  { label: 'PLANNING' },
  EXECUTING: { label: 'EXECUTING' },
  WAITING:   { label: 'AWAITING' },
  VERIFYING: { label: 'VERIFYING' },
  DONE:      { label: 'COMPLETE' },
  FAILED:    { label: 'HALTED' },
  IDLE:      { label: 'STANDBY' },
}

function setHudAction(text) {
  const el = document.getElementById('hud-action')
  if (el) el.textContent = text
}

// --- Technical HUD telemetry ---
let hudModel = '—'
let hudLatency = 0
function setHudModel(m) { if (m) hudModel = m }
function setHudLatency(ms) { hudLatency = Math.max(0, Math.round(ms)) }

// Append a single timestamped line to the HUD telemetry log.
function pushHudLog(tag, msg, kind) {
  const box = document.getElementById('hud-log')
  if (!box) return
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false })
  const line = document.createElement('div')
  line.className = 'lg ' + (kind || 'info')
  line.innerHTML = `<span class="t">[${t}]</span> <span class="m">${tag} ${msg || ''}</span>`
  box.appendChild(line)
  while (box.children.length > 40) box.removeChild(box.firstChild)
  box.scrollTop = box.scrollHeight
}

function renderHud() {
  const hud = document.getElementById('agent-hud')
  if (!hud) return
  const cfg = HUD_STATES[agentState] || HUD_STATES.IDLE
  hud.className = 'agent-hud state-' + cfg.label.toLowerCase()
  const st = document.getElementById('hud-state'); if (st) st.textContent = cfg.label
  const obj = document.getElementById('hud-objective'); if (obj) obj.textContent = agentContext.objective || '—'
  const steps = document.getElementById('hud-steps'); if (steps) steps.textContent = `STEP ${agentContext.steps} / ${agentContext.maxSteps}`
  const fill = document.getElementById('hud-fill'); if (fill) fill.style.width = Math.min(100, (agentContext.steps / agentContext.maxSteps) * 100) + '%'
  const learn = document.getElementById('hud-learn'); if (learn) learn.textContent = `🧠 ${memoryCount} learned`
  const model = document.getElementById('hud-model'); if (model) model.textContent = hudModel
  const lat = document.getElementById('hud-latency'); if (lat) lat.textContent = hudLatency ? `${hudLatency} ms` : '— ms'
  const sig = document.getElementById('hud-signal')
  if (sig) sig.className = 'hud-signal ' + ([AgentState.PLANNING, AgentState.EXECUTING, AgentState.VERIFYING, AgentState.DONE].includes(agentState) ? 's-strong' : 's-weak')
}

function updateHudVisibility() {
  const hud = document.getElementById('agent-hud')
  if (!hud) return
  const working = [AgentState.PLANNING, AgentState.EXECUTING, AgentState.WAITING, AgentState.VERIFYING].includes(agentState)
  if (working) {
    clearTimeout(hud._hideT)
    hud.hidden = false
  } else if (agentState === AgentState.DONE || agentState === AgentState.FAILED) {
    clearTimeout(hud._hideT)
    hud._hideT = setTimeout(() => {
      if (agentState === AgentState.DONE || agentState === AgentState.FAILED) hud.hidden = true
    }, 1700)
    hud.hidden = false
  } else {
    hud.hidden = true
  }
}

// Show/hide the Pause + Stop controls — only while the agent is actively running.
function updateRunControls() {
  const working = [AgentState.PLANNING, AgentState.EXECUTING, AgentState.WAITING, AgentState.VERIFYING].includes(agentState)
  const pauseBtn = document.getElementById('agent-pause')
  const stopBtn = document.getElementById('agent-stop')
  if (pauseBtn) pauseBtn.hidden = !working
  if (stopBtn) stopBtn.hidden = !working
}

// --- Action ---
// The ONLY structure the LLM returns. One action per turn.
// parseAction(output) extracts a single Action from LLM response text.
// The Action Executor knows nothing about AI — it just takes an Action and runs it.

// --- Structured Observability (World Model) ---
// observePage() returns a clean JSON of what's on screen.
// The LLM never sees raw HTML.

// --- Recovery Rules ---
// Classify errors and apply solutions without LLM involvement.

// --- State ---

let chatHistory = []
let isGenerating = false
let lastToolCalls = []
let toolCallCounts = {}
const MAX_TOOL_RETRIES = 2
const MAX_CONSECUTIVE_SAME_TOOL = 2
const TOOL_TIMEOUT = 20000
const ACTION_HISTORY_SIZE = 8
let actionHistory = []
let failedActions = new Map()      // "type:target" → count of failures
let consecutiveFailures = 0         // resets on success
let lastStableUrl = ''             // last known-good page URL, used for rollback
const MAX_ACTION_RETRIES = 2       // corrective re-plans per step before giving up
// Actions that can legitimately change the URL — rollback only targets these
const NAV_ACTIONS = new Set(['click', 'type', 'key', 'search', 'navigate', 'select', 'check', 'upload', 'dismiss', 'design', 'forward', 'reload'])

// --- Pacing + site helpers (stop new-chat thrash, slow decisions) ---
const PLAN_DELAY_MS = 1200   // deliberate "thinking" pause before each decision
const EXEC_DELAY_MS = 350    // small beat before executing an action (visual pacing)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
function targetHost(t) {
  let u = (t || '').trim()
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
function isOnChatSite(url) {
  return /(chatgpt|openai\.com|claude\.ai|gemini|bard|copilot|bing\.com\/chat)/i.test(url || '')
}

function isFacebookUrl(url) {
  return /(facebook\.com|fb\.com|fb\.watch|m\.facebook)/i.test(url || '')
}

// Heuristic: is this objective about creating/posting social content (vs a
// pure research/automation task)? Used to keep the agent text-first and to
// engage Facebook-specific posting guards.
function isContentTask(obj) {
  return /facebook|instagram|tiktok|linkedin|twitter|x\.com|reddit|post|content|reel|carousel|caption|social media|brand post|engage|followers|hook|story/i.test(obj || '')
}

function isGmailUrl(url) {
  return /(mail\.google\.com|gmail\.com)/i.test(url || '')
}

// Heuristic: is the objective about reading/managing email (vs a social/other task)?
function isMailTask(obj) {
  return /gmail|email|e-?mail|inbox|mail|compose|reply|forward|sender|subject line|unread|archive|label|thread|message from|check my mail|read my mail/i.test(obj || '')
}

// Last observed page state, refreshed every loop iteration — used to detect an
// open chat composer even before the URL classifier has caught up.
let lastObservedState = null

// True if the page already exposes a chat composer input (so "new chat" is redundant).
function hasChatComposer(state) {
  const inputs = state?.inputs || []
  return inputs.some(i =>
    i.role === 'textbox' ||
    i.type === 'textbox' ||
    /message|prompt|ask|chat/i.test(i.placeholder || '') ||
    /message|prompt|ask|chat/i.test(i.label || '') ||
    /message|prompt|ask|chat/i.test(i.ariaLabel || '')
  )
}

// Centralized, programmatic validation of the current chat/compose state.
// A single source of truth so the click guard, the navigate guard, and the
// main loop all agree on whether a conversation is already open.
function detectChatContext(pageState, context) {
  const url = (pageState?.url || context?.url || '').toString()
  const onChatSite = isOnChatSite(url)
  const composerPresent = hasChatComposer(pageState)
  const promptSent = (context?.chatTurns || 0) > 0
  const chatOpen = onChatSite || composerPresent || promptSent
  return { url, onChatSite, composerPresent, promptSent, chatOpen }
}
const MAX_CONSECUTIVE_FAILURES = 3  // after 3, force strategy change

function detectLoop() {
  if (actionHistory.length < 3) return null
  const last3 = actionHistory.slice(-3)
  if (last3.every(a => a.type === last3[0].type && a.target === last3[0].target && a.value === last3[0].value)) {
    return { kind: 'same_action', action: last3[0], count: 3 }
  }
  if (actionHistory.length >= 4) {
    const last4 = actionHistory.slice(-4)
    if (last4[0].type === last4[2].type && last4[1].type === last4[3].type) {
      return { kind: 'oscillation', actions: [last4[0].type, last4[1].type] }
    }
  }
  return null
}

function recordAction(type, target, value, success, error) {
  const key = `${type}:${target}`
  actionHistory.push({ type, target, value, success, error })
  if (actionHistory.length > ACTION_HISTORY_SIZE) actionHistory.shift()
  if (!success) {
    failedActions.set(key, (failedActions.get(key) || 0) + 1)
    consecutiveFailures++
  } else {
    consecutiveFailures = 0
  }
}

// --- Mission State ---
let missionState = {
  failedPages: [],       // pages that were unreachable (URL + reason)
  failedTools: {},       // tool name → count of consecutive failures
  skippedDomains: [],    // domains to avoid retrying
  currentUrl: '',        // track current URL to detect navigation failures
}

// --- Job-Based Mission System ---
// Allows complex research tasks to be broken into jobs, processed one per session,
// with auto-resume. State persists in localStorage.

const MISSION_KEY = 'synapse_mission'

function saveMission(mission) {
  try { localStorage.setItem(MISSION_KEY, JSON.stringify(mission)) } catch {}
}

function loadMission() {
  try {
    const raw = localStorage.getItem(MISSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function clearMission() {
  try { localStorage.removeItem(MISSION_KEY) } catch {}
}

function createMission(goal, jobs) {
  const mission = {
    id: Date.now().toString(36),
    goal,
    jobs: jobs.map((j, i) => ({
      id: j.id || `job_${i}`,
      label: j.label || j.id,
      url: j.url || '',
      instructions: j.instructions || '',
      status: 'pending',
      data: null,
      error: null,
    })),
    currentJobIndex: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    complete: false,
  }
  saveMission(mission)
  return mission
}

function getCurrentJob(mission) {
  if (!mission || mission.complete) return null
  const job = mission.jobs[mission.currentJobIndex]
  if (!job || job.status === 'done' || job.status === 'skipped') return null
  return job
}

function advanceJob(mission, result, error) {
  const job = mission.jobs[mission.currentJobIndex]
  if (job) {
    job.status = error ? 'skipped' : 'done'
    job.data = result || null
    job.error = error || null
  }
  mission.currentJobIndex++
  mission.updatedAt = new Date().toISOString()
  if (mission.currentJobIndex >= mission.jobs.length) {
    mission.complete = true
  }
  saveMission(mission)
  return mission
}

function missionSummary(mission) {
  if (!mission) return null
  const done = mission.jobs.filter(j => j.status === 'done').length
  const skipped = mission.jobs.filter(j => j.status === 'skipped').length
  const total = mission.jobs.length
  return {
    goal: mission.goal,
    progress: `${done}/${total} (${Math.round(done/total*100)}%)`,
    done,
    skipped,
    total,
    current: mission.jobs[mission.currentJobIndex],
  }
}

function classifyToolError(tool, error) {
  const e = (error || '').toLowerCase()
  if (e.includes('synapse not active') || e.includes('content script not responding')) {
    return { type: 'FATAL_SCRIPT', recovery: 'REFRESH', explanation: 'Extension inactive on this page. Auto-refreshing...' }
  }
  if (e.includes('not found') || e.includes('no element') || e.includes('no clickable')) {
    return { type: 'NOT_FOUND', recovery: 'TEXT_FALLBACK', explanation: 'Element not found on page. Try get_visible_text to see the page structure, then use find_and_click with visible text instead of CSS selectors.' }
  }
  if (e.includes('timeout') || e.includes('timed out')) {
    return { type: 'TIMEOUT', recovery: 'WAIT', explanation: 'Operation timed out. The page may still be loading.' }
  }
  if (e.includes('navigation failed') || e.includes('net::err_') || e.includes('dns')) {
    return { type: 'NAV_FAIL', recovery: 'SKIP_DOMAIN', explanation: 'Cannot reach this domain. Skip it and continue with other sources.' }
  }
  return { type: 'UNKNOWN', recovery: 'ALTERNATIVE', explanation: 'Tool failed. Check page state and try a different approach.' }
}

async function autoRecover(tool, error, historyMessages, rawContent) {
  const cls = classifyToolError(tool, error)
  if (cls.type === 'FATAL_SCRIPT') {
    // Try refreshing the page
    addMessage('system', '🔄 Page not responding. Refreshing...')
    scrollToBottom()
    const refreshResult = await sendToBackground('BROWSER_TOOL', { tool: 'navigate_to', args: [missionState.currentUrl || 'about:blank'] }, TOOL_TIMEOUT)
    if (refreshResult.success) {
      missionState.failedPages.push(missionState.currentUrl)
      await new Promise(r => setTimeout(r, 2000))
      return { recovered: true, message: 'Page was refreshed. Extension should now be active. Retry the operation.' }
    }
    // If refresh fails, mark domain as unreachable
    try {
      const url = new URL(missionState.currentUrl || error)
      if (!missionState.skippedDomains.includes(url.hostname)) missionState.skippedDomains.push(url.hostname)
    } catch {}
    return { recovered: false, message: `Skipping ${missionState.currentUrl} — extension cannot activate on this domain. Continue with other websites.` }
  }
  return { recovered: false, message: null }
}

// ============================================================
// Agent Engine — replaces the ReAct loop with state-machine architecture
// ============================================================

// --- Action Planner: LLM returns exactly ONE Action per turn ---

function parseAction(text) {
  // Try JSON format: {"type":"click","target":"..."}
  const jsonMatch = text.match(/\{[\s\S]*?"type"\s*:\s*"(click|type|navigate|scroll|wait|extract|observe|done|search|back|forward|key|select|check|upload|save|copy|find|reload|print|zoom|dismiss|iframe|data|parse|read|summarize|translate|contacts|tabs|export|clean|design|create_account|download_image|gmail)"[\s\S]*?\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.type) return { type: parsed.type, target: parsed.target || '', value: parsed.value || '' }
    } catch {}
  }
  // Try simple format: ACTION: type | target | value
  const simpleMatch = text.match(/ACTION:\s*(click|type|navigate|scroll|wait|extract|observe|done|search|back|forward|key|select|check|upload|save|copy|find|reload|print|zoom|dismiss|iframe|data|parse|read|summarize|translate|contacts|tabs|export|clean|design|create_account|download_image|gmail)\s*(?:\|\s*(.*?))?(?:\|\s*(.*))?$/im)
  if (simpleMatch) {
    return { type: simpleMatch[1], target: (simpleMatch[2] || '').trim(), value: (simpleMatch[3] || '').trim() }
  }
  // Try tool call format (compatibility)
  const toolMatch = text.match(/\[TOOL:\s*(\w+)\s*:\s*(.*?)\]/i)
  if (toolMatch) {
    const tool = toolMatch[1].toLowerCase()
    const args = toolMatch[2].split('|').map(s => s.trim())
    const typeMap = { click_element: 'click', fill_input: 'type', simulate_typing: 'type', navigate_to: 'navigate', scroll_to_element: 'scroll', scroll_to_bottom: 'scroll', wait: 'wait', observe_page: 'observe', get_page_text: 'extract' }
    return { type: typeMap[tool] || 'extract', target: args[0] || '', value: args[1] || '' }
  }
  return null
}

// --- Self-learning memory (persists across usages in chrome.storage.local) ---
const MEMORY_KEY = 'synapse_memory_v1'
const MEMORY_MAX = 60

async function loadMemory() {
  try {
    const res = await chrome.storage.local.get(MEMORY_KEY)
    const m = res && res[MEMORY_KEY]
    return Array.isArray(m) ? m : []
  } catch { return [] }
}

async function saveMemory(list) {
  try { await chrome.storage.local.set({ [MEMORY_KEY]: list.slice(-MEMORY_MAX) }) } catch {}
}

async function appendMemory(entry) {
  const list = await loadMemory()
  // Replace an existing entry for the same objective+site instead of duplicating
  const key = (entry.objective || '').toLowerCase() + '|' + (entry.site || '')
  const idx = list.findIndex(e => ((e.objective || '').toLowerCase() + '|' + (e.site || '')) === key)
  if (idx >= 0) list[idx] = entry
  else list.push(entry)
  await saveMemory(list)
}

function memoryToText(list, objective, url) {
  if (!list || !list.length) return ''
  const urlHost = hostOf(url || '')
  const now = Date.now()
  const scored = list
    .map(e => {
      let score = 0
      if (urlHost && e.site && e.site.includes(urlHost)) score += 3
      const o = String(objective || '').toLowerCase()
      for (const w of o.split(/\s+/)) {
        if (w.length > 3 && (e.objective || '').toLowerCase().includes(w)) score += 1
      }
      if (e.outcome === 'success') score += 1
      if (e.ts && (now - e.ts) < 7 * 86400000) score += 1
      return { e, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
  if (!scored.length) return ''
  return scored.map(x => {
    const tag = x.e.outcome === 'success' ? '✅' : '⛔'
    let s = `- ${tag} ${x.e.lesson || x.e.objective || ''}`
    if (x.e.outcome === 'success' && x.e.actions) s += `  ↳ playbook: ${x.e.actions}`
    if (x.e.outcome === 'failed' && x.e.failed) s += `  ↳ avoid: ${x.e.failed}`
    return s
  }).join('\n')
}

async function recordLearning(objective, url, actionSummary, success, failedSummary) {
  try {
    const lessonPrompt = `You are a meta-learner for a browser automation agent. Given this completed task, write ONE concise, reusable lesson (max 2 sentences) about what worked or what to avoid for similar tasks. Be specific and actionable.\n\nTask: ${objective}\nSite: ${url}\nSteps taken: ${actionSummary}\nFailed attempts: ${failedSummary || 'none'}\nOutcome: ${success ? 'success' : 'failed'}\n\nLesson:`
    let lesson = ''
    try {
      const r = await sendToBackground('AI_CHAT', { messages: [{ role: 'user', content: lessonPrompt }] }, 30000)
      if (r && r.success && r.content) lesson = r.content.trim().replace(/\s+/g, ' ').slice(0, 280)
    } catch {}
    await appendMemory({
      objective: objective || '',
      site: hostOf(url || ''),
      outcome: success ? 'success' : 'failed',
      actions: actionSummary || '',
      failed: failedSummary || '',
      lesson,
      ts: Date.now(),
    })
  } catch {}
}

async function clearMemory() {
  if (!confirm('Clear all of Synapse’s learned memory? This cannot be undone.')) return
  try {
    await chrome.storage.local.remove(MEMORY_KEY)
    memoryCount = 0
    addMessage('system', '🧠 Memory cleared.')
    scrollToBottom()
    renderMemoryTab()
  } catch {}
}

// Render the learned-memory inspector (Memory tab)
async function renderMemoryTab() {
  const list = $('memory-list')
  const meta = $('memory-meta')
  if (!list) return
  const mem = await loadMemory()
  memoryCount = mem.length
  const hudLearn = $('hud-learn'); if (hudLearn) hudLearn.textContent = `🧠 ${memoryCount} learned`
  if (!mem.length) {
    if (meta) meta.textContent = 'No entries yet — run a task and Synapse will learn from it.'
    list.innerHTML = '<div class="mem-empty">🧠 No learned memory yet.<br>Complete a task and lessons will appear here.</div>'
    return
  }
  const ranked = mem
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  if (meta) meta.textContent = `${mem.length} entr${mem.length === 1 ? 'y' : 'ies'} learned · newest first`
  list.innerHTML = ranked.map(e => {
    const ok = e.outcome === 'success'
    const detail = ok && e.actions
      ? `<div class="mem-detail"><b>Playbook:</b> ${escapeHtml(e.actions)}</div>`
      : (!ok && e.failed ? `<div class="mem-detail"><b>Avoid:</b> ${escapeHtml(e.failed)}</div>` : '')
    const when = e.ts ? new Date(e.ts).toLocaleString() : ''
    return `<div class="mem-card ${ok ? 'success' : 'failed'}">
      <div class="mem-card-top">
        <div class="mem-objective">${escapeHtml(e.objective || '(untitled)')}</div>
        <span class="mem-badge ${ok ? 'success' : 'failed'}">${ok ? '✅ SUCCESS' : '⛔ FAILED'}</span>
      </div>
      <div class="mem-site">${escapeHtml(e.site || '—')}${when ? ' · ' + escapeHtml(when) : ''}</div>
      <div class="mem-lesson">${escapeHtml(e.lesson || (ok ? 'Worked as intended.' : 'Did not complete.'))}</div>
      ${detail}
    </div>`
  }).join('')
}

// Lean, accessibility-tree-style projection of page state for the LLM prompt.
// Drops verbose/redundant fields and caps arrays so we never ship the full DOM
// to the model — this cuts token overhead and lowers per-inference latency.
function compactPageState(s) {
  if (!s || typeof s !== 'object') return s
  const take = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : [])
  return {
    url: s.url || '',
    title: s.title || '',
    loading: !!s.loading,
    streaming: !!s.streaming,
    text: (s.textSummary || '').slice(0, 2800),
    inputs: take(s.inputs, 8).map(i => ({
      ph: i.placeholder || i.label || '',
      role: i.role || '',
      en: i.enabled !== false,
      name: i.name || '',
      tid: i.testId || '',
    })),
    buttons: take(s.buttons, 14).map(b => ({ t: b.text, role: b.role || '', en: b.enabled !== false })),
    links: take(s.links, 8).map(l => ({ t: l.text, h: l.href })),
    headings: take(s.headings, 6),
    selects: take(s.selects, 4),
    dialogs: take(s.dialogs, 2),
    ...(s.iframes && s.iframes.length ? { iframes: take(s.iframes, 2) } : {}),
    ...(typeof s.imgCount === 'number' ? { imgCount: s.imgCount } : {}),
  }
}

// Platform knowledge fed to the planner. The agent is a GENERAL browser
// agent — it must operate on any website (dashboards, admin panels, docs,
// shops), not only ChatGPT. This block teaches it the common flows.
const PLATFORM_GUIDE = `### Cloudflare (dash.cloudflare.com)
- Login: go to https://dash.cloudflare.com/login (email + password; may require a 6-digit email/authenticator code). After login you reach the account/home or zone list.
- Zones: click a domain/zone to open it. The left sidebar then shows: Overview, DNS, SSL/TLS, Speed, Caching, Web Analytics, Security (WAF, Bots), Rules, Network, Workers & Pages, Storage, Settings.
- DNS: click "DNS" -> "Records" to read DNS records (A, AAAA, CNAME, MX, TXT, NS). Orange cloud = proxied through Cloudflare (proxy ON); grey cloud = DNS-only (proxy OFF). Verify records here.
- SSL/TLS: "Overview" shows cert mode (Off / Flexible / Full / Full (strict)); "Edge Certificates" shows cert status.
- To check a site is "properly set up": verify DNS records point correctly, proxy status, SSL mode, and that the site loads (navigate to the domain to confirm).
- Deep links work: e.g. https://dash.cloudflare.com/<zone>/dns . Use "click" on exact sidebar text, and "observe"/"extract" to read tables/status.

### Generic dashboard / admin panel
- Login forms: fill EACH field (email, password) one at a time with "type", then CLICK the "Log in" / "Sign in" button (do not rely on auto-Enter for multi-field forms).
- Navigate by clicking exact sidebar/menu labels. Open a section, then read its state with "observe"/"extract"/"data".
- Verify a setting by reading the on-page indicator (toggle state, status text, table row) — not by assuming.

### GitHub (github.com)
- Search box (placeholder "Search or type project name"), file editor (role="textbox"). Buttons: "Commit", "Pull request", "Fork", "Star". Tabs: Code, Issues, Pull requests, Actions, Settings.

### Vercel / Netlify
- Vercel: dashboard.vercel.com — Projects list, then a project -> Deployments, Settings, Domains. Netlify: app.netlify.com — Sites -> site -> Domain settings / Build & deploy.

### General web
- Search engines: use "search" (google/bing/duckduckgo/wikipedia). After results, "parse" extracts structured links.
- Articles/docs: "read" gets clean content; "summarize" gives 3-5 bullets.
- Shops/forms: click exact button text; fill fields; submit via the button.

### Facebook (facebook.com) — posting as a Page/Profile
- Composer: on your Feed/Profile, click "What's on your mind?" (or "Create post"); a textbox opens. TYPE your caption there (auto-Enter is NOT forced for Facebook — click the "Post" button to publish, or send "key: enter").
- To switch into a Page (if managing one): click your profile avatar top-right -> "See all profiles" -> choose the Page, then use its composer.
- Reels: click "Reels" in the left menu -> "Create reel", then type the caption and publish.
- Stories: click your avatar with the "+" on the Stories row; add text, then "Share to story".
- Engagement: after posting, "observe" to confirm it published; reply to comments by clicking the comment box and typing.
- Do NOT use Facebook's automated "boost"/ad flow unless the user explicitly asks.
- When the task is content creation for LX Obsidian Labs, follow the LX Obsidian Labs Facebook Content Operating System in the 👤 User / Brand Context block — and remember TEXT/STATUS posts come FIRST, images/designs AFTER.

### Gmail (mail.google.com) — read & manage email
- Open/Read: the list is rows — click a row to open the thread. To find a specific email, click the "Search mail" box, type a query (from:boss@co.com, is:unread, subject:invoice…), press Enter, wait, then click the first matching row. Read the open thread's text.
- Compose/Send: click "Compose", fill To → Subject → Body, click "Send" (do not press Enter in To/Subject).
- Reply/Forward: open the thread, click "Reply"/"Forward", type in the body, click "Send".
- Organize: Archive / Delete / Snooze from the toolbar (aria-label contains the word); "Labels" applies a label; "More" → "Mark as read/unread". "Move to" relocates to a label/folder; "Star"/"Important" flag a thread; "Report spam" moves to Spam.
- Triage at scale: "list" shows recent threads, "summarize" gives an AI recap, "mark_all_read" clears the inbox, "unsubscribe" opts out of promo mail.
- Use the dedicated "gmail" action (target = open | read | list | summarize | compose | reply | reply_all | forward | search | archive | label | move | mark_read | star | important | spam | draft | schedule | attachments | unsubscribe | trash | snooze | mark_all_read) to drive these reliably — see the Gmail guide in the 👤 User / Brand Context block for exact examples.`

// --- ChatGPT FULL reference (current 2026 UI/features) ---
const CHATGPT_GUIDE = `### ChatGPT (chatgpt.com / chat.openai.com) — FULL REFERENCE
LAYOUT
- Composer: at the TOP of the conversation. Main input placeholder "Message ChatGPT" (role="textbox" / contenteditable). Type there.
- Sidebar (left): "New chat", "Explore" (GPT Store/discovery), "Projects", chat history, and a "Library" of uploaded files.
- Model picker: a dropdown at the TOP of the composer. Modes: Auto (flagship), Instant (fast), Thinking (deeper reasoning), Pro (research-grade). You CANNOT free-type a model name — CLICK the picker, then click the mode. Use "Thinking" for hard/creative tasks, "Instant" for quick ones.
- Each assistant message has: Regenerate, Edit (inline-edit a sent message), Copy, Read Aloud, Share (copy link), and "Good/Bad response" feedback.

NATIVE TOOLS (drive them through the composer / UI)
- File uploads: click the attach/paperclip in the composer, or use "Recent files"/Library. Up to 512MB/file. Then type an instruction that references the file ("summarize this PDF", "analyze this spreadsheet").
- Canvas: ChatGPT can open a collaboratve doc/code surface — ask it to "put the final version in Canvas" or "open this as a Canvas doc".
- Image generation: it PRODUCEs images (logos, posters, social graphics, mockups). No special button — TYPE a detailed visual prompt and send.
- Data Analysis / Code: it can run code on uploaded data (charts, CSV→spreadsheet, OCR). Upload the file, then ask.
- Deep Research: for heavy web research ("research X and give me a report").
- Memory (persists across chats) + Custom Instructions (shape its defaults) — set behavior on the first message.
- Web search: answers may include inline cited images/sources. Advanced Voice, Tasks (scheduled), Custom GPTs (specialized assistants in the GPT Store) also exist.

GENERAL USE CASES (what people ask it to do)
- Writing: emails, essays, posts, scripts, docs, rewrites, tone/brand edits.
- Coding: generate, explain, debug, refactor; run data analysis; build small apps.
- Research & analysis: summarize articles, compare options, deep-dive topics, market/competitor research.
- Brainstorming & planning: outlines, strategies, naming, roadmaps.
- Learning: explain concepts, tutor, quiz.
- Content & creative: social posts, image/concept art, presentations.
- Productivity: format resumes, find jobs, draft replies, automate repeats via Tasks.
- Acting AS a brand/company: given a brand brief it writes on-voice content and can generate matching visuals.

RELIABLE INTERACTION RULES (follow exactly)
- NEVER click "New chat"/"New conversation" while a chat is open — reuse the open composer. Start brand-new only if the user explicitly asks.
- FIRST turn: TYPE the full instruction (target="" autodetects the composer). After a long brief, WAIT for streaming to finish, then OBSERVE to read the reply (it sits at the TAIL of the page).
- If ChatGPT shows "Continue generating", CLICK it (the answer was truncated).
- If it asks a clarifying question, ANSWER in-chat with the missing detail (don't loop on "generate"/"do it" — supply the info).
- For image generation: drive it to FINISHED, DOWNLOADED PNGs (see GRAPHIC DESIGN). Use "Thinking" mode for detailed creative briefs.
- Set behavior on the first message with Custom-Instruction-style guidance ("Reply in short bullets; ask if ambiguous; cite sources").
- Multi-turn: keep working IN the same chat; never restart.
- Share/export: click "Share" → "Copy link", or use Canvas/Download for files.`

// --- Company knowledge: act AS these brands, or research them ---
const COMPANY_KNOWLEDGE = `### Company Knowledge (act AS these, or research them)
LX OBSIDIAN LABS (your default brand — https://www.lxobsidianportal.co.za)
- WHAT: A Cape Town–based technology company building enterprise-grade software, AI solutions, cloud infrastructure, mobile apps, and digital platforms. Full-stack delivery across web, mobile, AI, cloud, enterprise systems, and branding.
- SERVICES: custom web design & development, mobile app development, AI/ML solutions, cloud infrastructure, enterprise systems, and branding. (For design tasks, produce ONE focused asset per service.)
- VOICE/ANGLE: modern, capable, engineering-led, globally trusted. Speaks to startups THROUGH enterprises. Confidence without hype.
- PRODUCT: lxobsidianportal.co.za is their client portal / full-stack dashboard platform — refer to it as the product.
- OTHER COMPANIES: If the mission names a DIFFERENT company (a client, competitor, or "research X"), (1) research it on the web first ("search": "X company what they do"), (2) read their site, (3) then act AS / write about them using what you learned. NEVER invent a company's facts — verify via search.`

// --- LX Obsidian Labs: repeatable Facebook content operating system (the agent acts AS this brand) ---
const FB_CONTENT_SYSTEM = `### LX Obsidian Labs — Facebook Content Operating System
When the objective is to create, plan, schedule, or grow Facebook content (or act AS LX Obsidian Labs on social), follow this repeatable system instead of posting random promo.

BRAND VOICE: modern, capable, engineering-led, globally trusted. Teaches useful tech, shows real projects, sparks genuine conversation. No hype, no engagement bait.

🚩 CORE RULE — TEXT FIRST, THEN IMAGES:
When a content task comes in, ALWAYS start with TEXT: draft the post copy, the hook, the caption, the discussion question, and the CTA as written text BEFORE producing any image/carousel/design asset. Write the words first, get the message right, THEN (only if needed) generate visuals. NEVER begin a content task by generating images or designs — the text is the substance; images are decoration.

CONTENT PILLARS (mix over every 10 posts):
- Learn Something Today 30% — AI prompts, coding tips, UI/UX, security, branding
- Build in Public 20% — app builds, bug fixes, launches, client progress
- Tech Explained 15% — news in plain language, new dev tools
- Solve Real Problems 15% — slow sites, weak branding, manual workflows
- Behind the Brand 10% — workspace, founder insights, wins/setbacks
- Community Conversations 5% — thoughtful questions, polls
- Portfolio & Proof 5% — before/after, launches, testimonials
80% value (education/entertainment/community), 20% promotion.

FORMAT MIX (every 10 posts): 4 educational · 2 behind-the-scenes · 1 news/trend · 1 community · 1 portfolio · 1 personal.

DAILY FRAMEWORK (times are suggestions):
- Morning ~08:00: Quick Tech Tip (TEXT status post)
- Midday ~12:00: Carousel or Image (text-driven; write the captions first)
- Afternoon ~15:00: Reel / short video (write the SCRIPT as text first)
- Evening ~19:00: Discussion question (TEXT)
- Stories all day: workspace, coding, polls, progress (short text + photo)

WEEKLY ROTATION: Mon Mindset · Tue Tutorial · Wed Build-in-Public · Thu AI & Tech · Fri Portfolio · Sat Community · Sun Founder reflection.

RECURRING SERIES (build follower habits): 60-Second Tech, AI Tool of the Day, Website Wednesday, Design Fix Friday, Startup Saturday, Tech Myth Monday, Build in Public, Automation Minute.

REEL LENGTHS (don't force one length): 40% 15-30s (reach/shares) · 40% 30-60s (authority/saves) · 20% 60-90s+ (trust/depth). First 3 seconds = a strong hook — no "Hi everyone", no long logo intro. Strong openers: "Your website is losing customers because of this." / "I saved 10 hours a week with one AI tool."

ENGAGEMENT (genuine, not bait): end posts with a real question tied to the content — "Which would you choose?", "Dark mode or light mode?", "What's your biggest challenge?". Avoid manipulative "Comment below!" prompts.

REPURPOSING: one idea → Reel + Carousel + Image + Story + Long video + Poll + Newsletter. Recycle top performers (evergreen library).

MONETIZATION FUNNEL: FB post → followers → trust → website (lxobsidianportal.co.za) → free resources → email list → consultation → software/design/business consulting (recurring revenue).

THE 4 QUESTIONS THIS SYSTEM ANSWERS: Follow because it teaches · Return because of predictable series · Share because it makes them look smart / solves a problem · Recommended by Facebook because of watch time + meaningful comments (not bait).`

// --- LX Obsidian Labs: brand & visual design guide (used when generating image assets) ---
const BRAND_DESIGN_GUIDE = `### LX Obsidian Labs — Brand & Visual Design Guide
Apply this for EVERY image/design asset you generate for LX Obsidian Labs.

BRAND: premium technology & innovation company (software, AI, automation, design, cloud). Communicates: innovation, professionalism, trust, premium quality, modern design, technical expertise, business growth, reliability.

COLOR PALETTE (hex):
- Primary: Deep Obsidian Black #0B0B0F · Dark Charcoal #1A1A1F
- Neutral: White #FFFFFF · Slate Gray #5B6470
- Brand accent: Electric Blue #2E6BFF (focal points, CTAs, glows)
- Optional accent: Cyan glow #36E0FF (used SPARINGLY)
- Use gradients sparingly; keep strong contrast. Dark backgrounds + electric-blue accents read as "premium tech".

TYPOGRAPHY: bold, clean sans-serif (geometric/grotesk). Strong hierarchy, LARGE headings, generous spacing, consistent alignment, excellent readability. No script/decorative fonts. Headlines confident; body concise.

VISUAL STYLE: modern, minimal, corporate, elegant, premium, clean, futuristic, confident, high-end.
- Graphic elements: subtle glassmorphism, modern gradients, geometric overlays, grid systems, light particle accents, digital network lines, soft glows, rounded cards, minimal shadows.
- Imagery: authentic — developers, modern offices, coding screens, business meetings, cloud/AI concepts, data viz, UX wireframes. AVOID clipart, cartoons, cheap stock, overused AI clichés.
- Icons: minimal line icons, modern, consistent, tech-focused.

THREE VARIATION ARCHETYPES — produce ALL THREE for each concept, EACH as its OWN separate PNG:
1) Clean Corporate — minimal, elegant, executive, high whitespace, refined.
2) Premium Modern — dynamic, contemporary, gradient lighting, glass effects, tech-inspired.
3) Bold Marketing — high contrast, strong typography, attention-grabbing, powerful CTA, energetic layout.

ASSET DIMENSIONS (use the correct size per asset):
- Facebook Post: 1080x1080 or 1080x1350 · Facebook Cover: 851x315
- Instagram Portrait: 1080x1350 · Square: 1080x1080 · Story: 1080x1920
- LinkedIn Banner: 1584x396 · X Header: 1500x500
- YouTube Thumbnail: 1280x720 · YouTube Banner: 2560x1440
- Flyer/Poster: 1080x1350 (portrait) · Brochure Cover: 1275x1650
- Business Card: 1050x600 · Roll-up Banner: 1000x2500

QUALITY CHECKLIST (per design): clear hierarchy · professional typography · consistent spacing · strong contrast · premium branding · readable CTA · no AI artifacts · no distorted text/graphics · no visual clutter.`

// --- LX Obsidian Labs: reusable content libraries (hooks, CTAs, frameworks, storytelling) ---
const FB_CONTENT_LIBRARY = `### LX Obsidian Labs — Content Libraries (pull from these when writing posts)
Use these TEMPLATES to write better, text-first Facebook posts. Pick a hook + a framework + a CTA.

HOOK LIBRARY (open the first line with one of these — never "Hi everyone"):
- Curiosity: "You're probably doing this wrong and don't even know it."
- Shock: "90% of business websites lose customers for one silly reason."
- Question: "What's the ONE task you'd automate if you could?"
- Mistake: "The biggest branding mistake startups make in 2026."
- Statistics: "Teams using AI automation save 10+ hours a week — here's how."
- Prediction: "In 12 months, every dev team will ship with AI assistants."
- Controversy: "Dark mode isn't just preference — it's productivity."
- Fear: "If your site isn't mobile-first, you're already losing sales."
- Story: "Last week a client's app crashed on launch. Here's what we fixed."
- Challenge: "I rebuilt our landing page in one weekend — results inside."
- Urgency: "Stop wasting money on tools you don't need — do this instead."
- Comparison: "Custom software vs off-the-shelf: which actually saves money?"

CTA LIBRARY (end every post with ONE — genuine, not bait):
- Soft: "Save this for your next project." · "Bookmark it for later."
- Strong: "Message us to start your build." · "Get a free consult via lxobsidianportal.co.za."
- Discussion: "Which would you choose?" · "Agree or disagree?" · "What's your biggest challenge?" · "Would you use this?"
- Share: "Tag a founder who needs this." · "Send this to your dev team."
- Save: "Save this cheat-sheet." · "Screenshot this for your roadmap."
- Follow: "Follow LX Obsidian Labs for daily tech." · "Turn on notifications so you don't miss Build-in-Public Fridays."
- Community: "Drop your stack in the comments." · "What tool can't you live without?"

CONTENT FRAMEWORKS (fill the body with one):
- PAS (Problem → Agitate → Solve → CTA): state the pain, make it vivid, give the fix, ask to act.
- Q-S-L-D (Question → Story → Lesson → Discussion): open with a question, tell a real story, extract the lesson, invite replies.
- Myth-Truth-Evidence-CTA: "Myth: X. Truth: Y. Here's the proof (Z). Try it / message us."
- Before-Process-After-CTA: show the before state, the steps taken, the after result, then the CTA.
- Mistake-Why-Fix-Challenge: name a common mistake, explain why it happens, give the fix, challenge the reader to do it.

STORYTELLING FRAMEWORKS:
- Hero's Journey: the founder/team faces a challenge, overcomes it with tech, shares the win.
- Problem–Solution: present a real business problem, show the solution built.
- Open Loop / Curiosity Gap: promise a reveal, deliver it at the end (keeps watch-time).
- Transformation: before → struggle → after (great for case studies / redesigns).
- Mini Documentary: document one real build session (Build in Public).
- Personal Story: a founder lesson, failure, or win — humanizes the brand.
- Educational Story: teach a concept through a real example.
- Emotional Story: tie tech to a felt outcome (saved time, reduced stress, growth).

RULE: every post = ONE hook + ONE framework + ONE CTA. Keep the first sentence scroll-stopping and the CTA natural.`

// --- LX Obsidian Labs: research, analytics & optimization playbook ---
const FB_RESEARCH_PLAYBOOK = `### LX Obsidian Labs — Research, Analytics & Optimization Playbook
Use this to PLAN, MEASURE, and IMPROVE content — not just post.

WEEKLY RESEARCH ROUTINE:
- Competitor watch: track 5–8 tech / design / AI pages. Each week note their top posts — format, hook, length, engagement — and what outperformed.
- Trend monitoring (review weekly): AI, software dev, startups, SaaS, business automation, productivity, graphic design, UI/UX, cloud, cybersecurity, mobile apps, digital marketing. For each record: search interest, audience relevance, competition, longevity.
- Mine gaps: problems businesses face this week, new tools, and questions the audience already asks.

CONTENT SCORING (score every idea 1–10 BEFORE publishing; publish highest first):
Educational value · Entertainment · Curiosity · Shareability · Discussion potential · Evergreen value · Brand relevance.

KPI DASHBOARD (review weekly):
- Reach / Impressions
- Average watch time & video retention
- Shares / Saves / Comments
- Followers gained vs lost
- Engagement rate
- Click-through rate (to lxobsidianportal.co.za)
- Consultation inquiries
- Revenue (Reels / Stars / in-stream ads + services)
- Top-performing topics, hooks, posting times, video lengths
TARGETS (first 90 days): steady follower growth · avg watch time up week-over-week · shares+saves outweigh reactions-only · ≥1 consultation inquiry/week from Facebook.

AI CONTENT WORKFLOW (use ChatGPT for each step):
1) Research → 2) Idea generation (from pillars + trends) → 3) Script/copy (use the Content Libraries) → 4) Headline/hook generation → 5) Caption + hashtags → 6) Thumbnail concept → 7) SEO/keyword → 8) Repurpose one idea into Reel + Carousel + Image + Story + Newsletter → 9) Schedule → 10) Performance analysis → feed winners back into next week's plan.

OPTIMIZATION LOOP: double down on topics/formats that beat your averages; retire those below. Recycle evergreen winners monthly. When the objective is analysis/"what worked", read the page/insights and report the KPI dashboard above.`

// --- Gmail knowledge (used when reading / managing email) ---
const GMAIL_GUIDE = `### Gmail (mail.google.com) — READ & MANAGE email
When the objective is to read, find, or manage email in Gmail, use these reliable flows. Gmail is a list/thread SPA — the email LIST is rows you click to open a THREAD.

OPEN / READ A THREAD
- The list rows are clickable (sender • subject • snippet • time). Click the row to open the conversation.
- To read a SPECIFIC email, search first: click the "Search mail" box, type a query (e.g. sender name, subject word, from:boss@co.com, is:unread), press Enter, wait, then click the first matching row.
- Once a thread is open, its messages are listitems (div[role="listitem"]); read the sender, subject and body text.

COMPOSE / SEND
- Click "Compose" (aria-label contains "Compose"). A pop-out opens with a To field, Subject field, and a Message Body (contenteditable, aria-label contains "Message Body").
- Fill To → Subject → Body, then click "Send" (aria-label contains "Send"). Do NOT press Enter in the To/Subject fields — only the body is a composer.

REPLY / REPLY ALL / FORWARD
- With a thread open, click "Reply" / "Reply all" / "Forward" (aria-label contains the word). A compose window opens prefilled; type into the body and click Send.

SEARCH OPERATORS (type in the search box + Enter)
- from:bob@co.com · to:me · subject:invoice · has:attachment · is:unread · is:starred · label:Work · after:2026/01/01 · before:2026/02/01 · in:spam · in:trash

ORGANIZE (with a thread/row selected)
- Archive (aria-label contains "Archive"), Delete/Trash (contains "Delete" or "Trash"), Snooze (contains "Snooze").
- Labels: click "Labels" (contains "Label") to open the label menu, then click the label name.
- Mark read/unread: open the "More" menu (contains "More") → "Mark as read" / "Mark as unread".

RULES
- For READING, open the thread before reading its text. For SENDING, fill To → Subject → Body → click Send.
- Use the dedicated "gmail" action (target = open | read | compose | reply | forward | search | archive | label | mark_read | trash | snooze) — it drives the right Gmail UI. Examples:
  - Read the latest/important mail: {"type":"gmail","target":"open","value":""}
  - Read mail from a specific sender: {"type":"gmail","target":"open","value":"from:boss@co.com is:unread"}
  - Send an email: {"type":"gmail","target":"compose","value":"to@co.com | Subject here | Body text here"}
  - Reply to the open thread: {"type":"gmail","target":"reply","value":"Your reply text"}
  - Forward: {"type":"gmail","target":"forward","value":"fwd@co.com | Optional note"}
  - Search: {"type":"gmail","target":"search","value":"invoice"}
  - Archive / trash / mark read: {"type":"gmail","target":"archive"} etc.
  - Triage the inbox: {"type":"gmail","target":"list","value":"10"} to list recent threads (sender | subject | snippet), then {"type":"gmail","target":"summarize"} for an AI summary of the open thread (or the list).
  - Star / important / spam: {"type":"gmail","target":"star"}, {"type":"gmail","target":"important"}, {"type":"gmail","target":"spam"}.
  - Reply to everyone: {"type":"gmail","target":"reply_all","value":"Your reply text"}.
  - Save a draft (don't send): {"type":"gmail","target":"draft","value":"to@co.com | Subject | Body"}.
  - Schedule send: {"type":"gmail","target":"schedule","value":"to@co.com | Subject | Body"} (picks the first preset slot).
  - Organize: {"type":"gmail","target":"move","value":"Work"} (Move to a label/folder), {"type":"gmail","target":"label","value":"Work"} (apply a label), {"type":"gmail","target":"mark_all_read"} (mark everything read).
  - Attachments: {"type":"gmail","target":"attachments","value":""} lists them; {"type":"gmail","target":"attachments","value":"download"} downloads them.
  - Cleanup: {"type":"gmail","target":"unsubscribe"} unsubscribes from a promotional email.`

async function buildActionPrompt(pageState, context) {
  // Build failed actions blacklist
  const blacklist = Array.from(failedActions.entries())
    .filter(([_, count]) => count >= 2)
    .map(([key]) => key)
  const blacklistStr = blacklist.length > 0 ? `\n## 🚫 BLACKLIST — These actions already failed. DO NOT RETRY:\n${blacklist.map(k => `  - ${k}`).join('\n')}\n` : ''

  const strategyHint = consecutiveFailures >= 2
    ? `\n## ⚠️ ${consecutiveFailures} CONSECUTIVE FAILURES. Change strategy NOW:\n  - Use "search" or "navigate" to a different site\n  - Use "back" to return to previous page\n  - Try a completely different action type\n`
    : ''

  // Page summary for rich context
  const summary = pageState.textSummary ? `\n## Page Content Preview\n${pageState.textSummary.slice(0, 600)}${pageState.textSummary.length > 600 ? '...' : ''}\n` : ''
  const dialogNote = pageState.dialogs?.length > 0 ? `\n⚠️ ${pageState.dialogs.length} dialog(s) detected. Use "dismiss" to close them, or interact with them.\n` : ''
  const selectNote = pageState.selects?.length > 0 ? `\n📋 ${pageState.selects.length} dropdown(s) available. Use "select" to choose options.\n` : ''
  const iframeNote = pageState.iframes?.length > 0 ? `\n🖼️ ${pageState.iframes.length} iframe(s) detected. Use "iframe" to switch context.\n` : ''
  const elementCounts = pageState.elementCount ? `\n📊 ${pageState.elementCount.buttons} buttons, ${pageState.elementCount.inputs} inputs, ${pageState.elementCount.links} links, ${pageState.elementCount.selects || 0} selects\n` : ''
  const streamingNote = pageState.streaming ? `\n⏳ Page is streaming/generating content. Use "wait" then "observe" to check progress.\n` : ''

  // Self-learning: pull relevant past experience
  const mem = await loadMemory()
  const memText = memoryToText(mem, context.objective, context.url)
  const firstTurnNote = (context.chatTurns === 0 && isOnChatSite(context.url))
    ? '\n⚠️ THIS IS THE FIRST MESSAGE in this chat — open by briefly briefing ChatGPT on the task AND how you want it to respond (detailed, step-by-step, ask clarifying questions if anything is ambiguous). This "trains" it to collaborate well.\n'
    : ''

  // User-awareness: the agent acts AS the configured creator/brand.
  const profile = loadProfile()
  const userContextBlock = profile
    ? `\n## 👤 User / Brand Context (act AS this user)\n${buildProfilePrompt(profile)}\nStay true to their identity, niche, voice, and goals in everything you do.\n${COMPANY_KNOWLEDGE}\n${FB_CONTENT_SYSTEM}\n${BRAND_DESIGN_GUIDE}\n${FB_CONTENT_LIBRARY}\n${FB_RESEARCH_PLAYBOOK}\n${GMAIL_GUIDE}`
    : `\n## 👤 User / Brand Context\n${COMPANY_KNOWLEDGE}\n${FB_CONTENT_SYSTEM}\n${BRAND_DESIGN_GUIDE}\n${FB_CONTENT_LIBRARY}\n${FB_RESEARCH_PLAYBOOK}\n${GMAIL_GUIDE}\nIf a creator profile is set later, prefer it; otherwise act as LX Obsidian Labs by default.`

  return `You are Synapse — a browser automation agent in an observe→plan→execute→verify loop.

## Page State
${JSON.stringify(compactPageState(pageState))}
${blacklistStr}${summary}${dialogNote}${selectNote}${iframeNote}${streamingNote}${elementCounts}
## Mission${strategyHint}
Objective: ${context.objective || 'None'}
${context.plan.length ? `Plan (work these in order, mark each done as you complete it):\n${context.plan.map((s, i) => `${i + 1}. ${context.planDone.includes(i) ? '✅' : '⬜'} ${s}`).join('\n')}` : 'Done: ' + (context.completedTasks.join(', ') || 'None')}
Error: ${context.lastError || 'None'}
Step ${context.steps + 1}/${context.maxSteps}
URL: ${context.url || 'No page'}
${memText ? `## 🧠 Experience (self-learning — reuse what worked before)\n${memText}\n` : ''}${firstTurnNote}
## Rules
- Pick action targets from page state above. Never guess selectors.
- You are a GENERAL browser agent — operate on ANY website, not only ChatGPT. Adapt to the page in front of you (search engine, dashboard, admin panel, docs site, shop, settings page, AI chat, etc.) and use the Platform Knowledge below.
- If error or blacklist shown, DO NOT repeat the same action.
- After navigation, always observe before the next action.
- For dialogs: use "dismiss" first before interacting with page content.
- For dropdowns: use "select" with the option text from selects[].
- For iframes: use "iframe" to switch into them, then observe.
- Use "data" to extract tables, lists, or JSON-LD structured data; "extract"/"read" to read page text.
- Search boxes & chat composers: after you type, Enter is auto-pressed. You may still send "key: enter" if nothing happens.
- When searching the web ("search" action), default to the CURRENT year 2026 in the query (e.g. "business automation 2026") for up-to-date results. Only use a different year if the user explicitly asks for one. (The system also auto-appends 2026 if you forget.)
- Multi-field forms (login, signup, settings): fill EACH field with "type", then CLICK the submit/"Log in" button (or send "key: enter"). Do NOT rely on auto-Enter for non-search fields.
- USER AWARENESS: You act on behalf of the user described in the 👤 User / Brand Context block. Match their brand voice, niche, and goals. When generating or posting content, stay true to their identity.
- FACEBOOK / SOCIAL CONTENT (LX Obsidian Labs): Follow the LX Obsidian Labs Facebook Content Operating System in the 👤 User / Brand Context block. 🚩 CRITICAL — TEXT FIRST: for any content task, write the post copy, hook, caption, and CTA as TEXT before generating any image/carousel/design asset. Do NOT start a content task by producing images or designs; the words are the substance, visuals are support. When writing copy, PULL from the Content Libraries (hooks, CTAs, frameworks, storytelling) in the same block — every post = ONE hook + ONE framework + ONE CTA. For planning/analysis tasks, use the Research & Analytics Playbook (competitor watch, trend monitoring, content scoring, KPI dashboard, AI content workflow). Post to Facebook by typing into the "What's on your mind?" composer and clicking "Post".
- LOGIN-FIRST: If the objective requires an account, dashboard, or any authenticated area and you are NOT logged in (a login form is visible), log in FIRST with the "login" action. The user may include credentials in their request (e.g. "log into Cloudflare, user: you@domain.com pass: secret") — pass them as target=email, value=password. If credentials are not provided, tell the user exactly what's needed and stop rather than guessing.
- ACCOUNT CREATION: If the objective is to SIGN UP / register a NEW account (not log in), use the "create_account" action with target=email, value=password (optionally "password | Full Name"). It will click any "Sign up"/"Create account" entry point, fill the registration form (name, email, password, confirm), submit, and report the outcome: account_created, verification_required (confirm email/SMS — ask the user for the code), or creation_failed (email taken / weak password / missing field — report the exact screen text). Never invent a password or email; use whatever the user supplied, or ask if none was given.
- 2FA / VERIFICATION: After login, if a code/verification step appears, ask the user for the code (or wait for them to provide it) and then TYPE it into the code field. Never invent or guess a code.${userContextBlock}

## If this is a CHAT / AI site (ChatGPT, Claude, Gemini, Copilot, etc.)
- DO NOT navigate away and DO NOT click "New chat"/"New conversation" if a chat is already open (you are on a chat site, already sent messages, or see a composer like "Message ChatGPT"). Reuse the OPEN chat: find the composer and TYPE the user's instruction directly. Only start a new chat if the user explicitly asks.
- FIRST ACTION RULE: If you have NOT yet sent the user's instruction into this chat (this is the first turn), your very first action MUST be "type" — send the FULL user objective into the composer (target can be empty to auto-detect the composer, or "Message ChatGPT"). DO NOT observe/wait/scroll first; the conversation cannot start until you send the instruction. After sending, "wait" for the reply, then continue in the same chat.
- After you type, the assistant's reply IS your feedback. Use "wait" until streaming stops, then "observe" to READ the response. Reason about it and either continue in the SAME chat or finish with "done". Never restart the chat.
- If ChatGPT shows a "Continue generating" button, CLICK it (the answer was truncated) — then wait and re-read.
- Pick the right engine: open the model picker (top of composer) and click "Thinking" for hard/creative/research tasks, "Instant" for quick ones. Do NOT try to type a model name.
- Upload context when useful: click the attach/paperclip in the composer (or use "Recent files"/Library) to give ChatGPT a PDF, spreadsheet, image, or doc, then type an instruction that references it ("summarize this", "analyze this data").
- If the objective spans multiple turns, keep working inside the existing conversation with follow-up questions/refinements until the objective is genuinely met. Only declare "done" when the conversation satisfies it.
- First message: briefly teach the assistant the task AND how you want responses (Custom-Instruction style: detailed, step-by-step, ask clarifying questions, cite sources, match a brand voice). This "trains" it to collaborate well.
- Share/export: click "Share" → "Copy link", or ask it to put the final version in Canvas / Download for files.
${CHATGPT_GUIDE}
- GRAPHIC DESIGN / IMAGE GENERATION (ChatGPT, etc.): These assistants can GENERATE images (logos, posters, social graphics) when you ask. Your job is to DRIVE ChatGPT all the way to finished, DOWNLOADED PNGs — never stop at planning or text prompts.
  GOAL: produce MANY separate marketing FILES, each a single, focused design based on the company's business and the services it offers — NOT one image containing several designs/logos. Treat each service/product as its own design brief.
  WORKFLOW:
   1) On the first turn you already TYPE the full design brief into the composer — it includes the COMPANY NAME + the SERVICES/PRODUCTS it offers + target audience + brand colours + the instruction to generate a SET of separate, single-subject designs (one per service, plus a general brand piece), each saved as its OWN PNG. APPLY the LX Obsidian Labs Brand & Visual Design Guide (in the 👤 User / Brand Context block): Obsidian Black + Electric Blue palette, bold clean sans-serif, premium-tech style, and for EACH concept produce the THREE variation archetypes (Clean Corporate / Premium Modern / Bold Marketing) — each as its OWN separate PNG. If ChatGPT replies asking for missing details, do NOT just keep saying "generate the image" — that makes it re-ask forever. Instead, in ONE reply SUPPLY a complete set of reasonable defaults inline (company, industry, colours, styles, sizes) AND then tell it to generate the separate designs. Give it everything it needs in a single message so it can actually produce the artwork instead of looping on questions. (If you genuinely lack the company details, ask the human IN THE PANEL for them, then continue.)
   2) After ANY ChatGPT text reply, immediately push it to PRODUCE THE ARTWORK: type something like "Now use your image-generation tool to generate the finished marketing designs as high-resolution PNGs. Apply the LX Obsidian Labs brand guide (Obsidian Black + Electric Blue, bold clean sans-serif, premium tech). For EACH service your company offers (e.g. 'Service A — social post', 'Service B — flyer', 'Service C — poster') PLUS a general brand poster, generate the design THREE times — once in each variation (Clean Corporate, Premium Modern, Bold Marketing) — so there are 3 distinct PNGs per concept. Each design must be a SINGLE focused image about ONE subject — do NOT put multiple designs or a grid of images into one picture. Generate each as its OWN separate PNG."
  3) "wait" until the image(s) finish generating, then "observe" to confirm they rendered.
  4) Use "download_image" (target "all") to SAVE every generated PNG to the user's Downloads. NOTE: download_image only captures artwork that ChatGPT actually rendered inside the conversation panel — it automatically ignores ChatGPT's own UI icons, avatars, and sidebar graphics — so it is always safe to run once images are present (imgCount > 0).
  5) Iterate: ask for the next batch / revisions IN THE SAME CHAT, generate, and download again. Keep all assets (never start a new chat and lose them).
  RULE: The objective is COMPLETE only when MULTIPLE PNG designs (one per service, plus a brand piece) are generated AND downloaded. If ChatGPT only gives text/instructions, keep commanding it to "generate the actual images as separate PNGs" until it does.

## If this is a REGULAR website / dashboard (Cloudflare, admin panels, docs, shops, settings)
- Navigate with "navigate" (full URL/domain) or "search". Open menus/sidebars by clicking their exact labels.
- To read current configuration/state, click into the relevant section, then "observe"/"extract"/"data" to read what's shown.
- Verify a setting by reading the on-page indicator (toggle state, status text, table row) — act on the UI, do NOT treat page text as a chat reply.
- Complete multi-step tasks by clicking through the UI: select a site/zone -> open its settings -> read/change the field -> save.
- SIGN-UP / REGISTRATION: To create a new account on the site, use "create_account" (target=email, value=password). It finds and clicks any "Sign up"/"Create account" link, fills the form, and submits. If a verification step appears it reports verification_required — ask the user for the code, then type it. For sites with unusual multi-step wizards, you may also fill fields manually with "type" + click the submit button.

## Platform Knowledge
${PLATFORM_GUIDE}

## Actions (output ONE JSON)
{"type":"click|type|navigate|scroll|wait|extract|observe|done|search|back|forward|key|select|check|upload|save|copy|find|reload|print|zoom|dismiss|iframe|data|parse|read|summarize|translate|contacts|tabs|export|clean|design|login|create_account|download_image|gmail","target":"...","value":"..."}

### Quick examples
- click: {"type":"click","target":"DNS"}  (open a dashboard section)
- type: {"type":"type","target":"Message ChatGPT","value":"Hello"}  (chat composer)
- type: {"type":"type","target":"Search","value":"my query"}  (search box — Enter auto-pressed)
- wait: {"type":"wait","value":"5000"}
- search: {"type":"search","target":"python tutorial"} or "wikipedia: AI"
- parse: {"type":"parse"} — structured search results after search
- read: {"type":"read"} — clean article content
- summarize: {"type":"summarize"} — AI summary of current page (3-5 bullets)
- translate: {"type":"translate","target":"french"} — translate page
- contacts: {"type":"contacts"} — extract emails, phones, social links
- tabs: {"type":"tabs"} — list all open tabs
- export: {"type":"export","value":"data to save"} — download to file
- clean: {"type":"clean"} — close all other tabs
- dialog: {"type":"dismiss"}
- select: {"type":"select","target":"country","value":"US"}
- key: {"type":"key","target":"enter"}
- iframe: {"type":"iframe","target":"login"}
  - data: {"type":"data","target":"tables"}
  - login: {"type":"login","target":"you@domain.com","value":"password"} — log into the current site (handles 2FA by asking for the code)
  - create_account: {"type":"create_account","target":"you@domain.com","value":"P@ssw0rd | Jane Doe"} — register a NEW account (clicks "Sign up", fills name/email/password, submits; reports verification_required / account_created / creation_failed)
  - download_image: {"type":"download_image","target":"all"} — save images on the page (e.g. AI-generated graphics); default saves the 1 largest, "all" saves every image
  - gmail: {"type":"gmail","target":"open","value":""} — read/open mail (value = optional search query, e.g. "from:boss@co.com is:unread"); {"type":"gmail","target":"compose","value":"to@co.com | Subject | Body"} — send; {"type":"gmail","target":"reply","value":"text"}; {"type":"gmail","target":"search","value":"invoice"}; {"type":"gmail","target":"archive"|"trash"|"mark_read"|"label","value":"Work"}
  - done: {"type":"done"}
  - design: {"type":"design","target":"Instagram Post","value":"quote"} — create Canva design (type, search template)
  `
}

async function planNextAction(pageState, context) {
  const prompt = await buildActionPrompt(pageState, context)
  const t0 = performance.now()
  const response = await sendToBackground('AI_CHAT', {
    messages: [{ role: 'user', content: prompt }]
  }, 30000)
  const dt = performance.now() - t0
  if (response.model) setHudModel(response.model)
  setHudLatency(dt)
  if (!response.success) { pushHudLog('PLAN', response.error || 'failed', 'err'); return { type: 'observe', target: '', value: '' } }
  pushHudLog('PLAN', 'decision @ ' + Math.round(dt) + 'ms', 'ok')
  const action = parseAction(response.content)
  return action || { type: 'observe', target: '', value: '' }
}

// --- Action Executor: pure switch, knows nothing about AI ---

async function executeAction(action) {
  // Some actions need multi-step processing
  if (action.type === 'summarize') {
    const text = await sendToBackground('TOOL_EXECUTE', { tool: 'extract_article', args: [] }, TOOL_TIMEOUT)
    const content = text.success && text.result ? text.result : (await sendToBackground('TOOL_EXECUTE', { tool: 'get_page_text', args: [] }, TOOL_TIMEOUT)).result || ''
    if (!content) return { success: false, error: 'No page content to summarize' }
    const summary = await sendToBackground('AI_CHAT', {
      messages: [{ role: 'user', content: `Summarize this page concisely (3-5 bullet points, key facts only):\n\n${content.slice(0, 4000)}` }]
    }, 30000)
    return summary.success ? { success: true, result: summary.content } : { success: false, error: 'Summarization failed' }
  }

  if (action.type === 'translate') {
    const lang = action.target || 'spanish'
    const text = await sendToBackground('TOOL_EXECUTE', { tool: 'get_visible_text', args: [] }, TOOL_TIMEOUT)
    if (!text.success || !text.result) return { success: false, error: 'No page content to translate' }
    const translated = await sendToBackground('AI_CHAT', {
      messages: [{ role: 'user', content: `Translate the following page content to ${lang}. Preserve all formatting and structure. Only return the translated text:\n\n${text.result.slice(0, 3000)}` }]
    }, 30000)
    return translated.success ? { success: true, result: translated.content } : { success: false, error: 'Translation failed' }
  }

  switch (action.type) {
    case 'click': {
      const t = (action.target || '').toLowerCase()
      const isNewChatTarget = /new\s*(chat|conversation|thread)/.test(t) || t.includes('new chat')
      // Programmatic state validation: a chat is "already open" if we are on a
      // chat site, a composer input is present on the page, or we have already
      // sent messages. When it is, NEVER start a fresh conversation — hard-stop
      // the loop, blacklist the target so the planner won't re-pick it, and (if
      // we haven't sent the user's prompt yet) type it into the composer now.
      if (isNewChatTarget && detectChatContext(lastObservedState, agentContext).chatOpen) {
        const key = 'click:' + (action.target || '')
        failedActions.set(key, (failedActions.get(key) || 0) + 1)
        if (agentContext.chatTurns === 0 && agentContext.objective) {
          addMessage('system', '🛑 Chat already open — skipped "New chat" and sent your prompt directly into the composer.')
          scrollToBottom()
          return await executeAction({ type: 'type', target: '', value: agentContext.objective })
        }
        return { success: true, result: 'Reused the OPEN chat — skipped "New chat". Continue in the existing conversation.' }
      }
      return sendToBackground('TOOL_EXECUTE', { tool: 'find_and_click', args: [action.target] }, TOOL_TIMEOUT)
    }
    case 'type':
      if (isOnChatSite(agentContext.url)) agentContext.chatTurns = (agentContext.chatTurns || 0) + 1
      // Long pastes (e.g. a full mission brief) need more than the default tool
      // timeout, or fill_input is cut off mid-type. Give typing generous headroom.
      return sendToBackground('TOOL_EXECUTE', { tool: 'fill_input', args: [action.target, action.value] }, 400000)
    case 'navigate': {
      const ctx = detectChatContext(lastObservedState, agentContext)
      const th = targetHost(action.target)
      // Programmatic state validation: if a conversation is already open, never
      // navigate to (re)open a chat — that just restarts the new-chat loop.
      // Stay in the current conversation instead.
      if (ctx.chatOpen && (isOnChatSite(action.target) || (th && th === hostOf(ctx.url)))) {
        return { success: true, result: `Chat already open on ${ctx.url} — staying in the current conversation instead of navigating.` }
      }
      return sendToBackground('BROWSER_TOOL', { tool: 'navigate_to', args: [action.target] }, TOOL_TIMEOUT)
    }
    case 'scroll':
      if (action.target === 'bottom') return sendToBackground('TOOL_EXECUTE', { tool: 'scroll_to_bottom', args: [] }, TOOL_TIMEOUT)
      if (action.target === 'top') return sendToBackground('TOOL_EXECUTE', { tool: 'scroll_to_top', args: [] }, TOOL_TIMEOUT)
      return sendToBackground('TOOL_EXECUTE', { tool: 'scroll_to_element', args: [action.target] }, TOOL_TIMEOUT)
    case 'wait':
      return sendToBackground('TOOL_EXECUTE', { tool: 'wait', args: [action.value || '2000'] }, TOOL_TIMEOUT)
    case 'observe':
      return sendToBackground('TOOL_EXECUTE', { tool: 'observe_page', args: [] }, TOOL_TIMEOUT)
    case 'extract':
      return sendToBackground('TOOL_EXECUTE', { tool: 'get_page_text', args: [] }, TOOL_TIMEOUT)
    case 'done':
      return { success: true, result: 'Mission complete' }
    case 'search': {
      let q = (action.target + ' ' + action.value).replace(/\s+/g, ' ').trim()
      // Default to the CURRENT year (2026) for up-to-date results, unless the
      // query already pins a specific 4-digit year (e.g. the user asked for 2024).
      if (!/\b(?:19|20)\d{2}\b/.test(q)) q = q + ' 2026'
      return sendToBackground('BROWSER_TOOL', { tool: 'search_web', args: [q] }, TOOL_TIMEOUT)
    }
    case 'parse':
      return sendToBackground('TOOL_EXECUTE', { tool: 'parse_search_results', args: [] }, TOOL_TIMEOUT)
    case 'read':
      return sendToBackground('TOOL_EXECUTE', { tool: 'extract_article', args: [] }, TOOL_TIMEOUT)
    case 'back':
      return sendToBackground('BROWSER_TOOL', { tool: 'go_back', args: [] }, TOOL_TIMEOUT)
    case 'forward':
      return sendToBackground('BROWSER_TOOL', { tool: 'go_forward', args: [] }, TOOL_TIMEOUT)
    case 'reload':
      return sendToBackground('BROWSER_TOOL', { tool: 'reload_page', args: [] }, TOOL_TIMEOUT)
    case 'print':
      return sendToBackground('BROWSER_TOOL', { tool: 'print_page', args: [] }, TOOL_TIMEOUT)
    case 'key':
      return sendToBackground('TOOL_EXECUTE', { tool: 'press_key', args: [action.target, action.value].filter(Boolean) }, TOOL_TIMEOUT)
    case 'select':
      return sendToBackground('TOOL_EXECUTE', { tool: 'select_option', args: [action.target, action.value].filter(Boolean) }, TOOL_TIMEOUT)
    case 'check':
      return sendToBackground('TOOL_EXECUTE', { tool: 'toggle_checkbox', args: [action.target] }, TOOL_TIMEOUT)
    case 'upload':
      return sendToBackground('TOOL_EXECUTE', { tool: 'upload_file', args: [action.target, action.value].filter(Boolean) }, TOOL_TIMEOUT)
    case 'copy':
      return sendToBackground('TOOL_EXECUTE', { tool: 'copy_to_clipboard', args: [action.value || action.target] }, TOOL_TIMEOUT)
    case 'find':
      return sendToBackground('TOOL_EXECUTE', { tool: 'find_in_page', args: [action.target || action.value] }, TOOL_TIMEOUT)
    case 'save':
      return sendToBackground('BROWSER_TOOL', { tool: 'download_url', args: [action.target, action.value].filter(Boolean) }, TOOL_TIMEOUT)
    case 'zoom':
      return sendToBackground('TOOL_EXECUTE', { tool: 'set_zoom', args: [action.target || action.value || '1.0'] }, TOOL_TIMEOUT)
    case 'dismiss':
      return sendToBackground('TOOL_EXECUTE', { tool: 'dismiss_dialog', args: [] }, TOOL_TIMEOUT)
    case 'iframe':
      return sendToBackground('TOOL_EXECUTE', { tool: 'switch_to_iframe', args: [action.target || action.value] }, TOOL_TIMEOUT)
    case 'data':
      return sendToBackground('TOOL_EXECUTE', { tool: 'get_structured_data', args: [action.target || 'tables'] }, TOOL_TIMEOUT)
    case 'contacts':
      return sendToBackground('TOOL_EXECUTE', { tool: 'extract_contacts', args: [] }, TOOL_TIMEOUT)
    case 'tabs':
      return sendToBackground('BROWSER_TOOL', { tool: 'get_all_tabs', args: [] }, TOOL_TIMEOUT)
    case 'export':
      return sendToBackground('BROWSER_TOOL', { tool: 'export_results', args: [action.value || action.target || 'No content provided'] }, TOOL_TIMEOUT)
    case 'clean':
      return sendToBackground('BROWSER_TOOL', { tool: 'close_other_tabs', args: [] }, TOOL_TIMEOUT)
    case 'design':
      return sendToBackground('BROWSER_TOOL', { tool: 'design_canva', args: [action.target, action.value].filter(Boolean) }, TOOL_TIMEOUT)
    case 'login':
      // Log in to the current site. args: [username/email, password]
      return sendToBackground('TOOL_EXECUTE', { tool: 'login_to_site', args: [action.target, action.value].filter(Boolean) }, TOOL_TIMEOUT)
    case 'create_account':
      // Register a NEW account on the current site. args: target=email, value=password (optionally "password|Full Name")
      return sendToBackground('TOOL_EXECUTE', { tool: 'create_account', args: [action.target, action.value].filter(Boolean) }, TOOL_TIMEOUT)
    case 'download_image':
      // Save images from the page (e.g. AI-generated graphics). args: [count | "all"]
      return sendToBackground('TOOL_EXECUTE', { tool: 'download_image', args: [action.target || action.value] }, TOOL_TIMEOUT)
    case 'gmail': {
      // Gmail operations. target = operation; value carries piped args.
      const op = (action.target || '').toLowerCase()
      const v = action.value || ''
      const split = (s) => String(s).split('|').map((x) => x.trim())
      switch (op) {
        case 'open':
        case 'read':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_open', args: [v] }, TOOL_TIMEOUT)
        case 'compose':
        case 'send':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_compose', args: split(v) }, TOOL_TIMEOUT)
        case 'reply':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_reply', args: [v] }, TOOL_TIMEOUT)
        case 'forward':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_forward', args: split(v) }, TOOL_TIMEOUT)
        case 'search':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_search', args: [v] }, TOOL_TIMEOUT)
        case 'archive':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_archive', args: [] }, TOOL_TIMEOUT)
        case 'label':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_label', args: [v] }, TOOL_TIMEOUT)
        case 'mark_read':
        case 'mark unread':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_mark_read', args: [v] }, TOOL_TIMEOUT)
        case 'trash':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_trash', args: [] }, TOOL_TIMEOUT)
        case 'snooze':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_snooze', args: [] }, TOOL_TIMEOUT)
        case 'list':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_list', args: [v || '10'] }, TOOL_TIMEOUT)
        case 'summarize': {
          const raw = await sendToBackground('TOOL_EXECUTE', { tool: 'gmail_read', args: [] }, TOOL_TIMEOUT)
          const text = (raw.success && raw.result ? raw.result : '') || (await sendToBackground('TOOL_EXECUTE', { tool: 'gmail_list', args: ['15'] }, TOOL_TIMEOUT)).result || ''
          if (!text) return { success: false, error: 'No email content to summarize' }
          const summary = await sendToBackground('AI_CHAT', { messages: [{ role: 'user', content: `Summarize this email content concisely (3-5 bullet points, key facts and any action items only):\n\n${text.slice(0, 5000)}` }] }, 30000)
          return summary.success ? { success: true, result: summary.content } : { success: false, error: 'Email summarization failed' }
        }
        case 'star':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_star', args: [] }, TOOL_TIMEOUT)
        case 'important':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_important', args: [] }, TOOL_TIMEOUT)
        case 'spam':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_spam', args: [] }, TOOL_TIMEOUT)
        case 'reply_all':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_reply_all', args: [v] }, TOOL_TIMEOUT)
        case 'draft':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_draft', args: split(v) }, TOOL_TIMEOUT)
        case 'move':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_move', args: [v] }, TOOL_TIMEOUT)
        case 'schedule':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_schedule', args: split(v) }, TOOL_TIMEOUT)
        case 'attachments':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_attachments', args: [v] }, TOOL_TIMEOUT)
        case 'unsubscribe':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_unsubscribe', args: [] }, TOOL_TIMEOUT)
        case 'mark_all_read':
          return sendToBackground('TOOL_EXECUTE', { tool: 'gmail_mark_all_read', args: [] }, TOOL_TIMEOUT)
        default:
          return { success: false, error: `Unknown gmail operation: ${op}. Use: open, read, list, summarize, compose, reply, reply_all, forward, search, archive, label, move, mark_read, star, important, spam, draft, schedule, attachments, unsubscribe, trash, snooze, mark_all_read` }
      }
    }
    default:
      return { success: false, error: `Unknown action: ${action.type}` }
  }
}

// --- Verification Engine ---

function verifyAction(action, result, pageState) {
  if (!result.success) {
    return { passed: false, reason: result.error || 'Action failed' }
  }
  switch (action.type) {
    case 'navigate':
      // Navigation succeeded if the tool returned success AND the URL is non-empty (could be redirected)
      if (!pageState.url) return { passed: false, reason: 'Navigation completed but no URL detected' }
      return { passed: true, reason: `Navigated to ${pageState.url}` }
    case 'click':
      return { passed: true, reason: 'Click executed' }
    case 'type':
      return { passed: true, reason: 'Text entered' }
    case 'wait':
      return { passed: true, reason: 'Wait completed' }
    case 'observe':
      return { passed: true, reason: 'Page observed' }
    case 'extract':
      return { passed: true, reason: 'Content extracted' }
    default:
      return { passed: true, reason: 'Action completed' }
  }
}

// --- Objective Judge (agent-as-a-judge) ---
// Independent LLM verification that the objective is actually met before
// declaring done — mirrors how browser benchmarks evaluate task success.

async function verifyObjective(pageState, context) {
  const prompt = `You are a strict evaluator. Decide if the user's objective is COMPLETE from the current page state.
Objective: ${context.objective}
Completed so far: ${context.completedTasks.join(', ') || 'none'}
Last error: ${context.lastError || 'none'}

Current page:
URL: ${pageState.url || 'unknown'}
Title: ${pageState.title || 'unknown'}
${pageState.textSummary ? pageState.textSummary.slice(-1600) : ''}

Respond with ONLY JSON: {"complete": true|false, "confidence": 0.0-1.0, "reason": "one short sentence explaining the verdict"}
Only set complete:true if the objective is genuinely satisfied. If false, explain what is still missing.`
  const t0 = performance.now()
  const res = await sendToBackground('AI_CHAT', { messages: [{ role: 'user', content: prompt }] }, 30000)
  const dt = performance.now() - t0
  if (res.model) setHudModel(res.model)
  setHudLatency(dt)
  if (!res.success) return { complete: true, confidence: 0, reason: 'Judge unavailable — trusting agent' }
  const m = res.content.match(/\{[\s\S]*\}/)
  if (!m) return { complete: true, confidence: 0, reason: 'No verdict returned' }
  try {
    const v = JSON.parse(m[0])
    return { complete: !!v.complete, confidence: Number(v.confidence) || 0, reason: String(v.reason || '') }
  } catch {
    return { complete: true, confidence: 0, reason: 'Verdict parse error' }
  }
}

// --- Step Planning (Point 1) ---
// Decompose the user's request into an ordered checklist of steps so the agent
// acts with a roadmap instead of blind one-off commands.
async function planMission(objective) {
  const prompt = `Break the following task into a short, ordered checklist of concrete browser steps an automation agent can execute one at a time.
Each step must be a single actionable item (navigate, click, type, extract, etc.). Output ONLY a JSON array of plain strings, no extra text.
Example: ["Go to supabase.com", "Open the project dashboard", "Find the database tables list", "Report the table names"]
Task: ${objective}`
  try {
    const res = await sendToBackground('AI_CHAT', { messages: [{ role: 'user', content: prompt }] }, 30000)
    if (!res.success) return []
    const m = res.content.match(/\[[\s\S]*\]/)
    if (!m) return []
    const arr = JSON.parse(m[0])
    if (!Array.isArray(arr)) return []
    return arr.map(s => String(s).replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean).slice(0, 12)
  } catch {
    return []
  }
}

async function renderPlan(objective, steps) {
  if (!steps.length) return
  const lines = steps.map((s, i) => `${i + 1}. ${escapeHtml(s)}`).join('\n')
  addMessage('assistant', `📋 **Plan for:** ${escapeHtml(objective)}\n${lines}`)
  scrollToBottom()
}

// --- Reflection (Point 3) ---
// After acting, the agent reflects: is the goal met, should it keep going,
// ask the USER a clarifying question, or ask ChatGPT (in the same thread) for
// more detail before continuing?
async function reflectProgress(context, pageState) {
  const planText = context.plan.length
    ? `\nPlan:\n${context.plan.map((s, i) => `${i + 1}. ${context.planDone.includes(i) ? '✅' : '⬜'} ${s}`).join('\n')}`
    : ''
  const prompt = `You are reflecting on an agent's progress toward a goal. Decide the next high-level move.
Objective: ${context.objective}
Completed actions: ${context.completedTasks.join(', ') || 'none'}
Last error: ${context.lastError || 'none'}
${planText}
Current page: ${pageState.url || 'unknown'} — ${pageState.title || ''}
${pageState.textSummary ? pageState.textSummary.slice(-1600) : ''}

Respond with ONLY JSON:
{"status": "continue" | "goal_met" | "ask_user" | "ask_chatgpt", "question": "the clarifying question to ask (only if ask_user/ask_chatgpt)", "reason": "one short sentence"}
- continue: goal not met, keep executing steps.
- goal_met: objective is fully satisfied — stop.
- ask_user: the request is ambiguous or you need info only the human has — ask them.
- ask_chatgpt: you are in a chat and need the assistant to clarify/expand — ask it in the same thread.`
  try {
    const res = await sendToBackground('AI_CHAT', { messages: [{ role: 'user', content: prompt }] }, 30000)
    if (!res.success) return { status: 'continue', reason: 'reflector unavailable' }
    const m = res.content.match(/\{[\s\S]*\}/)
    if (!m) return { status: 'continue', reason: 'no verdict' }
    const v = JSON.parse(m[0])
    return { status: String(v.status || 'continue'), question: String(v.question || ''), reason: String(v.reason || '') }
  } catch {
    return { status: 'continue', reason: 'reflect parse error' }
  }
}

// --- Recovery Engine ---

const RECOVERY_RULES = [
  { pattern: /not found|no element|no clickable/i, solution: 'RESCAN', explanation: 'Element not found. Call observe to refresh page state, then try again.' },
  { pattern: /synapse not active|content script not responding/i, solution: 'REFRESH', explanation: 'Extension inactive. Refresh the page.' },
  { pattern: /timeout|timed out/i, solution: 'WAIT', explanation: 'Operation timed out. Try again after waiting.' },
  { pattern: /net::err_|navigation failed|dns/i, solution: 'SKIP', explanation: 'Cannot reach this domain. Skip it.' },
  { pattern: /illegal invocation/i, solution: 'RETRY_SIMPLE', explanation: 'Browser API error. Retry with simpler approach.' },
]

function classifyError(error) {
  if (!error) return { solution: 'RETRY', explanation: 'Unknown error. Retry.' }
  for (const rule of RECOVERY_RULES) {
    if (rule.pattern.test(error)) return rule
  }
  return { solution: 'RETRY', explanation: 'Tool failed. Retry with different approach.' }
}

async function recover(error, action, context) {
  const cls = classifyError(error)
  let recovered = false
  if (cls.solution === 'REFRESH') {
    const refresh = await sendToBackground('BROWSER_TOOL', { tool: 'navigate_to', args: [context.url || 'about:blank'] }, TOOL_TIMEOUT)
    recovered = refresh.success
  }
  if (cls.solution === 'RESCAN') {
    // Switch to observe to get fresh page state, let next iteration replan
    action.type = 'observe'
    action.target = ''
    action.value = ''
    recovered = true
  }
  if (cls.solution === 'SKIP') {
    context.lastError = `Skipped domain: ${error}`
    recovered = true
  }
  if (cls.solution === 'RETRY' || cls.solution === 'RETRY_SIMPLE') {
    // Convert to simpler action
    if (action.type === 'click') {
      action.type = 'scroll'
      action.target = 'bottom'
    }
    recovered = true
  }
  return { recovered, message: cls.explanation, action }
}

// --- World Model Observer ---

async function observePage() {
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'observe_page', args: [] }, TOOL_TIMEOUT)
  if (!result.success) {
    return { url: '', title: '', loading: false, streaming: false, inputs: [], buttons: [], links: [], dialogs: [], errors: [result.error] }
  }
  try {
    return JSON.parse(result.result)
  } catch {
    return { url: '', title: '', loading: false, streaming: false, inputs: [], buttons: [], links: [], dialogs: [], errors: ['Failed to parse page state'] }
  }
}

// Poll until ChatGPT's response has fully generated: streaming has stopped AND
// the visible text has stabilized between observations. This guarantees we read
// the COMPLETE reply before the next action, rather than acting on a partial one.
async function waitForChatResponse(maxMs = 120000) {
  const start = Date.now()
  let lastText = ''
  let stable = 0
  while (Date.now() - start < maxMs) {
    await sleep(1500)
    const s = await observePage()
    if (!s.streaming && !s.loading) {
      const t = (s.textSummary || '').trim()
      if (t && t === lastText) {
        // Text stopped growing — may be a truncated ChatGPT reply with a
        // "Continue generating" button. Resume it once, then keep waiting.
        if (stable === 0) {
          try {
            const cont = await sendToBackground('TOOL_EXECUTE', { tool: 'find_and_click', args: ['Continue generating'] }, 8000)
            if (cont && cont.success) { lastText = ''; stable = 0; continue }
          } catch {}
        }
        if (++stable >= 2) return true
      } else {
        lastText = t
        stable = 0
      }
    } else {
      stable = 0
    }
  }
  return false
}

// --- Vision-Enhanced Page Observation ---
// Takes a screenshot and uses a vision-capable model to describe visible UI elements.
// Acts as a fallback when DOM observation returns empty or incomplete results.

async function observePageWithVision() {
  addMessage('system', '📸 Taking screenshot for vision analysis...')
  scrollToBottom()

  const screenshot = await sendToBackground('BROWSER_TOOL', { tool: 'capture_screenshot', args: [] }, TOOL_TIMEOUT)
  if (!screenshot.success || !screenshot.result) return null

  const base64 = screenshot.result.replace(/^data:image\/png;base64,/, '')
  const result = await sendToBackground('AI_VISION', {
    image: base64,
    prompt: `Analyze this webpage screenshot. Return a JSON object describing ALL interactive elements visible on the page. Include:
{
  "url": "inferred URL if visible",
  "title": "page title if visible in tab",
  "inputs": [ { "type": "text", "placeholder": "...", "enabled": true, "label": "...", "role": "textbox" } ],
  "buttons": [ { "text": "exact button text", "enabled": true, "type": "button" } ],
  "links": [ { "text": "link text", "href": "..." } ],
  "headings": [ { "tag": "h1", "text": "..." } ],
  "dialogs": [ { "role": "dialog", "text": "dialog title or text" } ],
  "loading": false,
  "streaming": false,
  "layout": "brief description of the page layout"
}
Use EXACT text labels as they appear on screen. Include ALL visible buttons, links, inputs, and form elements. If the page shows a chat interface, include the chat input as an input element with placeholder "Type a message" or similar. Be comprehensive. Return ONLY the JSON, no other text.`
  }, 120000)  // 2min timeout for vision model

  if (!result.success) {
    addMessage('system', `⚠️ Vision analysis failed: ${result.error}`)
    scrollToBottom()
    return null
  }

  try {
    // Strip markdown code fences if present
    const cleaned = result.content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const visionState = JSON.parse(cleaned)
    addMessage('system', `👁️ Vision found ${visionState.buttons?.length || 0} buttons, ${visionState.inputs?.length || 0} inputs, ${visionState.links?.length || 0} links`)
    scrollToBottom()
    return visionState
  } catch {
    addMessage('system', `⚠️ Could not parse vision result. Raw: ${result.content.slice(0, 200)}...`)
    scrollToBottom()
    return null
  }
}

// The generation instruction appended to any design brief. It tells ChatGPT to
// produce MANY separate files — one focused, single-subject design per service
// the company offers (plus a general brand piece) — and to NEVER cram several
// designs into one image. Each design becomes its own standalone PNG.
const DESIGN_GENERATION_INSTRUCTION = `Produce a SET of separate marketing designs as follows: create ONE distinct, standalone design for EACH product/service the company offers (for example: "Service A — social post", "Service B — flyer", "Service C — poster"), PLUS one general brand/awareness poster. CRITICAL RULE: each design must be a SINGLE focused image about ONE subject — do NOT put multiple different designs, a grid of images, or several logos into one picture. Make every design print- and presentation-ready (headline, body copy, CTA, contact placeholder). Save/generate each design as its OWN separate high-resolution PNG image — I will download them all individually.`

// Self-sufficient fallback brief used when the agent must nudge ChatGPT to
// actually GENERATE artwork but the user never supplied project details. It
// bundles reasonable default branding so ChatGPT stops re-asking "what's the
// company name?" and can produce the artwork.
const DESIGN_DEFAULT_BRIEF = `Here are the project details (use professional placeholder branding per the LX Obsidian Labs Brand & Visual Design Guide): Company: LX Obsidian Labs. Industry: Technology — software development, AI, automation, graphic design, cloud. Services offered: (1) Custom web & mobile app development, (2) AI/automation solutions, (3) Graphic design & branding. Target audience: startups, SMEs, and enterprises wanting digital transformation. Brand colours: Deep Obsidian Black #0B0B0F (primary) and Electric Blue #2E6BFF (accent), White #FFFFFF neutral. Preferred styles: Clean Corporate, Premium Modern, Bold Marketing. ${DESIGN_GENERATION_INSTRUCTION}`

// --- Autonomous Mission Loop ---

async function runAgentLoop(objective, initialUserMessage) {
  transition(AgentState.PLANNING)
  // Normalize objective to a string so downstream .toLowerCase()/template use never throws.
  agentContext.objective = objective == null ? '' : (typeof objective === 'string' ? objective : String(objective))
  agentContext.steps = 0
  agentContext.lastError = null
  agentContext.completedTasks = []
  agentContext.chatTurns = 0
  agentContext.mailActed = false
  loadMemory().then(m => { memoryCount = m.length })
  agentPaused = false
  agentStopRequested = false
  updateRunControls()
  transition(AgentState.EXECUTING)

  // --- Gather company/business details for tailored marketing designs ---
  // The user wants designs based on THEIR company's business and services, not
  // generic placeholders. If this is a design task and we don't yet have real
  // company details, ask the user (in the panel) and wait for their reply
  // instead of silently defaulting. Their reply becomes the next run's brief.
  const isDesignTask = /market|marketing|design|brand|poster|flyer|image|logo|graphic|social|advert|advertis/i.test(agentContext.objective)
  if (isDesignTask) {
    if (awaitingCompanyBrief && sessionCompanyBrief === null) {
      // The user just replied with their company details — capture and continue.
      sessionCompanyBrief = agentContext.objective
      awaitingCompanyBrief = false
      addMessage('system', '✅ Got your company details — heading to ChatGPT to generate the tailored, single-subject designs now.')
      scrollToBottom()
    } else if (sessionCompanyBrief === null) {
      const looksDetailed = agentContext.objective.length > 120 && /(company|business|service|product|sell|offer|we are|our |client|industry|brand)/i.test(agentContext.objective)
      if (looksDetailed) {
        sessionCompanyBrief = agentContext.objective
      } else {
        awaitingCompanyBrief = true
        addMessage('system', '🎯 To design marketing material based on YOUR company’s business and services, I need a few details first. Please reply in this chat with: (1) Company name, (2) the products/services you offer, (3) target audience, (4) any brand colours or logo. I’ll then create many separate, single-subject designs (one per service) and download each as its own file.')
        scrollToBottom()
        transition(AgentState.DONE)
        return 'needs-info'
      }
    }
  }

  // --- Plan at loop start (hardening: gives the agent a concrete checklist) ---
  // planMission is only called if we don't already have a plan; failures are
  // non-fatal (we just run unplanned).
  if (agentContext.plan.length === 0) {
    try {
      const steps = await planMission(agentContext.objective)
      if (steps.length) {
        agentContext.plan = steps
        renderPlan(agentContext.objective, steps)
      }
    } catch {}
  }

  let forcedFirstType = false  // guarantees we send the objective into a chat before looping on observe
  let consecutivePassive = 0    // tracks observe/wait/scroll in a row on a chat site (post first message)

  while (agentState !== AgentState.DONE && agentState !== AgentState.FAILED && agentContext.steps < agentContext.maxSteps) {
   try {
    // --- Stop / Pause controls ---
    if (agentStopRequested) {
      addMessage('system', '⏹ Run stopped by user.')
      scrollToBottom()
      transition(AgentState.DONE)
      break
    }
    if (agentPaused) {
      setHudAction('⏸ PAUSED — press Resume')
      while (agentPaused && !agentStopRequested) await sleep(250)
      if (agentStopRequested) {
        addMessage('system', '⏹ Run stopped by user.')
        scrollToBottom()
        transition(AgentState.DONE)
        break
      }
      setHudAction('▶ RESUMING…')
    }

    const stepNum = agentContext.steps + 1

    // --- Force strategy change if too many consecutive failures ---
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      addMessage('system', `⚠️ ${consecutiveFailures} failures — switching strategy`)
      scrollToBottom()
      await executeAction({ type: 'search', target: objective, value: '' })
      await new Promise(r => setTimeout(r, 1500))
      consecutiveFailures = 0; failedActions.clear(); actionHistory = []
      const freshPage = await observePage()
      agentContext.url = freshPage.url || ''
    }

    // 1. Observe
    transition(AgentState.WAITING)
    let pageState = await observePage()
    // Background context was reloaded (extension rebuilt) — stop cleanly
    // instead of spinning, and tell the user to reload the tab.
    if (Array.isArray(pageState.errors) && /context invalidated/i.test(pageState.errors.join(' '))) {
      addMessage('system', '🔌 Extension context was reloaded. Reload this tab (and reopen the side panel) to reconnect, then re-run the mission.')
      scrollToBottom()
      transition(AgentState.FAILED)
      break
    }
    lastStableUrl = pageState.url || lastStableUrl   // snapshot known-good state for rollback

    // Auto-dismiss dialogs
    if (pageState.dialogs?.length > 0) {
      const dismissResult = await executeAction({ type: 'dismiss', target: '', value: '' })
      if (dismissResult.success && dismissResult.result?.includes('Dismissed')) {
        pageState = await observePage()
      }
    }

    // Vision fallback
    if (!pageState.inputs?.length && !pageState.buttons?.length || pageState.errors?.length || agentContext.useVision) {
      const visionState = await observePageWithVision()
      if (visionState) {
        if (!pageState.inputs?.length) pageState.inputs = visionState.inputs || []
        if (!pageState.buttons?.length) pageState.buttons = visionState.buttons || []
        if (!pageState.links?.length) pageState.links = visionState.links || []
        if (!pageState.dialogs?.length) pageState.dialogs = visionState.dialogs || []
        if (!pageState.loading) pageState.loading = visionState.loading || false
        if (!pageState.streaming) pageState.streaming = visionState.streaming || false
        if (!pageState.url) pageState.url = visionState.url || ''
        if (!pageState.title) pageState.title = visionState.title || ''
        agentContext.useVision = true
      }
    }

    agentContext.url = pageState.url || agentContext.url
    agentContext.title = pageState.title || agentContext.title
    agentContext.isStreaming = pageState.streaming || false
    lastObservedState = pageState   // refresh composer/URL awareness for guards
    pushHudLog('OBSERVE', `${pageState.inputs?.length || 0} in · ${pageState.buttons?.length || 0} btn · ${pageState.links?.length || 0} lnk`, 'info')

    // 2. Plan
    transition(AgentState.PLANNING)
    setHudAction('⟢ COMPUTING NEXT ACTION…')
    await sleep(PLAN_DELAY_MS)
    let action = await planNextAction(pageState, agentContext)

    if (!action) {
      transition(AgentState.DONE)
      break
    }

    // --- State-transition check: break the redundant "New chat" loop ---
    // If the planner still wants to start a fresh chat while one is already
    // open (validated programmatically), override it: send the user's prompt
    // if we haven't yet, otherwise just keep observing the open conversation.
    {
      const chat = detectChatContext(pageState, agentContext)
      const isNewChat = action.type === 'click' && /new\s*(chat|conversation|thread)/.test((action.target || '').toLowerCase())
      if (isNewChat && chat.chatOpen) {
        if (!chat.promptSent && agentContext.objective) {
          addMessage('system', '🔁 State check: chat already open — overriding "New chat" to send your prompt.')
          scrollToBottom()
          action = { type: 'type', target: '', value: agentContext.objective }
        } else {
          addMessage('system', '🔁 State check: chat already open — skipping "New chat", continuing in current conversation.')
          scrollToBottom()
          action = { type: 'observe', target: '', value: '' }
        }
      }
    }

    // --- First-turn guard for chat/AI sites AND Facebook content posting ---
    // If we're on a chat site and have NOT yet sent the user's instruction
    // (chatTurns === 0), never spin on observe/wait/scroll. Force-send the full
    // objective into the composer so the conversation actually starts.
    // On Facebook, typing fills the "What's on your mind?" composer but does NOT
    // auto-post (auto-Enter is disabled for Facebook), so it's safe to force the
    // first type — the agent then reviews the draft and clicks "Post". This also
    // enforces TEXT-FIRST: the post copy is written into the composer before any
    // image/design step.
    const onFacebook = isFacebookUrl(agentContext.url)
    if ((isOnChatSite(agentContext.url) || onFacebook) && agentContext.chatTurns === 0 && !forcedFirstType && ['observe', 'wait', 'scroll'].includes(action.type)) {
      forcedFirstType = true
      if (onFacebook) {
        addMessage('system', '💡 Facebook detected with nothing posted yet — composing your post text into the composer now (review it, then click "Post").')
        scrollToBottom()
        action = { type: 'type', target: '', value: agentContext.objective }
      } else {
        addMessage('system', '💡 Chat site detected with nothing sent yet — sending your instruction into the composer now.')
        scrollToBottom()
        const firstBrief = sessionCompanyBrief
          ? sessionCompanyBrief + '\n\n' + DESIGN_GENERATION_INSTRUCTION
          : agentContext.objective
        action = { type: 'type', target: '', value: firstBrief }
      }
    }

    // --- First-turn guard for Gmail / mail tasks ---
    // If we're on Gmail and the objective is to read/manage email, never spin on
    // observe/wait/scroll — actually open/read the relevant thread. Only force
    // this for READ-intent objectives (so "compose/send" objectives are left to
    // the planner, which has the gmail tools + Gmail guide to act correctly).
    if (isGmailUrl(agentContext.url) && isMailTask(agentContext.objective) && !agentContext.mailActed) {
      const readIntent = /read|check|show|see|find|open|view|summar|latest|inbox|unread|what('?s| is| are)|who (sent|emailed)|any (new|email)|my mail/i.test(agentContext.objective || '')
      const mailQuery = (agentContext.objective.match(/from:[^\s]+|subject:[^\s]+|is:unread|label:[^\s]+|has:attachment/gi) || []).join(' ')
      if (readIntent && ['observe', 'wait', 'scroll'].includes(action.type)) {
        agentContext.mailActed = true
        addMessage('system', `📧 Gmail detected — reading your mail now${mailQuery ? ` (filter: ${mailQuery})` : ''}.`)
        scrollToBottom()
        action = { type: 'gmail', target: 'open', value: mailQuery }
      }
    }

    // --- Anti-stall guard for chat sites (after the first message) ---
    // Once we've sent something to the chat, if the planner keeps choosing
    // passive observe/wait/scroll instead of pushing the conversation forward,
    // stop spinning: if artwork is already on the page, DOWNLOAD it; otherwise
    // command ChatGPT to actually GENERATE the artwork (the user's explicit goal).
    // We NEVER fire this while ChatGPT is actively streaming/generating, so we
    // don't interrupt an in-progress image. The generate nudge includes a full
    // default brief so ChatGPT stops re-asking "what's the company name?" and
    // can actually produce the PNGs instead of looping on questions.
    if (isOnChatSite(agentContext.url) && agentContext.chatTurns > 0 && ['observe', 'wait', 'scroll'].includes(action.type)) {
      consecutivePassive++
      if (consecutivePassive >= 3 && !pageState.streaming && !pageState.loading) {
        consecutivePassive = 0
        const imgCount = pageState.imgCount || 0
        if (imgCount > 0) {
          addMessage('system', `💡 Chat stalled with ${imgCount} image(s) present — downloading them now.`)
          scrollToBottom()
          action = { type: 'download_image', target: 'all' }
        } else {
          addMessage('system', '💡 Chat stuck on questions — supplying the project brief and telling ChatGPT to generate the artwork now.')
          scrollToBottom()
          const pushBrief = sessionCompanyBrief
            ? sessionCompanyBrief + '\n\n' + DESIGN_GENERATION_INSTRUCTION
            : DESIGN_DEFAULT_BRIEF
          action = { type: 'type', target: '', value: pushBrief }
        }
      }
    } else {
      consecutivePassive = 0
    }

    if (action.type === 'done') {
      // Reflect BEFORE finalizing — catches ambiguity and lets the agent ask the
      // user for clarification instead of declaring false completion.
      try {
        const r = await reflectProgress(agentContext, pageState)
        if (r.status === 'ask_user' && r.question) {
          addMessage('assistant', `❓ I need clarification before I can finish: ${r.question}`)
          scrollToBottom()
          transition(AgentState.DONE)
          break
        }
      } catch {}
      const verdict = await verifyObjective(pageState, agentContext)
      if (verdict.complete && verdict.confidence >= 0.5) {
        transition(AgentState.DONE)
        break
      }
      addMessage('assistant', `🔍 Objective not complete yet (${Math.round(verdict.confidence * 100)}%): ${verdict.reason}. Continuing…`)
      scrollToBottom()
      agentContext.lastError = `Incomplete: ${verdict.reason}`
      await executeAction({ type: 'observe', target: '', value: '' })
      continue
    }

    // 3. Execute (with retry + rollback + corrective re-plan)
    transition(AgentState.EXECUTING)
    let stepLabel = `${action.type}${action.target ? ': ' + action.target : ''}${action.value ? ' = "' + action.value.slice(0, 40) + '"' : ''}`
    addMessage('assistant', `[${stepNum}/${agentContext.maxSteps}] 🎯 ${stepLabel}`)
    scrollToBottom()

    let result = null
    let actionToRun = action
    for (let retry = 0; retry <= MAX_ACTION_RETRIES; retry++) {
      const tag = retry > 0 ? ` (retry ${retry})` : ''
      setHudAction('▶ ' + stepLabel + tag)
      if (EXEC_DELAY_MS) await sleep(EXEC_DELAY_MS)
      result = await executeAction(actionToRun)
      recordAction(actionToRun.type, actionToRun.target, actionToRun.value, result.success, result.error)

      const msgEl = chatMessages?.lastElementChild
      if (result.success) {
        agentContext.lastError = null
        agentContext.completedTasks.push(`${actionToRun.type}${actionToRun.target ? ': ' + actionToRun.target : ''}`)
        if (msgEl) msgEl.textContent = `[${stepNum}/${agentContext.maxSteps}] ✅ ${stepLabel}${tag}`
        pushHudLog('EXEC', stepLabel + ' ✓', 'ok')
        break
      }

      // --- Failure: report, roll back, then re-plan a correction ---
      agentContext.lastError = `"${stepLabel}" failed: ${result.error}.`
      if (msgEl) msgEl.textContent = `[${stepNum}/${agentContext.maxSteps}] ❌ ${stepLabel}${tag} — ${result.error}`
        pushHudLog('EXEC', stepLabel + ' ✗ ' + (result.error || ''), 'err')
      consecutiveFailures++

      // If we just failed to send the objective into a chat composer, there's
      // no composer to type into (almost always: ChatGPT isn't logged in).
      // Tell the user instead of looping forever on the same failure.
      if (actionToRun.type === 'type' && agentContext.chatTurns === 0 && isOnChatSite(agentContext.url)) {
        addMessage('system', '⚠️ Could not send to the chat — no composer found. Log in to ChatGPT in this tab, then re-run the mission.')
        scrollToBottom()
        transition(AgentState.FAILED)
        break
      }

      // Rollback: if the failed action drifted the page, return to last known-good state
      const after = await observePage()
      if (lastStableUrl && after.url && after.url !== lastStableUrl && NAV_ACTIONS.has(actionToRun.type) && actionToRun.type !== 'back') {
        addMessage('system', `↩️ Rolling back to previous stable state…`)
        scrollToBottom()
        await executeAction({ type: 'back' })
        await sleep(900)
      }

      if (retry < MAX_ACTION_RETRIES) {
        // Corrective re-plan: ask the LLM for a DIFFERENT action given the error
        addMessage('assistant', `[${stepNum}] 🔁 Re-planning after failure: ${result.error}`)
        scrollToBottom()
        await executeAction({ type: 'observe', target: '', value: '' })
        const fresh = await observePage()
        lastStableUrl = fresh.url || lastStableUrl
        actionToRun = await planNextAction(fresh, { ...agentContext, lastError: result.error })
        if (!actionToRun || actionToRun.type === 'done') actionToRun = { type: 'observe', target: '', value: '' }
        stepLabel = `${actionToRun.type}${actionToRun.target ? ': ' + actionToRun.target : ''}${actionToRun.value ? ' = "' + actionToRun.value.slice(0, 40) + '"' : ''}`
      } else {
        // Exhausted retries — wipe blacklists so the next outer step can diverge
        failedActions.clear(); actionHistory = []
        addMessage('system', `⚠️ Gave up on step ${stepNum} after ${MAX_ACTION_RETRIES} retries — moving on.`)
        scrollToBottom()
      }
    }

    agentContext.steps++

    // 4. Streaming/loading poll (replace fixed wait)
    let isBusy = pageState.streaming || pageState.loading
    if (result.success && isBusy) {
      transition(AgentState.WAITING)
      setHudAction('⏳ AWAITING RESPONSE…')
      for (let w = 0; w < 20; w++) {
        addMessage('system', `[${stepNum}] ⏳ waiting... (${w * 0.5 + 0.5}s)`)
        scrollToBottom()
        await new Promise(r => setTimeout(r, 500))
        const check = await observePage()
        if (!check.streaming && !check.loading) break
      }
    }

    // If we just sent a message into a chat, deterministically wait for the FULL
    // response to finish streaming (don't rely on the LLM emitting "wait"). This
    // ensures we read ChatGPT's complete reply before the next action.
    if (result.success && actionToRun.type === 'type' && isOnChatSite(agentContext.url)) {
      transition(AgentState.WAITING)
      setHudAction('⏳ READING FULL RESPONSE…')
      await waitForChatResponse()
    }
   } catch (loopErr) {
    // A single failing step must never abort the whole mission. Surface the
    // REAL error (not a masked "AI service" message), record it, and let the
    // loop re-observe + re-plan on the next iteration instead of throwing.
    const msg = (loopErr && loopErr.message) ? loopErr.message : String(loopErr)
    console.error('[runAgentLoop] step error:', loopErr)
    agentContext.lastError = msg
    addMessage('assistant', `⚠️ Step error (recovered): ${msg}. Re-observing…`)
    scrollToBottom()
    try { await executeAction({ type: 'observe', target: '', value: '' }) } catch {}
    if (agentContext.steps >= agentContext.maxSteps - 1) {
      addMessage('system', `🛑 Stopping: step errors persisted. Last error: ${msg}`)
      scrollToBottom()
      break
    }
   }
  }

  // If the loop ended in failure (e.g. login required), respect that state
  // instead of mislabeling it as a successful completion.
  if (agentState === AgentState.FAILED) {
    // Reset run controls for next time (Pause label back to default, flags cleared).
    agentPaused = false
    const pb = $('agent-pause')
    if (pb) pb.textContent = '⏸ Pause'
    updateRunControls()
    await sleep(1200)
    transition(AgentState.IDLE)
    return 'failed'
  }

  if (agentContext.steps >= agentContext.maxSteps) {
    transition(AgentState.DONE)
  }

  const summary = `✅ **${objective}** — ${agentContext.steps} steps`
  addMessage('assistant', summary)
  scrollToBottom()
  // Self-learning: record what worked (fire-and-forget, doesn't block UI)
  const failed = agentContext.lastError
    ? agentContext.completedTasks.length
      ? `After partial progress (${agentContext.completedTasks.join(' | ')}), failed at: ${agentContext.lastError}`
      : `Failed before any progress: ${agentContext.lastError}`
    : ''
  recordLearning(objective, agentContext.url, agentContext.completedTasks.join(' | '), !agentContext.lastError, failed)
  setHudAction('✔ OBJECTIVE COMPLETE')
  transition(AgentState.DONE)
  // Reset run controls for next time (Pause label back to default, flags cleared).
  agentPaused = false
  const pb = $('agent-pause')
  if (pb) pb.textContent = '⏸ Pause'
  updateRunControls()
  await sleep(1700)
  transition(AgentState.IDLE)
  return 'success'
}

// --- DOM refs ---

const $ = (id) => document.getElementById(id)
const chatMessages = $('chat-messages')
const chatInput = $('chat-input')
const chatSend = $('chat-send')
const suggestions = $('suggestions')
const generatePrompt = $('generate-prompt')
const generateBtn = $('generate-btn')
const generateResult = $('generate-result')
const copyBtn = $('copy-btn')
const charCount = $('char-count')
const pageTypeLabel = $('page-type-label')
const pageTypePill = $('page-type-pill')
const pageDataName = $('page-data-name')

// --- Tab switching ---

// --- Self-learning: reset learned memory ---
$('memory-clear').addEventListener('click', async () => {
  if (!confirm('Wipe all learned memory? This cannot be undone.')) return
  await clearMemory()
  addMessage('system', '🧠 Learned memory wiped.')
  scrollToBottom()
})

// Click the learn-count to dump learned memory into the chat
$('hud-learn').addEventListener('click', async () => {
  const mem = await loadMemory()
  if (!mem.length) { addMessage('system', '🧠 No learned memory yet.'); scrollToBottom(); return }
  const ranked = memoryToText(mem, agentContext.objective, agentContext.url)
  addMessage('system', '🧠 **Learned memory**\n\n' + ranked)
  scrollToBottom()
})

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    $(`tab-${tab.dataset.tab}`).classList.add('active')
    if (tab.dataset.tab === 'memory') renderMemoryTab()
    if (tab.dataset.tab === 'settings') renderSettingsTab()
  })
})

// --- Memory tab controls ---
$('memory-refresh').addEventListener('click', () => renderMemoryTab())
$('memory-clear-2').addEventListener('click', async () => {
  if (!confirm('Wipe all learned memory? This cannot be undone.')) return
  await clearMemory()
})

// --- Settings tab ---
const SETTINGS_MODELS = [
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'z-ai/glm-5.2',
  'minimaxai/minimax-m3',
]
function renderSettingsTab() {
  // Reflect current theme in the settings theme picker
  const isLight = document.body.classList.contains('light')
  document.querySelectorAll('#set-theme .opt-btn').forEach((b) => {
    b.classList.toggle('active', (b.dataset.value === 'light') === isLight)
  })
  // Load saved API key override
  try {
    chrome.storage.local.get('synapse_api_key', (d) => {
      const el = $('set-apikey')
      if (el && d && d.synapse_api_key) el.value = d.synapse_api_key
    })
  } catch {}
  // Build model-list skeleton once
  const list = $('set-model-list')
  if (list && !list.children.length) {
    list.innerHTML = ''
    SETTINGS_MODELS.forEach((m) => {
      const row = document.createElement('div')
      row.className = 'model-item pending'
      row.dataset.model = m
      row.innerHTML = `<span class="model-dot"></span><span class="model-name">${m}</span><span class="model-state">idle</span>`
      list.appendChild(row)
    })
  }
}
function setApiKeyStatus(msg, kind) {
  const el = $('set-apikey-status')
  if (!el) return
  el.textContent = msg
  el.className = 'set-status ' + (kind || '')
}
$('set-apikey-save').addEventListener('click', () => {
  const v = ($('set-apikey').value || '').trim()
  try {
    if (v) chrome.storage.local.set({ synapse_api_key: v })
    else chrome.storage.local.remove('synapse_api_key')
    setApiKeyStatus(v ? '✓ API key saved on this device' : '✓ Using bundled key', 'ok')
  } catch (e) { setApiKeyStatus('Save failed: ' + e, 'err') }
})
$('set-test').addEventListener('click', async () => {
  const statusEl = $('set-test-status')
  if (statusEl) { statusEl.textContent = 'testing…'; statusEl.className = 'set-status warn' }
  const rows = Array.from(document.querySelectorAll('#set-model-list .model-item'))
  let anyOk = false
  for (const row of rows) {
    const m = row.dataset.model
    row.className = 'model-item pending'
    const st = row.querySelector('.model-state'); if (st) st.textContent = 'ping'
    try {
      const res = await sendToBackground('PING_AI', { model: m }, 25000)
      const ok = !!(res && res.success)
      if (ok) anyOk = true
      row.className = 'model-item ' + (ok ? 'ok' : 'err')
      const st2 = row.querySelector('.model-state'); if (st2) st2.textContent = ok ? 'live' : String(res?.error || 'down').slice(0, 22)
    } catch (e) {
      row.className = 'model-item err'
      const st2 = row.querySelector('.model-state'); if (st2) st2.textContent = 'error'
    }
  }
  if (statusEl) {
    statusEl.textContent = anyOk ? '✓ Connected to NVIDIA NIM' : '✗ No models reachable'
    statusEl.className = 'set-status ' + (anyOk ? 'ok' : 'err')
  }
})
// Settings appearance picker
document.querySelectorAll('#set-theme .opt-btn').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#set-theme .opt-btn').forEach((x) => x.classList.remove('active'))
    b.classList.add('active')
    const isLight = b.dataset.value === 'light'
    document.body.classList.toggle('light', isLight)
    localStorage.setItem('synapse-theme', isLight ? 'light' : 'dark')
    const tog = $('theme-toggle'); if (tog) tog.textContent = isLight ? '🌙' : '☀️'
  })
})

// --- Character count ---

generatePrompt.addEventListener('input', () => {
  charCount.textContent = generatePrompt.value.length
})

// --- Suggestion chips (chat) ---

suggestions.addEventListener('click', (e) => {
  const chip = e.target.closest('.suggestion-chip')
  if (!chip) return
  chatInput.value = chip.dataset.prompt
  chatInput.focus()
})

// --- Chat send ---

chatSend.addEventListener('click', () => sendChatMessage())
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChatMessage()
  }
})

// --- Agent run controls (Pause / Resume / Stop) ---
const pauseBtn = $('agent-pause')
const stopBtn = $('agent-stop')
if (pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    agentPaused = !agentPaused
    pauseBtn.textContent = agentPaused ? '▶ Resume' : '⏸ Pause'
  })
}
if (stopBtn) {
  stopBtn.addEventListener('click', () => {
    agentStopRequested = true
    agentPaused = false
    if (pauseBtn) pauseBtn.textContent = '⏸ Pause'
  })
}

// --- Enhance Prompt: turn a rough instruction into a reliable, detailed prompt ---
async function enhancePrompt() {
  const text = chatInput.value.trim()
  if (!text) return
  const btn = $('chat-enhance')
  if (!btn) return
  const orig = btn.textContent
  btn.disabled = true
  btn.textContent = '⏳...'
  try {
    const profile = loadProfile()
    let ctx = profile ? `\n\nUser/brand context (keep their intent & voice):\n${buildProfilePrompt(profile)}\n` : ''
    // Brand-aware: LX Obsidian Labs is the default brand the agent acts as.
    ctx += `\n\nDefault brand if none is set above: LX Obsidian Labs — premium technology company (software, AI, design, automation, cloud). Voice: modern, capable, engineering-led, globally trusted. The agent acts AS this brand by default.`

    // Task-type detection steers the enhancement toward the right system.
    const isDesign = /market|marketing|design|brand|poster|flyer|image|logo|graphic|advert|advertis/i.test(text)
    const isFb = isContentTask(text) || /facebook|instagram|post|reel|carousel|caption|social media|engage|followers/i.test(text)
    const isMail = isMailTask(text) || /gmail|email|inbox|compose|reply|forward|unread|archive|label/i.test(text)
    let taskGuide = ''
    if (isFb && !isDesign) {
      taskGuide = `\n\nThis is a FACEBOOK/SOCIAL CONTENT task. Enhance it into a TEXT-FIRST post plan that follows the LX Obsidian Labs Facebook Content Operating System: name the content pillar, write the ACTUAL post copy (hook + framework + CTA) as TEXT first (no images yet), state the best weekday/time slot, and end with a genuine discussion question. Stay on-brand and non-promotional (≈80% value / 20% promo).`
    } else if (isDesign) {
      taskGuide = `\n\nThis is a DESIGN/MARKETING task for LX Obsidian Labs. Enhance it to specify: the company + EACH service/product as its OWN single-subject design, the Obsidian Black + Electric Blue brand palette, bold clean sans-serif, premium-tech style, and the 3 variation archetypes (Clean Corporate / Premium Modern / Bold Marketing) — each its own PNG. One subject per image, never a grid/collage.`
    } else if (isMail) {
      taskGuide = `\n\nThis is a GMAIL / EMAIL task. Enhance it into a clear, executable email instruction: state the GOAL (read a specific email, summarize unread, send a reply, compose a new email, search, or organize), name any sender/subject/label filters, and define DONE WHEN (e.g. the right thread is open and read, or the email is sent/archived). Be specific about which mailbox action to take.`
    }

    const prompt = `You are an expert prompt engineer for Synapse, an autonomous browser-automation agent. Rewrite the user's rough instruction into a clear, reliable, detailed, self-contained prompt the agent can execute precisely.
Structure the improved prompt with these labelled sections:
- GOAL: one sentence stating the desired end state.
- CONTEXT: the site/area/brand involved.
- STEPS: the key actions in order (keep flexible — the agent plans the fine details).
- CONSTRAINTS: must / must-not rules, brand voice, format or length limits.
- DONE WHEN: how to recognise success.
Preserve the user's true intent. Be specific and unambiguous. Return ONLY the improved prompt — no quotes, no preamble, no commentary.${ctx}${taskGuide}

Original instruction:
${text}`
    const res = await sendToBackground('AI_CHAT', { messages: [{ role: 'user', content: prompt }] }, 30000)
    if (res.success && res.content.trim()) {
      chatInput.value = res.content.trim()
      chatInput.focus()
    }
  } catch { /* leave original text on failure */ }
  btn.disabled = false
  btn.textContent = orig
}
const chatEnhance = $('chat-enhance')
if (chatEnhance) chatEnhance.addEventListener('click', enhancePrompt)

async function sendChatMessage(programmaticText) {
  const text = programmaticText || chatInput.value.trim()
  if (!text || isGenerating) return


  chatInput.value = ''
  isGenerating = true
  chatSend.disabled = true

  addMessage('user', text)
  showTyping()
  scrollToBottom()

  try {
    let historyMessages = [...chatHistory]

    // If this is the first message and we have a profile, inject personality context
    if (historyMessages.length === 0) {
      const profile = loadProfile()
      if (profile) {
        const profileContext = `[Creator Context]\nI am a content creator. Here is my profile:\n${buildProfilePrompt(profile)}\n\nKeep responses aligned with my brand and audience.`
        historyMessages.push({ role: 'user', content: profileContext })
      }
    }

    // --- Mission Resume ---
    // Check for a saved mission with incomplete jobs
    const savedMission = loadMission()
    let currentMission = savedMission && !savedMission.complete ? savedMission : null
    if (currentMission) {
      const job = getCurrentJob(currentMission)
      if (job) {
        const jobCtx = `[MISSION JOB ${currentMission.currentJobIndex + 1}/${currentMission.jobs.length}]\nGoal: ${currentMission.goal}\nCurrent Task: ${job.label}\nURL: ${job.url || 'current page'}\nInstructions: ${job.instructions || 'Visit this page, extract the information, and report findings.'}\n\nPrevious completed: ${currentMission.jobs.filter(j => j.status === 'done').map(j => j.label).join(', ') || 'none'}\n\nComplete this task using browser tools. When done, provide the extracted information.`
        historyMessages.push({ role: 'user', content: jobCtx })
      }
    }

    // --- Use new Agent Engine instead of ReAct loop ---
    removeTyping()
    const agentResult = await runAgentLoop(text, text)
    if (agentResult === 'error') {
      addMessage('assistant', '⚠️ Mission encountered errors. Check details above.')
    }

    // --- Mission lifecycle (legacy job support) ---
    if (currentMission) {
      const job = getCurrentJob(currentMission)
      if (job) {
        advanceJob(currentMission, 'Mission completed', null)
        const s = missionSummary(currentMission)
        if (getCurrentJob(currentMission)) {
          addMessage('system', `✅ Completed: ${job.label}\n📊 Progress: ${s.progress}`)
          scrollToBottom()
          await new Promise(r => setTimeout(r, 1500))
          sendChatMessage(getCurrentJob(currentMission).label)
          return
        } else {
          addMessage('system', `🎉 **Mission Complete!**\nGoal: ${currentMission.goal}\nProgress: ${s.progress}\n✅ ${s.done} done, ${s.skipped} skipped`)
          clearMission()
          scrollToBottom()
        }
      }
    }

    // Normal chat history update
    chatHistory.push(
      { role: 'user', content: text },
      { role: 'assistant', content: `✅ Completed: ${text}` }
    )

    removeTyping()
  } catch (err) {
    removeTyping()
    const msg = (err && err.message) ? err.message : String(err)
    console.error('[sendChatMessage] fatal error:', err)
    addMessage('assistant', `⚠️ Error: ${msg || 'Could not reach the AI service'}`)
  }

  isGenerating = false
  chatSend.disabled = false
  scrollToBottom()
}

function parseToolCalls(content) {
  const calls = []
  const lines = content.split('\n')

  // Try JSON object format first: {"action": "name", "args": [...]}
  const jsonRegex = /{[\s\S]*?"action"\s*:\s*"(\w+)"[\s\S]*?}/
  const jsonMatch = content.match(jsonRegex)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.action) {
        calls.push({
          tool: parsed.action,
          args: Array.isArray(parsed.args) ? parsed.args.map(s => String(s).trim().replace(/^["']|["']$/g, '')) : [],
        })
        return calls
      }
    } catch {}
  }

  // Try JSON with single key: {"navigate_to": "url"} or {"click_element": "selector"}
  const jsonShortRegex = /{[\s\S]*?"(\w+)"\s*:\s*"([^"]+)"[\s\S]*?}/
  const jsonShortMatch = content.match(jsonShortRegex)
  if (jsonShortMatch) {
    try {
      const parsed = JSON.parse(jsonShortMatch[0])
      const keys = Object.keys(parsed)
      if (keys.length === 1 && typeof parsed[keys[0]] === 'string') {
        calls.push({ tool: keys[0], args: [parsed[keys[0]]] })
        return calls
      }
    } catch {}
  }

  // Try all bracket/variation formats:
  // [TOOL: name: args], (TOOL: name: args), ## TOOL: name: args, **TOOL:** name: args
  // Also handles missing closing bracket, or args split by | or ,
  const toolRegex = /(?:\[TOOL:|\(TOOL:|##\s*TOOL:|\*\*TOOL:\*\*|TOOL:)\s*(\w+)\s*(?::\s*(.*?))?(?:\]|\)|$)/gi
  let match
  while ((match = toolRegex.exec(content)) !== null) {
    const tool = match[1].toLowerCase()
    let args = []
    if (match[2]) {
      // Split by | or , (but not inside quoted strings)
      const raw = match[2].trim()
      args = raw.split(/\s*[|,]\s*/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    }
    if (tool) calls.push({ tool, args })
  }

  // If still nothing, try matching bare lines like "navigate_to: https://cursor.dev"
  if (calls.length === 0) {
    const bareRegex = /^[*-]?\s*(navigate_to|open_tab|switch_tab|close_tab|click_element|find_and_click|fill_input|simulate_typing|scroll_to_bottom|scroll_to_top|scroll_to_element|scroll_load_more|get_page_text|get_visible_text|observe_page|extract_images|extract_links|extract_video_sources|get_page_stats|wait|wait_until|list_tabs|list_downloads|download_url|highlight_elements|count_elements|full_page_scan|hide_element|post_to_facebook|extract_facebook_page_style|extract_visible_comments|get_page_hashtags|analyze_post_engagement|analyze_best_posting_time|copy_all_text|extract_page_niche_keywords|download_video_from_url)\s*:\s*(.+)/gim
    while ((match = bareRegex.exec(content)) !== null) {
      const tool = match[1].toLowerCase()
      let args = match[2].split(/\s*[|,]\s*/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      // If args is empty (tool with no args like wait: 2000), treat the whole value as one arg
      if (args.length === 0 && match[2]) args = [match[2].trim().replace(/^["']|["']$/g, '')]
      calls.push({ tool, args })
    }
  }

  return calls
}

function addMessage(role, content) {
  const msg = document.createElement('div')
  msg.className = `msg ${role}`
  const avatar = role === 'assistant' ? 'S' : 'You'
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  msg.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div>
      <div class="msg-bubble">${escapeHtml(content)}</div>
      <div class="msg-time">${time}</div>
    </div>
  `
  chatMessages.appendChild(msg)
}

function showTyping() {
  const div = document.createElement('div')
  div.className = 'typing-indicator'
  div.id = 'typing-indicator'
  div.innerHTML = '<span></span><span></span><span></span>'
  chatMessages.appendChild(div)
}

function removeTyping() {
  const el = $('typing-indicator')
  if (el) el.remove()
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight
}


// --- Generate: Tone & Length & Platform ---

let selectedTone = 'professional'
let selectedLength = 'medium'
let selectedPlatform = 'facebook'

// Per-platform generation rules: format, voice guidance, hashtag count, emoji use.
const PLATFORM_CONFIG = {
  facebook: {
    label: 'Facebook',
    format: 'a Facebook post',
    guidance: 'Write for Facebook: conversational and a little longer is fine; invite comments and discussion.',
    hashtags: 'Include exactly 3 relevant hashtags at the end — no more, no less.',
    emoji: 'Use relevant emojis sparingly.',
    postLabel: '📘 Post to Facebook',
    canPost: true,
  },
  twitter: {
    label: 'X (Twitter)',
    format: 'an X (Twitter) post',
    guidance: 'Write for X/Twitter: punchy and concise, under 280 characters, one sharp idea. No long paragraphs.',
    hashtags: 'Include at most 2 relevant hashtags.',
    emoji: 'Use at most one emoji.',
    postLabel: '📋 Copy X Post',
    canPost: false,
  },
  linkedin: {
    label: 'LinkedIn',
    format: 'a LinkedIn post',
    guidance: 'Write for LinkedIn: professional and insightful, use line breaks and a clear takeaway. Avoid emoji spam.',
    hashtags: 'Include exactly 3 relevant hashtags at the end.',
    emoji: 'Use emojis sparingly, only when they add value.',
    postLabel: '📋 Copy LinkedIn Post',
    canPost: false,
  },
  instagram: {
    label: 'Instagram',
    format: 'an Instagram caption',
    guidance: 'Write for Instagram: visual and engaging with a strong first line and a clear call-to-action.',
    hashtags: 'Include 5-10 relevant hashtags at the end, grouped together.',
    emoji: 'Emojis are welcome and encouraged.',
    postLabel: '📋 Copy Instagram Caption',
    canPost: false,
  },
  threads: {
    label: 'Threads',
    format: 'a Threads post',
    guidance: 'Write for Threads: casual and conversational, short and punchy like a text to a friend.',
    hashtags: 'Include 1-2 relevant hashtags at the end.',
    emoji: 'A few emojis are fine.',
    postLabel: '📋 Copy Threads Post',
    canPost: false,
  },
  generic: {
    label: 'Generic',
    format: 'a social media post',
    guidance: 'Write a versatile social media post that works across platforms.',
    hashtags: 'Include 2-3 relevant hashtags at the end.',
    emoji: 'Use emojis sparingly.',
    postLabel: '📋 Copy Post',
    canPost: false,
  },
}

document.querySelectorAll('#platform-options .opt-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#platform-options .opt-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedPlatform = btn.dataset.value
    const cfg = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook
    const pb = $('post-to-fb-btn')
    if (pb) pb.textContent = cfg.postLabel
    const gb = $('generate-btn')
    if (gb && !isGenerating) gb.textContent = '✨ Generate ' + cfg.label + ' Post'
  })
})

document.querySelectorAll('#tone-options .opt-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tone-options .opt-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedTone = btn.dataset.value
  })
})

document.querySelectorAll('#length-options .opt-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#length-options .opt-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
    selectedLength = btn.dataset.value
  })
})

// --- Generate ---

generateBtn.addEventListener('click', generateContent)
generatePrompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) return
  if (e.key === 'Enter') {
    e.preventDefault()
    generateContent()
  }
})

// Template chips (generate)
$('templates').addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  generatePrompt.value = btn.dataset.prompt
  charCount.textContent = generatePrompt.value.length
  generatePrompt.focus()
})

const LENGTH_GUIDE = {
  short: 'under 50 words',
  medium: 'around 100 words',
  long: 'around 200 words',
}

async function getPageStyleContext() {
  try {
    const pageData = await sendToBackground('EXTRACT_PAGE_DATA')
    const pageContext = pageData?.success ? `Current page: ${pageData.data.pageTitle}\nURL: ${pageData.data.url}` : ''

    const styleResult = await sendToBackground('TOOL_EXECUTE', { tool: 'extract_facebook_page_style', args: [] })
    const styleContext = styleResult?.success ? styleResult.result : ''

    return { pageContext, styleContext }
  } catch {
    return { pageContext: '', styleContext: '' }
  }
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(generateResult.textContent)
  copyBtn.textContent = '✅ Copied!'
  setTimeout(() => { copyBtn.textContent = '📋 Copy' }, 2000)
})

// --- Post to Facebook ---

$('post-to-fb-btn').addEventListener('click', async () => {
  const content = generateResult.textContent
  if (!content || content.startsWith('Error')) return

  const platform = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook
  const btn = $('post-to-fb-btn')
  btn.disabled = true

  // Facebook has a direct publisher; every other platform copies the post so
  // the user can paste it where they want (the agent loop can also post it).
  if (platform.canPost && selectedPlatform === 'facebook') {
    btn.textContent = '⏳ Posting...'
    try {
      const result = await sendToBackground('TOOL_EXECUTE', { tool: 'post_to_facebook', args: [content] })
      if (result.success) {
        btn.textContent = '✅ Posted!'
      } else {
        btn.textContent = '❌ ' + (result.error || 'Failed')
      }
    } catch {
      btn.textContent = '❌ Error'
    }
    setTimeout(() => { btn.textContent = platform.postLabel; btn.disabled = false }, 3000)
  } else {
    navigator.clipboard.writeText(content)
    btn.textContent = '✅ Copied!'
    setTimeout(() => { btn.textContent = platform.postLabel; btn.disabled = false }, 2000)
  }
})

// --- Content Remix ---

$('remix-bar').addEventListener('click', async (e) => {
  const btn = e.target.closest('.remix-btn')
  if (!btn || btn.disabled) return

  const original = generateResult.textContent
  if (!original || original.startsWith('Error') || original.startsWith('⏳')) return

  const angle = btn.dataset.angle
  const prevText = btn.textContent
  btn.textContent = '⏳...'
  btn.disabled = true

  const anglePrompts = {
    funnier: 'Rewrite this post to be FUNNIER. Add humor, wit, or a comedic twist while keeping the core message intact.',
    shorter: 'Condense this post to be SHORTER and more scannable. Keep the key message but cut fluff.',
    engaging: 'Rewrite to be MORE ENGAGING. Add a question, call-to-action, or controversial take to drive comments.',
    story: 'Rewrite as a STORY. Use narrative structure: setup, conflict, resolution. Make it personal and relatable.',
    hook: 'Rewrite with a STRONGER HOOK. The first line must grab attention immediately. Use curiosity, surprise, or bold statement.',
  }

  const instruction = anglePrompts[angle] || `Rewrite with a different angle: ${angle}`
  const profile = loadProfile()
  const profileBlock = profile ? `\n\nCreator profile:\n${buildProfilePrompt(profile)}` : ''
  const platform = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook

  const prompt = `I have a ${platform.label} post. ${instruction}\n\n${platform.emoji} ${platform.hashtags} Return only the rewritten post.\n\nOriginal post:\n${original}${profileBlock}`

  try {
    const response = await sendToBackground('AI_GENERATE', { prompt })
    if (response.success) {
      generateResult.textContent = response.content
      generateResult.classList.add('visible')
      scoreGeneratedPost(response.content, platform.label)
    } else {
      generateResult.textContent = original
    }
  } catch { /* keep original */ }

  btn.textContent = prevText
  btn.disabled = false
})

// --- Post Health Score ---

async function scoreGeneratedPost(content, platformLabel = 'Facebook') {
  const scoreDiv = $('health-score')
  if (!content || content.startsWith('Error') || content.startsWith('⏳')) {
    scoreDiv.classList.remove('visible')
    return
  }

  const prompt = `Evaluate this ${platformLabel} post and return a JSON object with these numeric scores (0-100):
- brandVoice: How well it sounds authentic and personal (not generic)
- engagement: How likely it is to get comments/shares
- hashtagQuality: Quality and relevance of hashtags (max 3)
- readability: How easy it is to read and scan
- overall: Overall quality score

Also return a brief summary string (max 100 chars) of what could be improved.

Response format (ONLY valid JSON, no other text):
{"brandVoice":85,"engagement":72,"hashtagQuality":90,"readability":88,"overall":83,"tip":"Add a stronger hook in the first line"}

Post to evaluate:
${content}`

  const response = await sendToBackground('AI_GENERATE', { prompt })
  if (!response.success) { scoreDiv.classList.remove('visible'); return }

  try {
    const cleaned = response.content.replace(/```json\s*|\s*```/g, '').trim()
    const scores = JSON.parse(cleaned)

    scoreDiv.classList.add('visible')
    const overall = scores.overall || 0
    const overallEl = $('hs-overall')
    overallEl.textContent = overall + '/100'
    overallEl.className = 'value ' + (overall >= 75 ? 'good' : overall >= 50 ? 'ok' : 'bad')

    const breakdown = $('hs-breakdown')
    const items = [
      { label: 'Brand Voice', key: 'brandVoice' },
      { label: 'Engagement', key: 'engagement' },
      { label: 'Hashtags', key: 'hashtagQuality' },
      { label: 'Readability', key: 'readability' },
    ]

    breakdown.innerHTML = items.map(item => {
      const val = scores[item.key] || 0
      const cls = val >= 70 ? 'good' : val >= 45 ? 'ok' : 'bad'
      return `<div class="score-row">
        <span class="bar-label">${item.label}</span>
        <div class="bar-bg"><div class="bar-fill ${cls}" style="width:${val}%"></div></div>
        <span class="bar-pct">${val}%</span>
      </div>`
    }).join('')

    if (scores.tip) {
      const tip = document.createElement('div')
      tip.style.cssText = 'font-size:10px;color:var(--text-secondary);margin-top:4px;padding-top:6px;border-top:1px solid var(--border);'
      tip.textContent = '💡 ' + scores.tip
      breakdown.appendChild(tip)
    }
  } catch { scoreDiv.classList.remove('visible') }
}

// Generate content for the currently selected platform (Facebook, X, LinkedIn,
// Instagram, Threads, Generic). Single source of truth — replaces the old
// duplicated generateContent definitions.
async function generateContent() {
  const prompt = generatePrompt.value.trim()
  if (!prompt || isGenerating) return

  const platform = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook

  isGenerating = true
  generateBtn.textContent = '⏳ Reading page context...'
  generateBtn.disabled = true
  generateResult.classList.remove('visible')
  generateResult.textContent = ''
  copyBtn.style.display = 'none'
  $('gen-actions').style.display = 'none'
  $('remix-bar').style.display = 'none'
  $('health-score').classList.remove('visible')

  generateBtn.textContent = '⏳ Analyzing your brand...'

  const { pageContext, styleContext } = await getPageStyleContext()
  const profile = loadProfile()

  generateBtn.textContent = '⏳ Generating ' + platform.label + ' content...'

  const tonePrompt = `Write in a ${selectedTone} tone.`
  const lengthPrompt = `Keep the post ${LENGTH_GUIDE[selectedLength]}.`

  const styleBlock = styleContext
    ? `\n\n## Page Context\n${pageContext}\n\n## Page Style Reference\nHere are the page's existing posts and description to match the style:\n${styleContext}`
    : ''

  const personalityBlock = profile
    ? `\n\n## Creator Personality Profile\nYou are generating content for this specific creator. Stay 100% true to their brand:\n${buildProfilePrompt(profile)}\n\nIMPORTANT: Match their voice, stay in their niche, and write for their specific audience.`
    : ''

  const enhancedPrompt = `Create ${platform.format} matching the page's style and voice.\n\nUser request: ${prompt}\n\n${tonePrompt} ${lengthPrompt} ${platform.guidance} ${platform.emoji} ${platform.hashtags} Return only the post content.${styleBlock}${personalityBlock}`

  try {
    const response = await sendToBackground('AI_GENERATE', { prompt: enhancedPrompt })
    if (response.success) {
      generateResult.textContent = response.content
      generateResult.classList.add('visible')
      copyBtn.style.display = 'inline-block'
      $('gen-actions').style.display = 'flex'
      $('remix-bar').style.display = 'flex'
      $('post-to-fb-btn').textContent = platform.postLabel
      scoreGeneratedPost(response.content, platform.label)
    } else {
      generateResult.textContent = 'Error: ' + (response.error || 'Generation failed')
      generateResult.classList.add('visible')
    }
  } catch (err) {
    generateResult.textContent = 'Error: Could not reach the AI service'
    generateResult.classList.add('visible')
  }

  isGenerating = false
  generateBtn.textContent = '✨ Generate ' + platform.label + ' Post'
  generateBtn.disabled = false
}

// --- Content Creator Tab: Smart Reply ---

$('cr-extract-comments').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const btn = $('cr-extract-comments')
  const resultDiv = $('cr-comments-result')
  const replyAllBtn = $('cr-reply-all')

  btn.textContent = '⏳ Extracting...'
  btn.disabled = true
  resultDiv.style.display = 'none'
  replyAllBtn.style.display = 'none'

  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'extract_visible_comments', args: [] })
  if (result.success) {
    resultDiv.textContent = result.result
    resultDiv.classList.add('visible')
    resultDiv.style.display = 'block'
    replyAllBtn.style.display = 'inline-block'
    replyAllBtn.dataset.comments = result.result
  } else {
    resultDiv.textContent = '❌ ' + (result.error || 'Failed')
    resultDiv.classList.add('visible')
    resultDiv.style.display = 'block'
  }

  btn.textContent = '📥 Extract Comments'
  btn.disabled = false
})

$('cr-reply-all').addEventListener('click', async () => {
  const replyBtn = $('cr-reply-all')
  const resultDiv = $('cr-comments-result')
  const raw = replyBtn.dataset.comments || resultDiv.textContent || ''

  const lines = raw.split('\n').filter(l => l.includes(':') && l.length > 20).slice(0, 10)
  if (lines.length === 0) return

  replyBtn.textContent = '⏳ Generating replies...'
  replyBtn.disabled = true

  const profile = loadProfile()
  const voiceGuide = profile
    ? `Reply in the creator's brand voice (${profile.voice || 'casual'}) for their ${profile.category || 'content'} page. Match their style and tone exactly.`
    : `Reply in a friendly, authentic brand voice that matches the page's style.`

  const prompt = `The following are comments from my Facebook page. For each comment, generate a short, authentic reply that sounds like the page owner wrote it personally. ${voiceGuide}

Return them as a numbered list with the original comment first, then my reply. Keep replies under 3 sentences each.

Comments:\n\n${lines.join('\n\n')}`

  const response = await sendToBackground('AI_GENERATE', { prompt })

  if (response.success) {
    resultDiv.textContent = response.content
    resultDiv.classList.add('visible')
    resultDiv.style.display = 'block'
  } else {
    resultDiv.textContent = '❌ ' + (response.error || 'Failed to generate replies')
    resultDiv.classList.add('visible')
    resultDiv.style.display = 'block'
  }

  replyBtn.textContent = '🤖 Reply to All'
  replyBtn.disabled = false
})

// --- Hashtag Research ---

$('cr-extract-hashtags').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const btn = $('cr-extract-hashtags')
  const resultDiv = $('cr-hashtags-result')

  btn.textContent = '⏳ Extracting...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'get_page_hashtags', args: [] })
  resultDiv.textContent = result.success ? result.result : ('❌ ' + (result.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'

  btn.textContent = '🔍 Extract Hashtags'
  btn.disabled = false
})

$('cr-suggest-hashtags').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const topic = $('cr-hashtag-topic').value.trim()
  const resultDiv = $('cr-hashtags-result')

  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'get_page_hashtag_suggestions', args: topic ? [topic] : [] })
  resultDiv.textContent = result.success ? result.result : ('❌ ' + (result.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'
})

$('cr-hashtag-topic').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('cr-suggest-hashtags').click() }
})

// --- Post Analyzer ---

$('cr-analyze-posts').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const btn = $('cr-analyze-posts')
  const resultDiv = $('cr-analyze-result')

  btn.textContent = '⏳ Analyzing...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'analyze_post_engagement', args: [] })
  resultDiv.textContent = result.success ? result.result : ('❌ ' + (result.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'

  btn.textContent = '📈 Analyze Posts'
  btn.disabled = false
})

// --- Content Repurpose ---

$('cr-repurpose-btn').addEventListener('click', async () => {
  const content = $('cr-repurpose-input').value.trim()
  const platform = $('cr-repurpose-platform').value
  const resultDiv = $('cr-repurpose-result')

  if (!content) return

  const btn = $('cr-repurpose-btn')
  btn.textContent = '⏳ Adapting...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  const profile = loadProfile()
  const voiceBlock = profile ? ` Keep the same brand voice (${profile.voice || 'casual'}) and stay true to the creator's ${profile.category || ''} niche.` : ''

  const prompt = `Rewrite the following content for ${platform}. Adapt the tone, length, and format to match ${platform}'s style:
- LinkedIn: professional, longer, industry-focused
- Instagram: casual, visual, hashtag-heavy, 5-10 hashtags
- Twitter/X: concise, punchy, under 280 chars
- Threads: conversational, casual
- TikTok: short, energetic, trend-aware

Return ONLY the adapted post content, no explanations.${voiceBlock}

Original content:
${content}`

  const response = await sendToBackground('AI_GENERATE', { prompt })
  resultDiv.textContent = response.success ? response.content : ('❌ ' + (response.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'

  btn.textContent = '🔄 Adapt'
  btn.disabled = false
})

$('cr-repurpose-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) return
  if (e.key === 'Enter') { e.preventDefault(); $('cr-repurpose-btn').click() }
})

// --- Content Ideas Generator ---

$('cr-ideas').addEventListener('click', async () => {
  const btn = $('cr-ideas')
  const resultDiv = $('cr-ideas-result')

  btn.textContent = '⏳ Reading page...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  let nicheContext = ''

  if (onPage) {
    const nicheResult = await sendToBackground('TOOL_EXECUTE', { tool: 'extract_page_niche_keywords', args: [] })
    if (nicheResult.success) nicheContext = nicheResult.result

    const pageData = await sendToBackground('EXTRACT_PAGE_DATA')
    if (pageData?.success) {
      nicheContext += `\n\nPage: ${pageData.data.pageTitle}\nURL: ${pageData.data.url}`
    }
  }

  const profile = loadProfile()
  const platform = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook
  const profileBlock = profile ? `\n\nCreator profile to align with:\n${buildProfilePrompt(profile)}\n\nTailor ALL ideas to this creator's specific niche, voice, and audience.` : ''

  btn.textContent = '⏳ Generating ideas...'

  const contextBlock = nicheContext ? `\n\nPage context:\n${nicheContext}` : ''
  const prompt = `Generate 10 creative, engaging ${platform.label} post ideas for a content creator. Each idea should include the post concept and a brief description. Make them varied: some educational, some entertaining, some engagement-driving, some promotional. Focus on ideas that will resonate with the creator's specific audience and match their brand voice. Return as a numbered list with emoji for each.${contextBlock}${profileBlock}`

  const response = await sendToBackground('AI_GENERATE', { prompt })
  resultDiv.textContent = response.success ? response.content : ('❌ ' + (response.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'

  btn.textContent = '✨ Generate 10 Ideas'
  btn.disabled = false
})

// --- Best Time to Post ---

$('cr-best-time').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const btn = $('cr-best-time')
  const resultDiv = $('cr-best-time-result')

  btn.textContent = '⏳ Analyzing...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'analyze_best_posting_time', args: [] })
  resultDiv.textContent = result.success ? result.result : ('❌ ' + (result.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'

  btn.textContent = '📈 Analyze Timing'
  btn.disabled = false
})

// --- Post Draft Manager ---

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem('synapse-drafts') || '[]') } catch { return [] }
}

function saveDrafts(drafts) {
  localStorage.setItem('synapse-drafts', JSON.stringify(drafts))
}

function updateDraftUI() {
  const drafts = loadDrafts()
  $('cr-draft-count').textContent = drafts.length
  $('cr-export-drafts').style.display = drafts.length > 0 ? 'inline-block' : 'none'
  $('cr-clear-drafts').style.display = drafts.length > 0 ? 'inline-block' : 'none'
}

// Show save draft button when there's generated content
const generateResultObserver = new MutationObserver(() => {
  const text = generateResult.textContent
  if (text && !text.startsWith('Error') && !text.startsWith('⏳')) {
    $('cr-save-draft').style.display = 'inline-block'
  } else {
    $('cr-save-draft').style.display = 'none'
  }
})
if (generateResult) generateResultObserver.observe(generateResult, { childList: true, subtree: true, characterData: true })

$('cr-save-draft').addEventListener('click', () => {
  const content = generateResult.textContent
  if (!content || content.startsWith('Error')) return

  const drafts = loadDrafts()
  drafts.unshift({
    id: Date.now(),
    content,
    savedAt: new Date().toISOString(),
    tone: selectedTone,
    length: selectedLength,
  })
  saveDrafts(drafts)
  updateDraftUI()
  $('cr-save-draft').textContent = '✅ Saved!'
  setTimeout(() => { $('cr-save-draft').textContent = '💾 Save Current as Draft' }, 2000)
})

$('cr-view-drafts').addEventListener('click', () => {
  const drafts = loadDrafts()
  const resultDiv = $('cr-drafts-result')

  if (drafts.length === 0) {
    resultDiv.textContent = 'No drafts saved yet. Generate a post and click "Save Current as Draft".'
    resultDiv.classList.add('visible')
    resultDiv.style.display = 'block'
    return
  }

  resultDiv.textContent = drafts.map((d, i) =>
    `📝 Draft #${i + 1} — ${new Date(d.savedAt).toLocaleDateString()} ${new Date(d.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n${d.content.slice(0, 200)}${d.content.length > 200 ? '...' : ''}`
  ).join('\n\n---\n\n')

  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'
})

$('cr-export-drafts').addEventListener('click', () => {
  const drafts = loadDrafts()
  const text = drafts.map((d, i) =>
    `=== Draft #${i + 1} ===\nSaved: ${d.savedAt}\n${d.content}\n`
  ).join('\n')
  navigator.clipboard.writeText(text)
  $('cr-export-drafts').textContent = '✅ Exported!'
  setTimeout(() => { $('cr-export-drafts').textContent = '📤 Export' }, 2000)
})

$('cr-clear-drafts').addEventListener('click', () => {
  if (confirm('Delete all saved drafts?')) {
    saveDrafts([])
    updateDraftUI()
    $('cr-drafts-result').textContent = 'All drafts cleared.'
    $('cr-drafts-result').classList.add('visible')
    $('cr-drafts-result').style.display = 'block'
  }
})

// --- Swipe File ---

function loadSwipeFile() {
  try { return JSON.parse(localStorage.getItem('synapse-swipe') || '[]') } catch { return [] }
}

function saveSwipeFile(items) {
  localStorage.setItem('synapse-swipe', JSON.stringify(items))
}

function updateSwipeUI() {
  const items = loadSwipeFile()
  $('cr-swipe-count').textContent = items.length
  $('cr-export-swipe').style.display = items.length > 0 ? 'inline-block' : 'none'
}

$('cr-save-post').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const btn = $('cr-save-post')
  btn.textContent = '⏳ Saving...'
  btn.disabled = true

  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'extract_single_post', args: ['1'] })
  if (result.success) {
    const items = loadSwipeFile()
    items.unshift({
      id: Date.now(),
      content: result.result,
      url: window.location.href,
      savedAt: new Date().toISOString(),
    })
    saveSwipeFile(items)
    updateSwipeUI()
    btn.textContent = '✅ Saved!'
  } else {
    btn.textContent = '❌ No post found'
  }
  setTimeout(() => { btn.textContent = '📥 Save Current Post'; btn.disabled = false }, 2000)
})

$('cr-view-swipe').addEventListener('click', () => {
  const items = loadSwipeFile()
  const resultDiv = $('cr-swipe-result')

  if (items.length === 0) {
    resultDiv.textContent = 'No saved posts yet. Go to any page and click "Save Current Post".'
    resultDiv.classList.add('visible')
    resultDiv.style.display = 'block'
    return
  }

  resultDiv.textContent = items.map((item, i) =>
    `📌 #${i + 1} — ${new Date(item.savedAt).toLocaleDateString()}\n${item.content.slice(0, 300)}${item.content.length > 300 ? '...' : ''}`
  ).join('\n\n---\n\n')

  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'
})

$('cr-export-swipe').addEventListener('click', () => {
  const items = loadSwipeFile()
  const text = items.map((item, i) =>
    `=== Inspiration #${i + 1} ===\nSaved: ${item.savedAt}\nURL: ${item.url}\n${item.content}\n`
  ).join('\n')
  navigator.clipboard.writeText(text)
  $('cr-export-swipe').textContent = '✅ Exported!'
  setTimeout(() => { $('cr-export-swipe').textContent = '📤 Export' }, 2000)
})

// --- Hook Generator ---

$('cr-hook-gen').addEventListener('click', async () => {
  const topic = $('cr-hook-topic').value.trim()
  const resultDiv = $('cr-hook-result')
  if (!topic) return

  const btn = $('cr-hook-gen')
  btn.textContent = '⏳ Generating hooks...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  const profile = loadProfile()
  const platform = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook
  const profileBlock = profile ? `\n\nCreator context — write hooks that match this brand:\n${buildProfilePrompt(profile)}` : ''

  const prompt = `Generate 10 attention-grabbing hooks for a ${platform.label} post about: "${topic}"

Each hook must:
- Be under 15 words
- Make the reader want to click/comment
- Be varied in style (question, bold statement, curiosity gap, relatable, controversial, statistic, story opener, humor, shock, benefit-driven)

Return as a numbered list with each hook on its own line. Just the hooks, no explanations.${profileBlock}`

  const response = await sendToBackground('AI_GENERATE', { prompt })

  if (response.success) {
    const hooks = response.content.split('\n').filter(l => l.trim() && /^\d/.test(l.trim()))
    const formatted = hooks.map((h, i) => `<div class="hook-item"><span class="num">#${i + 1}</span>${h.replace(/^\d+[\.\)]\s*/, '')}</div>`).join('')
    resultDiv.innerHTML = formatted || response.content
  } else {
    resultDiv.textContent = '❌ ' + (response.error || 'Failed')
  }

  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'
  btn.textContent = '🎣 Generate Hooks'
  btn.disabled = false
})

$('cr-hook-topic').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('cr-hook-gen').click() }
})

// --- Content Series Planner ---

$('cr-series-plan').addEventListener('click', async () => {
  const theme = $('cr-series-theme').value.trim()
  const days = parseInt($('cr-series-days').value) || 5
  const resultDiv = $('cr-series-result')
  if (!theme) return

  const btn = $('cr-series-plan')
  btn.textContent = '⏳ Planning series...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  const profile = loadProfile()
  const platform = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook
  const profileBlock = profile ? `\n\nCreator profile to match:\n${buildProfilePrompt(profile)}` : ''

  const prompt = `Create a ${days}-day content series plan for ${platform.label} about: "${theme}"

For each day, provide:
- Day number and title
- Post concept (2-3 sentences)
- Engagement hook (how to get comments)

Format each day as:
📅 Day 1: [Title]
Concept: [2-3 sentence description]
Hook: [engagement-driving question or CTA]

Make the series flow logically — each day builds on the previous. End with a strong finale. Use emojis. Keep each day's description under 80 words.${profileBlock}`

  const response = await sendToBackground('AI_GENERATE', { prompt })

  resultDiv.textContent = response.success ? response.content : ('❌ ' + (response.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'

  btn.textContent = '📅 Plan Series'
  btn.disabled = false
})

$('cr-series-theme').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('cr-series-plan').click() }
})

// --- Multi-Platform Export ---

$('cr-multi-export').addEventListener('click', async () => {
  const content = $('cr-multi-input').value.trim()
  const resultDiv = $('cr-multi-result')
  if (!content) return

  const btn = $('cr-multi-export')
  btn.textContent = '⏳ Exporting...'
  btn.disabled = true
  resultDiv.style.display = 'none'

  const profile = loadProfile()
  const platform = PLATFORM_CONFIG[selectedPlatform] || PLATFORM_CONFIG.facebook
  const profileBlock = profile ? `\n\nCreator profile — keep the same brand voice across platforms:\n${buildProfilePrompt(profile)}` : ''

  const prompt = `Take this ${platform.label} post and adapt it for each platform below. Keep the core message but adjust tone, length, and format:

Original post:
${content}

For each platform, provide the adapted version with a header:

🌐 LinkedIn (professional, detailed, industry insights):
[adapted version]

📸 Instagram (casual, visual-focused, hashtag-heavy, max 3 hashtags):
[adapted version]

🐦 X / Twitter (concise, punchy, under 280 chars):
[adapted version]

🧵 Threads (conversational, casual, personal):
[adapted version]

🎵 TikTok (short, energetic, trend-aware, hook-first):
[adapted version]

Keep the brand voice consistent across all platforms.${profileBlock}`

  const response = await sendToBackground('AI_GENERATE', { prompt })

  resultDiv.textContent = response.success ? response.content : ('❌ ' + (response.error || 'Failed'))
  resultDiv.classList.add('visible')
  resultDiv.style.display = 'block'

  btn.textContent = '🌐 Export to All Platforms'
  btn.disabled = false
})

$('cr-multi-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) return
  if (e.key === 'Enter') { e.preventDefault(); $('cr-multi-export').click() }
})

// --- Shared: make every Content Creator result copiable ---
// Each result block gets a floating "📋" button (CSS hides it until hover) that
// copies the result text to the clipboard. A MutationObserver re-attaches the
// button whenever a tool overwrites the result (textContent/innerHTML would
// otherwise wipe it). Centralizes copy UX across all Content Creator tools.
function makeCopiable(div) {
  if (!div || div.dataset.copiable) return
  div.dataset.copiable = '1'
  const btn = document.createElement('button')
  btn.className = 'copy-float'
  btn.type = 'button'
  btn.textContent = '📋'
  btn.title = 'Copy result'
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const text = div.textContent.replace(/📋/g, '').replace(/✅/g, '').trim()
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✅'
      btn.classList.add('copied')
      setTimeout(() => { btn.textContent = '📋'; btn.classList.remove('copied') }, 1500)
    })
  })
  div.appendChild(btn)
  const obs = new MutationObserver(() => { if (!div.contains(btn)) div.appendChild(btn) })
  obs.observe(div, { childList: true })
}
document.querySelectorAll('#tab-content .generated-output').forEach(makeCopiable)

// --- Creator Profile ---

const PROFILE_KEY = 'synapse-creator-profile'
const ONBOARDED_KEY = 'synapse-onboarded'

const CATEGORY_ICONS = {
  comedy: '😂', education: '📚', lifestyle: '🌴', entertainment: '🎬',
  music: '🎵', tech: '💻', business: '💼', sports: '🏀', art: '🎨', other: '✨',
}

const VOICE_ICONS = {
  funny: '😂', professional: '💼', casual: '👋', inspirational: '🌟',
  educational: '📖', energetic: '⚡',
}

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveProfile(profile) {
  profile.updatedAt = new Date().toISOString()
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  localStorage.setItem(ONBOARDED_KEY, 'true')
}

function clearProfile() {
  localStorage.removeItem(PROFILE_KEY)
  localStorage.removeItem(ONBOARDED_KEY)
}

function isOnboarded() {
  return localStorage.getItem(ONBOARDED_KEY) === 'true' && loadProfile() !== null
}

function buildProfilePrompt(profile) {
  if (!profile) return ''
  const category = profile.category || 'content creator'
  const voice = profile.voice || 'casual'
  return [
    `Page: ${profile.name || 'My Page'}`,
    `Category: ${category}`,
    `Brand voice: ${voice}`,
    profile.audience ? `Target audience: ${profile.audience}` : '',
    profile.goals ? `Content goals: ${profile.goals}` : '',
    profile.themes ? `Core themes: ${profile.themes}` : '',
    profile.avoid ? `Avoid: ${profile.avoid}` : '',
    profile.frequency ? `Posting frequency: ${profile.frequency}` : '',
    profile.styleAnalysis ? `\nPage style analysis:\n${profile.styleAnalysis}` : '',
  ].filter(Boolean).join('\n')
}

function updateProfileBar() {
  const bar = $('profile-bar')
  const profile = loadProfile()
  if (!profile) { bar.style.display = 'none'; return }

  bar.style.display = 'flex'
  $('prof-name').textContent = profile.name || 'Creator'
  const cat = profile.category || ''
  const icon = CATEGORY_ICONS[cat] || '✨'
  $('prof-avatar').textContent = (profile.name || 'S')[0].toUpperCase()
  $('prof-tag').textContent = (icon + ' ' + cat.charAt(0).toUpperCase() + cat.slice(1)).trim()
}

$('prof-edit').addEventListener('click', () => {
  clearProfile()
  localStorage.removeItem('synapse-scan-done')
  showOnboarding()
})

// --- Onboarding ---

function showOnboarding() {
  const overlay = $('onboarding')
  if (!overlay) return
  overlay.classList.remove('hidden')

  // Reset all steps
  document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('#ob-steps .dot').forEach(d => { d.className = 'dot' })
  document.querySelector('.onboarding-step[data-step="0"]').classList.add('active')
  document.querySelector('#ob-steps .dot:first-child').classList.add('active')

  currentStep = 0
  $('ob-back').style.display = 'none'
  $('ob-next').style.display = 'inline-block'
  $('ob-finish').style.display = 'none'
  $('ob-skip').style.display = 'inline-block'

  // Clear selection on opt groups
  document.querySelectorAll('#ob-category .opt-btn').forEach(b => b.classList.remove('selected'))
  document.querySelectorAll('#ob-voice .opt-btn').forEach(b => b.classList.remove('selected'))
  document.querySelectorAll('#ob-goals .opt-btn').forEach(b => b.classList.remove('selected'))
  document.querySelectorAll('#ob-frequency .opt-btn').forEach(b => b.classList.remove('selected'))
}

function hideOnboarding() {
  $('onboarding').classList.add('hidden')
  updateProfileBar()
  // If profile exists, enable full features
  if (isOnboarded()) {
    // Refresh page data after onboarding
    requestPageData()
  }
}

let currentStep = 0
const TOTAL_STEPS = 5

function goToStep(step) {
  document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('#ob-steps .dot').forEach((d, i) => {
    d.className = i < step ? 'dot done' : (i === step ? 'dot active' : 'dot')
  })
  document.querySelector(`.onboarding-step[data-step="${step}"]`).classList.add('active')
  currentStep = step

  $('ob-back').style.display = step === 0 ? 'none' : 'inline-block'
  $('ob-next').style.display = step < TOTAL_STEPS - 1 ? 'inline-block' : 'none'
  $('ob-finish').style.display = step === TOTAL_STEPS - 1 ? 'inline-block' : 'none'

  // Update summary on last step
  if (step === TOTAL_STEPS - 1) updateOnboardingSummary()
}

function updateOnboardingSummary() {
  const name = $('ob-name').value.trim() || 'My Page'
  const cat = document.querySelector('#ob-category .opt-btn.selected')?.dataset.value || 'content'
  const voice = document.querySelector('#ob-voice .opt-btn.selected')?.dataset.value || 'unique'
  const audience = $('ob-audience').value.trim() || 'Not specified'
  const goals = document.querySelector('#ob-goals .opt-btn.selected')?.dataset.value || 'Not specified'
  const themes = $('ob-themes').value.trim() || 'Not specified'
  const frequency = document.querySelector('#ob-frequency .opt-btn.selected')?.dataset.value || 'Not specified'
  const avoid = $('ob-avoid').value.trim() || 'None'

  $('ob-summary').innerHTML = `
    <strong>Page:</strong> ${name}<br>
    <strong>Category:</strong> ${cat}<br>
    <strong>Voice:</strong> ${voice}<br>
    <strong>Audience:</strong> ${audience}<br>
    <strong>Goals:</strong> ${goals}<br>
    <strong>Themes:</strong> ${themes}<br>
    <strong>Frequency:</strong> ${frequency}<br>
    <strong>Avoid:</strong> ${avoid}
  `
}

function collectProfile() {
  const name = $('ob-name').value.trim()
  const category = document.querySelector('#ob-category .opt-btn.selected')?.dataset.value || ''
  const voice = document.querySelector('#ob-voice .opt-btn.selected')?.dataset.value || ''
  const audience = $('ob-audience').value.trim() || ''
  const goals = document.querySelector('#ob-goals .opt-btn.selected')?.dataset.value || ''
  const themes = $('ob-themes').value.trim() || ''
  const frequency = document.querySelector('#ob-frequency .opt-btn.selected')?.dataset.value || ''
  const avoid = $('ob-avoid').value.trim() || ''

  return {
    name,
    category,
    voice,
    audience,
    goals,
    themes,
    frequency,
    avoid,
    styleAnalysis: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

// Opt-group selection
document.querySelectorAll('.onboarding-step .opt-group').forEach((group) => {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt-btn')
    if (!btn) return
    // Single-select: deselect others in the same group
    group.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'))
    btn.classList.add('selected')
  })
})

$('ob-next').addEventListener('click', () => {
  // Basic validation for step 0
  if (currentStep === 0) {
    const name = $('ob-name').value.trim()
    const cat = document.querySelector('#ob-category .opt-btn.selected')
    if (!name || !cat) return
  }
  if (currentStep < TOTAL_STEPS - 1) goToStep(currentStep + 1)
})

$('ob-back').addEventListener('click', () => {
  if (currentStep > 0) goToStep(currentStep - 1)
})

$('ob-finish').addEventListener('click', async () => {
  const profile = collectProfile()
  saveProfile(profile)
  hideOnboarding()
  updateProfileBar()

  // If on Facebook, offer to scan page
  if (onPage) {
    const statusEl = $('prof-avatar')
    statusEl.style.animation = 'pulse 1s infinite'
    const scanResult = await scanPageForStyle()
    if (scanResult) {
      profile.styleAnalysis = scanResult
      saveProfile(profile)
      updateProfileBar()
    }
    statusEl.style.animation = ''
  } else {
    // Navigate to Facebook hint shown in UI
    addMessage('assistant', '🎭 **Profile setup complete!** Head over to your Facebook page and open Synapse to scan your content and start generating posts tailored to your style.')
  }
})

$('ob-skip').addEventListener('click', () => {
  hideOnboarding()
})

// --- Page Style Scanner ---

async function scanPageForStyle() {
  try {
    // First try to extract style from visible page
    const result = await sendToBackground('TOOL_EXECUTE', { tool: 'extract_facebook_page_style', args: [] })
    if (result.success && result.result) return result.result

    // Scroll to load more posts
    await sendToBackground('TOOL_EXECUTE', { tool: 'scroll_load_more', args: [] })
    await new Promise(r => setTimeout(r, 3000))

    // Try again after scrolling
    const result2 = await sendToBackground('TOOL_EXECUTE', { tool: 'extract_facebook_page_style', args: [] })
    if (result2.success && result2.result) return result2.result

    return null
  } catch { return null }
}

// --- Init Onboarding ---

if (!isOnboarded()) {
  showOnboarding()
} else {
  updateProfileBar()
}

// Init draft and swipe UI
updateDraftUI()
updateSwipeUI()

// --- Background messaging ---

function sendToBackground(type, payload, timeoutMs = 0) {
  return new Promise((resolve) => {
    // If the extension was reloaded/rebuilt, the background context is gone and
    // chrome.runtime.sendMessage throws "Extension context invalidated"
    // SYNCHRONOUSLY (not via lastError). Detect + degrade gracefully.
    if (!chrome.runtime || !chrome.runtime.id) {
      resolve({ success: false, error: 'Extension context invalidated — reload the page to reconnect.' })
      return
    }

    const timer = timeoutMs > 0 ? setTimeout(() => {
      resolve({ success: false, error: `Request timed out after ${timeoutMs / 1000}s` })
    }, timeoutMs) : null

    let responded = false
    const finish = (val) => {
      if (responded) return
      responded = true
      if (timer) clearTimeout(timer)
      resolve(val)
    }

    try {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        if (chrome.runtime.lastError) {
          finish({ success: false, error: chrome.runtime.lastError.message })
        } else {
          finish(response || { success: false, error: 'No response from background' })
        }
      })
    } catch (e) {
      // Synchronous throw (e.g. context invalidated) — never let it bubble up
      // as an uncaught error; return a clean failure the caller can handle.
      finish({ success: false, error: 'Extension context invalidated — reload the page to reconnect.' })
    }
  })
}

// --- Page data ---

function updatePageData(data) {
  onPage = true
  pageTypeLabel.textContent = 'Active'
  pageTypePill.textContent = 'Active'
  pageTypePill.className = 'pill page'
  pageDataName.textContent = data.pageTitle || data.url || '—'

  const offlineBanner = $('tools-offline')
  if (offlineBanner) offlineBanner.style.display = 'none'
  document.querySelectorAll('.tool-btn:not([data-browser]), #tool-click-el, #tool-scroll-el, #tool-fill-btn, #tool-automation-run, #tool-automation-run2, #tool-sequence-run, #tool-dl-url').forEach((btn) => {
    btn.disabled = false
    btn.style.opacity = ''
    btn.style.cursor = ''
  })
}

// Listen for page data from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PAGE_DATA_RESPONSE' && message.payload) {
    updatePageData(message.payload)
  }
})

// Request initial page data with retry
function requestPageData(retries = 3) {
  try {
    chrome.runtime.sendMessage({ type: 'EXTRACT_PAGE_DATA' }, (response) => {
      if (chrome.runtime.lastError) {
        if (retries > 0) {
          setTimeout(() => requestPageData(retries - 1), 1000)
        } else {
          showNotOnPage()
        }
        return
      }
      if (response?.success && response.data) {
        updatePageData(response.data)
      } else if (retries > 0) {
        setTimeout(() => requestPageData(retries - 1), 1000)
      } else {
        showNotOnPage()
      }
    })
  } catch {
    if (retries > 0) {
      setTimeout(() => requestPageData(retries - 1), 1000)
    } else {
      showNotOnPage()
    }
  }
}

// --- Utility ---

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// --- Not on page state ---

let onPage = false

function showNotOnPage() {
  const offlineBanner = $('tools-offline')
  if (offlineBanner) offlineBanner.style.display = 'block'
  // Disable page-bound tools but keep browser tools active
  document.querySelectorAll('.tool-btn:not([data-browser]), #tool-click-el, #tool-scroll-el, #tool-fill-btn, #tool-automation-run, #tool-automation-run2, #tool-sequence-run, #tool-dl-url').forEach((btn) => {
    btn.disabled = true
    btn.style.opacity = '0.5'
    btn.style.cursor = 'not-allowed'
  })
  const chatSuggestions = $('suggestions')
  if (chatSuggestions) {
    chatSuggestions.innerHTML = `
      <div style="padding:16px;text-align:center;font-size:12px;color:var(--text-secondary);">
        Navigate to any webpage — I can manage Supabase, Vercel, Cloudflare, and more.
      </div>
    `
  }
  pageTypeLabel.textContent = 'Inactive'
  pageTypePill.textContent = '—'
  pageDataName.textContent = '—'
}

// --- Confirmation Dialog ---

const CONFIRM_TOOLS = new Set([
  'click_all_buttons_matching', 'hide_element',
])

const confirmDialog = $('confirm-dialog')
let confirmResolve = null

$('confirm-ok').addEventListener('click', () => { confirmDialog.style.display = 'none'; if (confirmResolve) confirmResolve(true) })
$('confirm-cancel').addEventListener('click', () => { confirmDialog.style.display = 'none'; if (confirmResolve) confirmResolve(false) })
confirmDialog.addEventListener('click', (e) => { if (e.target === confirmDialog) { confirmDialog.style.display = 'none'; if (confirmResolve) confirmResolve(false) } })

async function confirmAction(tool, args) {
  const labels = {
    click_all_buttons_matching: `Click all buttons matching "${args.join(' ')}"?`,
    hide_element: `Hide elements matching "${args.join(' ')}"?`,
  }
  $('confirm-desc').textContent = labels[tool] || `Run "${tool}"?`
  confirmDialog.style.display = 'flex'
  return new Promise((r) => { confirmResolve = r })
}

// --- Tool buttons (Tools tab) ---

const toolResult = $('tool-result')

const TOOL_ARGS = {
  highlight_elements: () => {
    const sel = $('tool-selector').value.trim()
    return sel ? [sel] : ['h1, h2, h3, button, a, img, video']
  },
  scroll_to_element: () => {
    const sel = $('tool-selector').value.trim()
    return sel ? [sel] : ['h1']
  },
  click_element: () => {
    const sel = $('tool-selector').value.trim()
    return sel ? [sel] : ['button']
  },
  find_and_click: () => {
    const sel = $('tool-selector').value.trim()
    return sel ? [sel] : ['submit']
  },
  hide_element: () => {
    const sel = $('tool-selector').value.trim()
    return sel ? [sel] : ['aside, nav']
  },
  fill_input: () => {
    const sel = $('tool-selector').value.trim()
    const text = $('tool-fill-text').value.trim()
    return sel && text ? [sel, text] : ['input', 'text']
  },
  simulate_typing: () => {
    const sel = $('tool-selector').value.trim()
    const text = $('tool-fill-text').value.trim()
    return sel && text ? [sel, text] : ['input', 'Hello']
  },
  click_all_buttons_matching: () => {
    const sel = $('tool-selector').value.trim()
    return sel ? [sel] : ['Load More']
  },
  count_elements: () => {
    const sel = $('tool-selector').value.trim()
    return sel ? [sel] : ['h1, h2, h3, p, a, button, img, video, input']
  },
}

// Tool execution with optional confirmation
document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!onPage) { showToolError('Synapse is not active on this page'); return }
    const tool = btn.dataset.tool
    if (CONFIRM_TOOLS.has(tool)) {
      const argFn = TOOL_ARGS[tool]
      const args = typeof argFn === 'function' ? argFn() : argFn || []
      const confirmed = await confirmAction(tool, args)
      if (!confirmed) return
    }
    showToolResult(`⏳ Running ${tool}...`)
    const argFn = TOOL_ARGS[tool]
    const args = typeof argFn === 'function' ? argFn() : argFn || []
    const result = await sendToBackground('TOOL_EXECUTE', { tool, args })
    showToolResult(result.success ? `✅ ${result.result || 'Done'}` : `❌ ${result.error || 'Failed'}`)
  })
})

// --- Browser tools ---

const BROWSER_INPUTS = {
  navigate_to: { label: 'Enter URL', placeholder: 'https://...' },
  open_tab: { label: 'Enter URL', placeholder: 'https://...' },
  download_url: { label: 'Enter URL', placeholder: 'https://...' },
  switch_tab: { label: 'Tab title or URL to find', placeholder: 'Facebook' },
  close_tab: { label: 'Tab title to close (leave empty for current)', placeholder: 'optional...' },
}

const browserUrlInput = $('tool-browser-url')
const browserGoBtn = $('tool-browser-go')

document.querySelectorAll('[data-browser]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.browser
    const config = BROWSER_INPUTS[tool]

    if (config) {
      browserUrlInput.placeholder = config.placeholder || 'Enter value...'
      browserUrlInput.value = ''
      browserUrlInput.style.display = ''
      browserGoBtn.style.display = 'inline-block'
      browserGoBtn.dataset.browserTool = tool
      browserUrlInput.focus()
      showToolResult(`Enter the ${config.label.toLowerCase()} and click Go`)
    } else {
      // No input needed — execute directly
      showToolResult(`⏳ Running ${tool}...`)
      sendToBackground('BROWSER_TOOL', { tool, args: [] }).then((result) => {
        showToolResult(result.success ? `✅ ${result.result || 'Done'}` : `❌ ${result.error || 'Failed'}`)
      })
    }
  })
})

browserGoBtn.addEventListener('click', async () => {
  const tool = browserGoBtn.dataset.browserTool
  const value = browserUrlInput.value.trim()
  if (!tool) return

  showToolResult(`⏳ Running ${tool}...`)
  const args = value ? [value] : []
  const result = await sendToBackground('BROWSER_TOOL', { tool, args })
  showToolResult(result.success ? `✅ ${result.result || 'Done'}` : `❌ ${result.error || 'Failed'}`)
  browserGoBtn.style.display = 'none'
  browserUrlInput.style.display = 'none'
})

browserUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); browserGoBtn.click() }
})

$('tool-click-el').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const selector = $('tool-selector').value.trim()
  if (!selector) return
  showToolResult('⏳ Clicking...')
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'click_element', args: [selector] })
  showToolResult(result.success ? `✅ ${result.result}` : `❌ ${result.error}`)
})

$('tool-scroll-el').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const selector = $('tool-selector').value.trim()
  if (!selector) return
  showToolResult('⏳ Scrolling to...')
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'scroll_to_element', args: [selector] })
  showToolResult(result.success ? `✅ ${result.result}` : `❌ ${result.error}`)
})

$('tool-fill-btn').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const selector = $('tool-selector').value.trim()
  const text = $('tool-fill-text').value
  if (!selector || !text) return
  showToolResult('⏳ Filling...')
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'fill_input', args: [selector, text] })
  showToolResult(result.success ? `✅ ${result.result}` : `❌ ${result.error}`)
})

// --- Automation: Sequence runner ---
$('tool-sequence-run').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const steps = $('tool-sequence').value.trim()
  if (!steps) return
  showToolResult(`⏳ Running sequence: ${steps}`)
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'run_sequence', args: [steps] })
  showToolResult(result.success ? `✅ ${result.result || 'Done'}` : `❌ ${result.error || 'Failed'}`)
})

// Enter key triggers sequence run
$('tool-sequence').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('tool-sequence-run').click() }
})

// --- Video: Download from URL ---
$('tool-dl-url').addEventListener('click', async () => {
  if (!onPage) { showToolError('Synapse is not active on this page'); return }
  const input = $('tool-video-url').value.trim()
  if (!input) return

  showToolResult('⏳ Downloading from URL...')
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'download_video_from_url', args: [input] })
  showToolResult(result.success ? `✅ ${result.result || 'Done'}` : `❌ ${result.error || 'Failed'}`)
})

// Enter on video URL input triggers download
$('tool-video-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('tool-dl-url').click() }
})

function showToolResult(msg) {
  toolResult.classList.add('visible')
  toolResult.textContent = msg
}

function showToolError(msg) {
  toolResult.classList.add('visible')
  toolResult.textContent = `❌ ${msg}`
}

// --- Init ---

// Start with tools disabled until we confirm we're on a page (browser tools stay active)
document.querySelectorAll('.tool-btn:not([data-browser]), #tool-click-el, #tool-scroll-el, #tool-fill-btn, #tool-automation-run, #tool-automation-run2, #tool-sequence-run, #tool-dl-url').forEach((btn) => {
  btn.disabled = true
  btn.style.opacity = '0.5'
  btn.style.cursor = 'not-allowed'
})

requestPageData()

// Fallback: show offline after 6s if no response
setTimeout(() => {
  if (!onPage) showNotOnPage()
}, 6000)

// --- Dark Mode Toggle (dark is the default; toggles to a light theme) ---

function initTheme() {
  const saved = localStorage.getItem('synapse-theme')
  if (saved === 'light') {
    document.body.classList.add('light')
    $('theme-toggle').textContent = '🌙'
  } else {
    $('theme-toggle').textContent = '☀️'
  }
}

$('theme-toggle').addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light')
  $('theme-toggle').textContent = isLight ? '🌙' : '☀️'
  localStorage.setItem('synapse-theme', isLight ? 'light' : 'dark')
})

initTheme()

// --- Tools Search / Filter ---

$('tools-search-input').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim()
  const sections = document.querySelectorAll('.tool-section')
  sections.forEach((section) => {
    if (!q) { section.style.display = ''; return }
    const btns = section.querySelectorAll('.tool-btn')
    let visible = 0
    btns.forEach((btn) => {
      const text = btn.textContent.toLowerCase()
      if (text.includes(q)) { btn.style.display = ''; visible++ }
      else { btn.style.display = 'none' }
    })
    // Hide section if no buttons visible
    const title = section.querySelector('.tool-section-title')
    if (title) title.style.display = visible === 0 ? 'none' : ''
    if (visible === 0) section.style.display = 'none'
    else section.style.display = ''
  })
})

// --- Keyboard Shortcuts ---

document.addEventListener('keydown', (e) => {
  // Don't trigger if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

  switch (e.key) {
    case '1': document.querySelector('.tab[data-tab="chat"]')?.click(); break
    case '2': document.querySelector('.tab[data-tab="generate"]')?.click(); break
    case '3': document.querySelector('.tab[data-tab="content"]')?.click(); break
    case '4': document.querySelector('.tab[data-tab="tools"]')?.click(); break
    case '5': document.querySelector('.tab[data-tab="memory"]')?.click(); break
    case '6': document.querySelector('.tab[data-tab="settings"]')?.click(); break
  }
})

// --- Eval harness debug hook ---
// Lets an automated benchmark driver (Playwright) start the agent loop and
// poll its state without simulating chat input. No effect on normal usage.
window.synapse = {
  runAgentLoop,
  sendChatMessage,
  getState: () => agentState,
  getContext: () => agentContext,
}
