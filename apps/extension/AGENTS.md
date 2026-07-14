# Synapse Browser Agent — Capability Reference

## Overview
Synapse is an autonomous browser automation agent that operates in an observe→plan→execute→verify loop. It uses AI models to understand web pages and take actions.

## Agent Loop
1. **Observe** — captures page state (DOM + vision) into structured JSON
2. **Plan** — LLM chooses exactly ONE action based on page state
3. **Execute** — system runs the action (tool execution)
4. **Verify** — system checks if action succeeded, updates context
5. **Repeat** — loop continues until objective is done or max steps reached

## All 30+ Action Types

### Navigation
| Action | target | value | Description |
|--------|--------|-------|-------------|
| `navigate` | URL (domain or full) | — | Go to a website |
| `search` | query or `engine: query` | — | Search engine (google/bing/duckduckgo/wikipedia) |
| `back` | — | — | Go back in browser history |
| `forward` | — | — | Go forward in browser history |
| `reload` | — | — | Refresh current page |
| `scroll` | "bottom", "top", or element text | — | Scroll the page |

### Interaction
| Action | target | value | Description |
|--------|--------|-------|-------------|
| `click` | button/link text from page state | — | Click any visible element |
| `type` | input placeholder/label from page state | text to enter | Fill text field (auto-presses Enter for chat) |
| `key` | key name | optional selector | Press keyboard key (enter, escape, tab, arrows, etc.) |
| `select` | dropdown selector | option text/value | Choose from `<select>` dropdown |
| `check` | checkbox/radio label | — | Toggle checkbox, radio, or role=switch |
| `upload` | file input selector | file path/name | Select file for upload |

### Page Understanding
| Action | target | value | Description |
|--------|--------|-------|-------------|
| `observe` | — | — | Refresh page state (DOM + vision fallback) |
| `extract` | — | — | Read all visible text from page |
| `parse` | — | — | Parse structured search results (after Google/Bing/DDG search) |
| `read` | — | — | Extract clean article content (readability mode) |
| `summarize` | — | — | AI summary of current page (3-5 bullet points) |
| `translate` | target language | — | AI translate page content to another language |
| `data` | "tables", "lists", or "json" | — | Extract structured data |
| `find` | search text | — | Find and highlight text on page |
| `contacts` | — | — | Extract emails, phone numbers, social links |

### Browser Features
| Action | target | value | Description |
|--------|--------|-------|-------------|
| `save` | file URL | optional filename | Download a file |
| `copy` | — | text to copy | Copy text to clipboard |
| `print` | — | — | Open print dialog |
| `zoom` | zoom level (1.0 = 100%) | — | Change page zoom |
| `dismiss` | — | — | Close dialogs, cookie banners, overlays |
| `iframe` | iframe src/id/index | — | Switch focus to an iframe |
| `tabs` | — | — | List all open tabs |
| `export` | — | data to save | Save data to downloadable text file |
| `clean` | — | — | Close all tabs except current one |
| `create_account` | email/username | password (optionally `password \| Full Name`) | Register a NEW account on the current site (clicks Sign up, fills form, reports verification_required / account_created / creation_failed) |
| `download_image` | count or `all` | — | Save images from the page (e.g. AI-generated graphics); default saves the 1 largest image |
| `gmail` | `open` \| `read` \| `compose` \| `reply` \| `forward` \| `search` \| `archive` \| `label` \| `mark_read` \| `trash` \| `snooze` | operation args (see below) | Read / manage Gmail: open & read threads, compose/send, reply, forward, search, archive, label, mark read/unread, trash, snooze |

### Control
| Action | target | value | Description |
|--------|--------|-------|-------------|
| `wait` | — | milliseconds | Wait for loading/streaming |
| `done` | — | — | Mark mission complete |
| `design` | design type | template query | Create Canva design (post, instagram, facebook, twitter, tiktok, youtube, pinterest, presentation, poster, flyer, logo, card, document, resume, social, banner, letterhead, ebook) |

## Canva Design
Use `{"type":"design","target":"<type>","value":"<template keyword>"}` to create designs in Canva:

- **target**: Design type (post, instagram, facebook, twitter, tiktok, youtube, pinterest, presentation, poster, flyer, logo, card, document, resume, social, banner, letterhead, ebook)
- **value**: (optional) Template keyword to search

Examples:
- `{"type":"design","target":"instagram","value":"quote"}` — Create an Instagram post with quote templates
- `{"type":"design","target":"poster","value":"cat meme"}` — Create a poster searching for "cat meme"
- `{"type":"design","target":"youtube"}` — Open YouTube thumbnail creator

The agent can then interact with Canva's editor using standard actions (click, type, etc.) to customize the design.

## Search Engine Usage
Search uses `engine: query` format:
- `"python tutorial"` → Google (default)
- `"google: python tutorial"` → Google
- `"bing: python tutorial"` → Bing
- `"duckduckgo: python tutorial"` → DuckDuckGo
- `"wikipedia: Artificial intelligence"` → Wikipedia

After search navigates to results, use `parse` to extract structured results (titles, URLs, snippets).

## Translation & Summarization
- `{"type":"summarize"}` — Extracts page content and sends to AI for a concise 3-5 bullet summary.
- `{"type":"translate","target":"french"}` — Extracts page content and translates to the target language.
- These use the same AI models as the agent loop (parallel, fast).

## Contact Extraction
`{"type":"contacts"}` finds on the current page:
- Email addresses (via regex)
- Phone numbers (multiple formats)
- Social media links (LinkedIn, Twitter/X, GitHub, Facebook)

## Tab Management
- `{"type":"tabs"}` — Lists all open tabs with titles, URLs, and active indicator.
- `{"type":"clean"}` — Closes all tabs except the active one.
- `switch_tab` and `close_tab` are also available.

## Page State Fields
`observe` returns this JSON structure:
```json
{
  "url": "https://...",
  "title": "Page Title",
  "loading": false,
  "streaming": false,
  "textSummary": "First 800 chars of page text...",
  "inputs": [{ "type": "text", "placeholder": "Search...", "enabled": true, "label": "" }],
  "buttons": [{ "text": "Submit", "enabled": true, "role": "button" }],
  "links": [{ "text": "About", "href": "https://..." }],
  "headings": [{ "tag": "h1", "text": "Welcome" }],
  "selects": [{ "name": "country", "options": ["US", "CA"], "value": "US" }],
  "dialogs": [{ "role": "dialog", "text": "Accept cookies?" }],
  "iframes": [{ "src": "https://...", "id": "frame1" }],
  "elementCount": { "inputs": 3, "buttons": 5, "links": 12, "selects": 1 }
}
```

## Error Recovery
- **Loop detection**: If the same action fails 3 times, the system blacklists it and forces a strategy change.
- **503 rate limits**: Rate-limited models are auto-skipped for 60s.
- **Parallel models**: Top 3 models are called simultaneously; fastest response wins.
- **Auto-dismiss**: Cookie banners and dialogs are auto-closed before each observation.
- **Vision fallback**: If DOM observation returns empty, a screenshot is analyzed.
- **Objective judge (agent-as-a-judge)**: When the agent emits `done`, an independent LLM verdict checks the live page state against the objective. If the judge reports `<50%` confidence of completion, the loop continues with the gap noted as the next error — preventing false "done" claims (mirrors how browser benchmarks grade task success).
- **Stealth input timing**: `simulate_typing` and the auto-Enter in `fill_input` use randomized human-like delays (35–95ms/keystroke, longer at spaces, 120–500ms before submit) so inputs resist basic bot-detection.

## Vision Layer
When DOM observation finds no interactive elements, Synapse captures a screenshot and sends it to a vision-capable model (Qwen/GLM) to extract visible UI elements as structured JSON.

## Built-in Tools
All accessible via the side panel's tool buttons AND through the agent loop:
- Page data extraction, Facebook tools, hashtag analysis, engagement metrics
- Video download, image extraction, link analysis
- Content generation with creator profile context
- Multi-step automation sequences

## Site-Specific Knowledge

### ChatGPT (chat.openai.com, chatgpt.com)
- **Inputs**: Look for `[contenteditable]` or `role="textbox"` with placeholder "Message ChatGPT"
- **Buttons**: "Send", "Stop", "Regenerate", "New chat", "Share"
- **After typing**: Enter is auto-pressed — no extra "key: enter" needed
- **Long responses**: Wait for streaming to complete
- **Share**: Click "Share" → "Copy link"

### GitHub
- **Inputs**: Search box (placeholder "Search or type project name"), file editor (role="textbox")
- **Buttons**: "Commit", "Pull request", "Push", "Fork", "Star", "Watch"
- **Tabs**: "Code", "Issues", "Pull requests", "Actions", "Wiki", "Settings"
- **Workflows**: Commit → Stage changes, type message, "Commit changes"; PR → "Compare & pull request", fill details

### Gmail (mail.google.com)
Gmail is now a first-class platform. A dedicated `gmail` action drives the Gmail UI reliably (it is NOT a generic click/type guess). The planner is fed `GMAIL_GUIDE` + a `PLATFORM_GUIDE` Gmail section on every run, and a first-turn guard forces the agent to actually open/read mail when the objective is a read task.

- **Action**: `{"type":"gmail","target":"<op>","value":"<args>"}` where `<op>` is one of: `open`, `read`, `compose`, `reply`, `forward`, `search`, `archive`, `label`, `mark_read`, `trash`, `snooze`.
- **open / read**: `{"type":"gmail","target":"open","value":""}` reads the first/already-open thread; `value` may carry a search filter (e.g. `from:boss@co.com is:unread`) — it searches then opens the first match. Returns the thread's sender/subject/body text.
- **compose / send**: `{"type":"gmail","target":"compose","value":"to@co.com | Subject | Body"}` — clicks Compose, fills To → Subject → Body, clicks Send.
- **reply**: `{"type":"gmail","target":"reply","value":"Your reply text"}` — replies in the open thread.
- **forward**: `{"type":"gmail","target":"forward","value":"fwd@co.com | Optional note"}`.
- **search**: `{"type":"gmail","target":"search","value":"invoice"}` — types in the "Search mail" box and presses Enter (operators like `from:`, `is:unread`, `label:`, `has:attachment` work).
- **archive / trash / snooze**: `{"type":"gmail","target":"archive"}` etc. — click the toolbar button by aria-label.
- **label**: `{"type":"gmail","target":"label","value":"Work"}` — opens the Labels menu and applies the named label.
- **mark_read**: `{"type":"gmail","target":"mark_read","value":""}` (or `value:"unread"`) — via the "More" menu.
- **list**: `{"type":"gmail","target":"list","value":"10"}` — lists recent threads (sender | subject | snippet | date) for triage.
- **summarize**: `{"type":"gmail","target":"summarize"}` — AI summary of the open thread (or the inbox list if no thread is open).
- **star / important / spam**: `{"type":"gmail","target":"star"}`, `…"important"}`, `…"spam"}` — flag or report the open thread.
- **reply_all**: `{"type":"gmail","target":"reply_all","value":"text"}` — reply to everyone on the thread.
- **draft**: `{"type":"gmail","target":"draft","value":"to | subject | body"}` — compose and save as a draft (Gmail auto-saves).
- **schedule**: `{"type":"gmail","target":"schedule","value":"to | subject | body"}` — compose and schedule send (picks the first preset slot).
- **move**: `{"type":"gmail","target":"move","value":"Work"}` — Move to a label/folder.
- **attachments**: `{"type":"gmail","target":"attachments","value":""}` lists them; `value:"download"` downloads them.
- **unsubscribe**: `{"type":"gmail","target":"unsubscribe"}` — opts out of a promotional email.
- **mark_all_read**: `{"type":"gmail","target":"mark_all_read"}` — marks every message read.
- **DOM notes**: search box `aria-label*="Search mail"`; compose fields To/Subject/Message Body; Send button `aria-label*="Send"`; list rows are `div[role="row"]`/`tr[role="row"]`; open message bodies are `div[role="listitem"]`. In-page tools (`gmail_open`, `gmail_read`, `gmail_list`, `gmail_compose`, `gmail_reply`, `gmail_reply_all`, `gmail_forward`, `gmail_search`, `gmail_archive`, `gmail_trash`, `gmail_snooze`, `gmail_label`, `gmail_move`, `gmail_mark_read`, `gmail_mark_all_read`, `gmail_star`, `gmail_important`, `gmail_spam`, `gmail_draft`, `gmail_schedule`, `gmail_attachments`, `gmail_unsubscribe`) live in `content.ts` and use self-healing aria-label/text matching.

### YouTube
- **Inputs**: Search box (placeholder "Search"), comment box (contenteditable)
- **Buttons**: "Upload", "Subscribe", "Like", "Share", "Save"
- **Navigation**: "Home", "Shorts", "Subscriptions", "Library"
- **Comments**: Find comment box, type, press Enter

### Twitter/X
- **Inputs**: Tweet box (contenteditable), search box
- **Buttons**: "Tweet", "Reply", "Retweet", "Like", "Quote"
- **Navigation**: "Home", "Explore", "Notifications", "Messages", "Profile"
- **Tweeting**: Find tweet box, type, click "Tweet" button

### Google Search
- **Input**: Search box (placeholder "Search Google or type a URL")
- **Buttons**: "Google Search", "I'm Feeling Lucky"
- **Usage**: Type query, press Enter
- **Results**: Use `parse` action to extract structured data

### LinkedIn
- **Inputs**: "Connect with people", message boxes
- **Buttons**: "Easy Apply", "Save job", "Connect", "Message"
- **Navigation**: "Jobs", "My Network", "Post", "Notifications"
- **Messaging**: Find message box, type, press Enter

### Facebook
- **Inputs**: "Write something...", search box, comment boxes
- **Buttons**: "Post", "Like", "Comment", "Share"
- **Navigation**: "Home", "Watch", "Marketplace", "Groups", "Profile"
- **Posting**: Find "Write something..." box, type, press Enter

### General Web Patterns
- **Forms**: Look for inputs, selects, textareas. Submit with submit button.
- **Modals**: Often `role="dialog"`. Use `dismiss` action to close.
- **Loading**: If `loading: true`, wait before taking action.
- **Pagination**: "Next", "Previous", page numbers, "Load more" buttons.
- **Infinite scroll**: Scroll to bottom to load more.
- **Tables**: Use `data` action with target "tables" to extract.

### ChatGPT — Graphic Design / Image Generation
- ChatGPT can GENERATE images when asked (logos, posters, social graphics, infographics, mockups). No special button is needed — just TYPE a detailed visual prompt into the composer and send it.
- Workflow the agent follows: (1) TYPE a self-contained prompt (format/size, style, palette, copy/text to include, brand, audience); (2) "wait" until the image finishes rendering; (3) "observe" to confirm it rendered; (4) "download_image" (target "all" to grab every variant) to SAVE the artwork to the user's Downloads. Iterate with revisions in the SAME chat, then download again. Never start a new chat and lose generated assets.
- `download_image` (content.ts) picks the largest `<img>` elements first (generated art >> icons) and triggers a real browser download for each.

### Account Creation (Sign-up)
- `create_account` tool (content.ts): registers a NEW account on any site. Detects a registration form (name + email + password + confirm + "Sign up"/"Create account" submit), optionally clicks a "Sign up" entry point first, fills fields, submits, and reports `account_created` | `verification_required` (email/SMS — ask user for code) | `creation_failed` (email taken / weak password / missing field).
- Planner action: `{"type":"create_account","target":"email","value":"password | Full Name"}`. Mirrors `login` (target=email, value=password) but opts into registration instead of authentication.
- Use it when the objective is to SIGN UP / register, distinct from `login`. For unusual multi-step wizards, fill fields manually with `type` + click submit.

---

## Work Session Summary (operational, appended)

### Objective
Harden the Synapse in-page Chrome-extension browser-automation agent: reliable ChatGPT interaction, self-learning memory, agent robustness (retry/rollback), Memory inspector tab, hardened/self-healing locators, and an anti-"new chat" loop guard � all on verified NVIDIA NIM models (no external backend).

### Completed
- Self-learning memory fully wired (appendMemory dedup, memoryToText recency+playbook/avoid, recordLearning failedSummary, clearMemory, memoryCount HUD, Memory tab key `5`).
- Agent robustness: MAX_ACTION_RETRIES=2, rollback via lastStableUrl+back, corrective re-plan, detectLoop blacklist.
- Qwen timeout fix + model reorder (Nemotron primary, GLM vision streamed, Qwens fallback non-streaming 180s).
- Plan/Reflect functions added (planMission, renderPlan, reflectProgress); buildActionPrompt prints plan checklist.
- content.ts: fill_input/simulate_typing rewritten with waitForVisibleInput/focusAndClick/typeInto/clearInput/submitInput (ChatGPT composer first); observe_page inputs/buttons emit role/name/testId; findTextAndClick self-healing scoring across text/aria/title/name/testid/placeholder/value/id, walks iframes.
- BUILD FIX: helper functions were wrongly placed inside the `tools` object literal in content.ts, breaking `node build.mjs` (stale dist). Moved isElementReady/waitForVisibleInput/focusAndClick/typeInto/clearInput/submitInput to module scope. Build now succeeds.
- Anti-new-chat guard hardened: execAction blocks `click` on "new chat/conversation/thread" when isOnChatSite(url) OR chatTurns>0 OR hasChatComposer(lastObservedState); returns "Reused the OPEN chat". `lastObservedState = pageState` set each loop iteration; `hasChatComposer(state)` inspects inputs for textbox role / message|prompt|chat placeholder.
- background.ts ChatGPT section + sidepanel.js buildActionPrompt rule strengthened: never click New chat while a chat is open; type into the composer instead.

### Active
- Token-efficient DOM snapshotting (cap/dedupe inputs/buttons/links arrays, truncate textSummary) � not yet implemented.
- AI/response cache via chrome.webRequest JSON caching + AI-call dedup � not yet implemented.
- Wire planMission (loop start) + reflectProgress (before done/continue) into runAgentLoop � functions exist, not yet invoked.
- Auto-wait web-first assertions replacing fixed sleeps � partially discussed.

### Blocked
- None.

### Next Move
1. Implement token-efficient snapshot + response cache.
2. Call planMission at loop start and reflectProgress after each step.
3. Rebuild (`node build.mjs`) and verify dist after any change.

## Update (model rotation + DOM/state hardening)
- DOM/state (sidepanel.js): added `detectChatContext(pageState, context)` � single programmatic source of truth (onChatSite/composerPresent/promptSent/chatOpen). Used by BOTH the `click` new-chat guard and the `navigate` guard (replaced scattered conditional host checks with validated state).
- Added explicit loop-level state-transition check in `runAgentLoop`: if planner still emits New chat while a chat is open, override to `type` the objective (if unsent) or `observe` (if already sent) � breaks the redundant loop at the source.
- Added `compactPageState()` and use it (single-line JSON, capped arrays, 400-char text) in `buildActionPrompt` to cut token overhead / inference latency. Full DOM is no longer sent to the model.
- Model rotation (background.ts): added `MODEL_RETRY_THRESHOLD=2`, sticky `modelCursor`, `pickAvailableIndex`, and `routeModelCall()`. All three AI paths (AI_CHAT agent loop, generate, vision) now rotate through the model pool, retrying a model up to the threshold before force-switching to the next; rate-limited models are skipped and the cursor stays deprioritized so the agent never gets stuck on one model.
- Build: `node build.mjs` succeeds; all changes confirmed in dist/.

## Update (loop resilience + real error surfacing)
- Root symptom: agent overrode "New chat" correctly but then aborted the whole mission with the masked message "Error: Could not reach the AI service". `sendToBackground` never rejects (always resolves success:false), so the abort was a thrown JS exception being swallowed by the generic catch.
- `runAgentLoop`: wrapped the entire `while` body in try/catch. A failing step now logs the REAL error (console.error), records it, and the loop re-observes + re-plans instead of throwing � the mission no longer dies mid-run.
- `sendChatMessage` outer catch now shows the actual error message instead of the misleading "Could not reach the AI service".
- `type` action timeout raised to 400000ms so long pastes (e.g. a full mission brief) are not cut off by the 20s tool timeout.
- Note: the new-chat override force-types `agentContext.objective` (the user prompt) into the composer; for a very long SOP this is a large paste but now completes within the longer timeout and no longer crashes the loop.

## Update (fix: agent not reading ChatGPT replies)
- ROOT CAUSE of "keeps saying continue / never follows up": observe_page textSummary kept only the HEAD of body.innerText (first ~1500 chars), then compactPageState re-sliced to 400. Because the agent pastes the full multi-thousand-char prompt, the assistant's reply (which sits at the TAIL of the DOM above the composer) was excluded entirely � the LLM only ever saw its own prompt, so it blindly emitted "continue".
- Fixed observe_page (content.ts): textSummary now = head(900) + tail(last 2000 chars) of body.innerText, capped at 3200. The tail is where the latest reply lives.
- Fixed compactPageState (sidepanel.js): text slice 400 -> 2800 so the planner sees the reply.
- Fixed objective judge + reflectProgress (sidepanel.js): they sliced textSummary from the HEAD (UI+prompt start) -> now slice from the TAIL (-1600) so the judge actually sees the reply and can confirm completion / follow up.
- Rebuilt; all confirmed in dist/.
## Update (generalize beyond ChatGPT � Cloudflare/dashboards)
- The agent is now a GENERAL browser agent, not ChatGPT-only. The generic observe->plan->execute loop already worked on any site; the blocker was that the LLM prompt assumed every page was a chat AND site knowledge in AGENTS.md was dev-only (never sent to the model).
- sidepanel.js uildActionPrompt: split Rules into conditional sections (CHAT/AI site vs REGULAR website/dashboard), added a PLATFORM_GUIDE constant (Cloudflare flow: dash.cloudflare.com login, zone -> DNS Records/proxy cloud, SSL/TLS; plus GitHub/Vercel/Netlify/generic dashboard + general web) injected into every planner call.
- content.ts ill_input: no longer auto-presses Enter on EVERY input. Auto-submit now only for chat composers, search boxes (role=searchbox / input[type=search]), or chat-site URLs. Multi-field forms (login) are filled field-by-field and submitted via the button/key:enter � prevents premature form submission on Cloudflare/admin logins.
- maxSteps raised to 60 (earlier) to support multi-step dashboard tasks.
- Rebuilt; all confirmed in dist/.
## Update (improve Content Creator tab)
- Added a floating Copy button to EVERY Content Creator result block (Hashtag Research, Post Analyzer, Repurpose, Ideas, Best Time, Hooks, Series, Multi-Export) via a reusable makeCopiable() + MutationObserver that re-attaches the button whenever a tool overwrites the result (textContent/innerHTML would otherwise wipe it). CSS shows it on hover.
- Made the tools platform-aware: Content Ideas, Hook Generator, Content Series, and Multi-Platform Export previously hardcoded 'Facebook'; they now use the selected platform from the Generate tab (PLATFORM_CONFIG[selectedPlatform].label) so they align with the new multi-platform Generate page.
- Aligned Repurpose's Instagram guidance to 5-10 hashtags (was 'max 3') to match Generate.
- Rebuilt; verified in dist/.
## Update (cross-site robustness, login, user-awareness, Enhance Prompt)
- New in-page tool login_to_site (content.ts): generically detects ANY site's auth form (username/email + password + submit button by text), fills from args [user, pass], submits, waits, then reports outcome: logged_in | 2fa_required (detects OTP/verification screens) | login_failed (with error text). Uses shared typeInto/clearInput helpers; does NOT auto-Enter (multi-field safe). ToolResult gained optional status field.
- sidepanel.js: added login action in executeAction (routes to TOOL_EXECUTE login_to_site) and to the planner action list + example.
- Planner prompt (buildActionPrompt) now injects a ?? User/Brand Context block from the Creator Profile so the agent acts AS the user (voice/niche/goals) � "user aware". Added Rules: USER AWARENESS, LOGIN-FIRST (log in before touching authenticated areas; pull creds from the request; ask if missing), and 2FA/VERIFICATION (ask user for code, never guess).
- New "? Enhance" button in the chat input bar: rewrites the user's rough instruction into a clear, reliable, detailed prompt via AI (prompt-engineering), keeping intent + brand context, and puts it back in the input. CSS added for .enhance-btn.
- Rebuilt; verified in dist/.
## Update (fix: chat send listener passed the click Event as the prompt; Stop/Pause controls)
- ROOT CAUSE of the repeated `(objective || "").toLowerCase is not a function` crash: `chatSend.addEventListener('click', sendChatMessage)` passed the CLICK Event object as the first arg (`programmaticText`), so `text = programmaticText || chatInput.value` became the Event. The user message rendered literally as `[object PointerEvent]` and the objective became an object, breaking every `.toLowerCase()`/template use. Fixed the listener to `() => sendChatMessage()`.
- Belt-and-suspenders: `runAgentLoop` now coerces `agentContext.objective` to a string (and memoryToText uses `String(objective || '')`) so a non-string objective can never crash a step again.
- New Stop/Pause controls in the agent HUD (sidepanel.html `.hud-run-controls` + CSS `.hud-btn`/`.hud-stop`): Pause toggles a `paused` flag (loop busy-waits 250ms until resumed), Stop sets `agentStopRequested` (loop ends cleanly next iteration). Both appear only while the agent is running (updateRunControls, driven by transition()); reset to Pause on run end.
- Rebuilt; verified in dist/.
## Update (account creation + ChatGPT graphic-design comfort)
- New in-page tool `create_account` (content.ts) + `findSignupFields()` helper: registers a NEW account on any site. Detects a registration form (name + email + password + confirm + "Sign up"/"Create account" submit), clicks a "Sign up" entry point if not already on the form, fills fields (derives a display name from the email if none given; value may carry "password | Full Name"), submits, and reports `account_created` | `verification_required` (email/SMS — ask user for code) | `creation_failed` (with screen text).
- New in-page tool `download_image` (content.ts): saves images from the page (picks largest imgs first, so AI-generated artwork beats icons) via real browser downloads; arg = count or "all".
- sidepanel.js: added `create_account` + `download_image` to parseAction (JSON + simple), executeAction, the action list, and quick examples. Planner Rules gained ACCOUNT CREATION guidance; the CHAT/AI site section gained a GRAPHIC DESIGN / IMAGE GENERATION playbook (type detailed prompt → wait → observe → download_image, iterate in same chat); the REGULAR website section gained SIGN-UP/REGISTRATION guidance.
- AGENTS.md: ChatGPT graphic-design + account-creation knowledge sections added; action table + examples updated.
- Rebuilt; verified in dist/.
## Update (fix: GLM-5.2 "signal is aborted without reason" timeout)
- Root cause: the abort timer fired on a slow/stuck streaming response, but `nvidiaChat` only marked 503s as model failures — so `routeModelCall` re-hung on the SAME model up to `MODEL_RETRY_THRESHOLD`×timeout before switching. Also a latent TDZ bug: `timeoutMs` read `useStream` before its `const` declaration (masked only because all callers pass timeoutMs).
- Fix: an abort/timeout now also calls `markModelFailed(name, 503)` (60s skip), so the router moves to the next model after ONE failed attempt instead of re-hanging. Error is now reported clearly as `z-ai/glm-5.2: timed out after 120s`. Reordered `useStream`/`timeoutMs` to remove the TDZ.
- Rebuilt; verified in dist/.
## Update (fix: agent stuck looping observe on ChatGPT, never sends the task)
- Root cause: on a chat site with nothing typed yet (chatTurns === 0), the planner kept returning `observe`/`wait`/`scroll`, so the agent never sent the user's instruction into the composer and spun forever (steps 1..N all observe).
- Fix: added a first-turn guard in runAgentLoop — if on a chat site and chatTurns === 0 and the planner picks a passive action, force `type` of the full objective into the composer (forcedFirstType flag, once). Also strengthened the planner's CHAT/AI-site FIRST ACTION RULE to require `type` first.
- If the forced send fails because there's no composer (ChatGPT not logged in), the agent now reports "Log in to ChatGPT in this tab, then re-run" and ends as FAILED (instead of looping). The end-of-loop code was also fixed so a FAILED state is no longer overwritten by a forced DONE/OBJECTIVE COMPLETE.
- Rebuilt; verified in dist/.
## Update (fill_input empty-selector + model routing/failover)
- fill_input bug: the forced first-turn `type` action sends target="" (auto-detect composer), but fill_input required a non-empty selector and returned "Usage: fill_input: selector | text", so the task was never sent (agent fell back to observe loop). Fixed: fill_input now treats an EMPTY selector as "auto-detect the best input" (ChatGPT composer first), only requiring non-empty `text`. Also executeAction's `type` case now increments chatTurns ONLY on success (so a failed send no longer wrongly marks the conversation as sent).
- Model routing: routeModelCall no longer wanders a cursor across models. It now tries models in FIXED priority order (index 0 = primary/proven Nemotron) and always prefers the highest-priority AVAILABLE model; 503/timeout-marked models are simply skipped until their cooldown clears. This keeps a good model sticky instead of being displaced by dead ones. Removed now-unused modelCursor + pickAvailableIndex.
- Failover speed: agent-loop AI timeout lowered 120s -> 60s so a dead/slow model fails fast and the router moves to a working one. (Vision/generate stay at 180s for large outputs.)
- Rebuilt; verified in dist/.
## Update (agent stalls on ChatGPT instead of generating/downloading designs)
- Symptom: agent sent the marketing brief to ChatGPT, ChatGPT asked for missing details, and the agent never followed up to drive image generation or download — it spun on observe.
- Planner playbook (GRAPHIC DESIGN / IMAGE GENERATION) rewritten to be a concrete, procedural follow-through: send brief -> if ChatGPT asks for info, answer in-chat with reasonable assumptions OR ask the human, then explicitly command ChatGPT to GENERATE the PNG (three variations), wait, observe, download_image (target "all"). Objective is complete only when PNGs are generated AND downloaded.
- Anti-stall guard added: on a chat site with chatTurns > 0, if the planner keeps choosing observe/wait/scroll 3x in a row, force progress — if images are already present (pageState.imgCount > 0) run download_image("all"), else push ChatGPT to generate the artwork. Resets on any non-passive action.
- observe_page (content.ts) now reports imgCount; compactPageState forwards it so the planner knows when generated artwork is on the page.
- Rebuilt; verified in dist/.
## Update (download_image grabbed UI icons/avatars instead of generated art)
- Bug: download_image (and the imgCount the planner saw) scanned ALL <img> on the page, so the agent downloaded ChatGPT's sidebar logos, avatars, and toolbar icons instead of artwork the AI generated.
- Fix: added module-scope getContentImages() that scopes to the conversation panel (<main>), excludes nav/aside/header/footer chrome and inline SVG icons, and drops images smaller than 160x160 (icons/avatars are tiny). download_image and observe_page's imgCount now use it exclusively — so only real, AI-generated artwork is counted/downloaded. Planner guidance reinforced that download_image is safe (ignores UI chrome).
- Rebuilt; verified in dist/.
## Update (agent loops: ChatGPT keeps re-asking for project details)
- Symptom: the forced follow-up just said "generate the three PNG variations" with NO project details, so ChatGPT (browser) kept re-asking "what's the company name?" and the agent re-pushed the same command — an infinite Q&A loop.
- Fix: added DESIGN_DEFAULT_BRIEF (a self-sufficient placeholder brand brief: company/industry/colours/style/size) and the anti-stall guard now sends it together with the generate instruction, so ChatGPT has everything it needs to actually produce the artwork. Guard also no longer fires while pageState.streaming/loading is true, so it can't interrupt an in-progress image generation.
- Planner playbook step 1 rewritten: when ChatGPT asks for missing details, reply IN-CHAT with a COMPLETE set of defaults inline + generate instruction in ONE message (don't just repeat "generate"); only ask the human first if they explicitly said to wait for input.
- Rebuilt; verified in dist/.
## Update (user clarification: many SEPARATE design files, tailored to the company)
- User clarified the goal: produce MANY marketing FILES, each a single focused design based on the company's business & the services it offers — NOT one image with multiple designs/logos crammed in.
- Split the brief into DESIGN_GENERATION_INSTRUCTION (request a SET of separate, single-subject designs, one per service + a general brand piece; never a grid/collage) and DESIGN_DEFAULT_BRIEF (placeholder brand, now also enumerates 3 sample services so it yields separate designs).
- Added runtime "ask the user for company details": module vars sessionCompanyBrief / awaitingCompanyBrief. On a design task whose objective lacks company specifics, the agent posts a panel message asking for (1) company name (2) services/products (3) audience (4) brand colours, then ends the run (returns 'needs-info'). The user's reply becomes sessionCompanyBrief and the NEXT run types it combined with DESIGN_GENERATION_INSTRUCTION. So designs are tailored to the real business instead of generic placeholders. If the objective already looks detailed (>120 chars + business keywords) it's used directly.
- forcedFirstType and the anti-stall push now both send sessionCompanyBrief + DESIGN_GENERATION_INSTRUCTION (real details) when available, falling back to DESIGN_DEFAULT_BRIEF only when nothing was supplied.
- Planner GRAPHIC DESIGN playbook rewritten to emphasize many separate single-subject designs per service (not collages) and the ask-user-for-details path.
- Rebuilt; verified in dist/.

## Update (model reliability + premium UX overhaul)
- Root errors nvidia/nemotron-3-ultra-550b-a55b network error / z-ai/glm-5.2 timeout: fixed. background.ts now (1) reorders the model pool with a small reliable NIM primary (meta/llama-3.1-8b-instruct, verified live) ahead of huge MoE fallbacks; (2) permanently skips 404/403/400 models for the session; (3) marks 503/network/'Failed to fetch' as a 60s cooldown so the router skips instead of re-hanging; (4) fast-fails with a clear network message; (5) rejects an empty API key up front. Live-probed all candidate IDs � only llama-3.1-8b / llama-3.3-70b / llama-3.2-11b-vision / llama-3.2-90b-vision / nemotron-3-ultra-550b returned OK; removed the 404 nemotron-70b; kept glm/minimax/qwen only as last-resort (they hang).
- Agent loop timeout raised 60s->120s and capped at 4k tokens so big fallbacks can still respond; model used is surfaced back to the HUD.
- Premium UX: sidepanel HUD is now technical (live model chip, latency ms, signal bars, scrolling OBSERVE/PLAN/EXEC/VERIFY telemetry log). Added a Settings tab (per-device NVIDIA API-key override in chrome.storage.local, Test Connection that pings each model and shows live/down, theme picker) and an app footer linking to https://www.lxobsidianportal.co.za. Onboarding copy rewritten to explain the autonomous agent + quick-start.
- content.ts perf: observe_page + getContentImages now memoized (signature + MutationObserver dirty flag + explicit markPageDirty on mutating tools); per-input label queries batched into one Map.
- Web app (apps/web): Settings.tsx gained an AI Configuration card (model select + password API key) wired to a persisted zustand store; sidebar footer + ConnectPrompt link to lxobsidianportal.co.za; new first-run onboarding.tsx wizard gated by store.onboarded; globals.css refined (shadows, radii, gradient bg).
- Built extension (
ode build.mjs) and 
px tsc --noEmit on web both pass clean.

## Update (LX Obsidian Labs Facebook Content OS wired into the agent)
- New constant FB_CONTENT_SYSTEM (sidepanel.js): the LX Obsidian Labs Facebook Content Operating System — brand voice, 7 content pillars with %, daily framework, weekly rotation, recurring series, Reel-length guidance, genuine-engagement rule, repurposing, monetization funnel. Injected into buildActionPrompt userContextBlock (BOTH profile-set and no-profile branches) so the agent acts AS the brand on Facebook/social.
- Core rule added: TEXT FIRST, THEN IMAGES — for any content task the agent must write post copy/hook/caption/CTA as TEXT before producing image/carousel/design assets; it must NOT start a content task by generating images.
- PLATFORM_GUIDE gained a Facebook section (composer = "What's on your mind?", click "Post", Reels/Stories, no auto-boost) so the agent knows how to actually publish.
- Rules section gained a FACEBOOK / SOCIAL CONTENT bullet reinforcing the OS + text-first + how to post.
- Bug fix: line 641 had a stray `\ n` (backslash+space) instead of `\n` in the no-profile userContextBlock, which injected a literal "n" into the prompt every step. Corrected to `\n` and the FB_CONTENT_SYSTEM is now appended there too.
- Rebuilt; FB_CONTENT_SYSTEM + "TEXT FIRST" + "What's on your mind?" confirmed present in dist/sidepanel.js.

## Update (agent loop hardening)
- Wired `planMission`/`renderPlan` into `runAgentLoop` at loop start — the agent now builds and displays a concrete step checklist before executing (previously the functions existed but were never invoked).
- Extended the first-turn guard beyond chat/AI sites to Facebook content posting: on facebook.com with nothing posted yet, it forces the first `type` into the "What's on your mind?" composer (which does NOT auto-post — auto-Enter is disabled for Facebook), so the post copy (TEXT) is written before any image/design step. Enforces text-first at the code level and prevents spinning on observe.
- Integrated `reflectProgress` into the `done` decision: before finalizing, the agent reflects and, if it returns `ask_user`, surfaces the clarifying question to the user and ends cleanly instead of declaring false completion.
- Added helpers `isFacebookUrl(url)` and `isContentTask(objective)` near `isOnChatSite` to support the new guards.
- Rebuilt; isFacebookUrl / isContentTask / planMission / reflectProgress confirmed present in dist/sidepanel.js.

## Update (Facebook content libraries wired into the agent)
- New constant FB_CONTENT_LIBRARY (sidepanel.js): reusable templates the agent pulls from when writing text-first LX Obsidian Labs posts — HOOK LIBRARY (12 categories w/ examples: curiosity, shock, question, mistake, statistics, prediction, controversy, fear, story, challenge, urgency, comparison), CTA LIBRARY (soft/strong/discussion/share/save/follow/community), CONTENT FRAMEWORKS (PAS, Q-S-L-D, Myth-Truth-Evidence-CTA, Before-Process-After-CTA, Mistake-Why-Fix-Challenge), and STORYTELLING FRAMEWORKS (Hero's Journey, Problem-Solution, Open Loop, Transformation, Mini Doc, Personal/Educational/Emotional Story). Rule: every post = ONE hook + ONE framework + ONE CTA.
- Injected into buildActionPrompt userContextBlock (both profile and no-profile branches) and referenced by the FACEBOOK / SOCIAL CONTENT rule ("PULL from the Content Libraries").
- Rebuilt; FB_CONTENT_LIBRARY + "HOOK LIBRARY" + "CONTENT FRAMEWORKS" confirmed present in dist/sidepanel.js.
- Remaining unimplemented from the earlier enhancement list: Research + analytics playbook (competitor/trend monitoring, KPI dashboard, AI content workflow).

## Update (Facebook research + analytics playbook wired in)
- New constant FB_RESEARCH_PLAYBOOK (sidepanel.js): the LX Obsidian Labs measurement/optimization layer — weekly competitor watch, trend-monitoring topic list, 7-factor content scoring, KPI dashboard (reach, watch time, shares/saves/comments, follower gain/loss, engagement rate, CTR, consultation inquiries, revenue, top topics/hooks/times/lengths) with 90-day targets, the 10-step AI content workflow, and an optimization loop.
- Injected into buildActionPrompt userContextBlock (both profile and no-profile branches) and referenced by the FACEBOOK / SOCIAL CONTENT rule for planning/analysis tasks.
- Rebuilt; FB_RESEARCH_PLAYBOOK + "KPI DASHBOARD" + "AI CONTENT WORKFLOW" confirmed present in dist/sidepanel.js.
- The earlier enhancement list (Brand guide / Content libraries / Loop hardening / Research+analytics) is now FULLY implemented for the LX Obsidian Labs Facebook operating system.

## Update (Enhance Prompt improved)
- `enhancePrompt` (sidepanel.js) rewritten from a generic one-line rewrite into a structured, brand- and task-aware prompt engineer:
  - Always injects LX Obsidian Labs as the default brand (voice + act-AS framing) plus any Creator Profile.
  - Detects task type via `isContentTask` + regex: FACEBOOK/SOCIAL CONTENT tasks are enhanced into a TEXT-FIRST post plan (pillar + hook/framework/CTA copy + weekday/time slot + discussion question, 80/20 value/promo); DESIGN/MARKETING tasks are enhanced to specify single-subject PNGs, Obsidian Black + Electric Blue palette, premium-tech style, and the 3 variation archetypes.
  - Output is now structured with labelled GOAL / CONTEXT / STEPS / CONSTRAINTS / DONE WHEN sections so the agent gets an unambiguous, executable prompt. Still returns ONLY the improved prompt; original text preserved on failure.
- Rebuilt; "DONE WHEN", "FACEBOOK/SOCIAL CONTENT task", "DESIGN/MARKETING task" confirmed in dist/sidepanel.js.
- New constant CHATGPT_GUIDE (sidepanel.js): full 2026 ChatGPT reference — model picker (Auto/Instant/Thinking/Pro, click don't type), composer-at-top layout, native tools (file upload 512MB, Canvas, image gen, Deep Research, web search w/ citations, Advanced Voice, Tasks, Custom GPTs, Memory, Custom Instructions), plus reliable interaction rules (reuse open chat, wait for streaming, "Continue generating", answer clarifying questions, drive image gen to downloaded PNGs, multi-turn same chat).
- New constant COMPANY_KNOWLEDGE: LX Obsidian Labs (default brand, lxobsidianportal.co.za — enterprise software/AI/cloud/mobile/digital platforms) + rule to research OTHER companies via web before acting AS them. Injected into buildActionPrompt userContextBlock (both profile-set and no-profile paths).
- buildActionPrompt CHAT/AI-site block: appended CHATGPT_GUIDE and upgraded rules — model-picker click (Thinking/Instant), "Continue generating" click, file upload via attach, share/export, and a better first-message "train the assistant" framing.
- waitForChatResponse (sidepanel.js): code-level auto-resume — when ChatGPT's reply stops growing, it attempts find_and_click("Continue generating") once, then keeps waiting. More reliable than relying on the planner to emit the click.
- background.ts ChatGPT section upgraded to the same 2026 model-picker/Continue-generating/file-upload/Canvas guidance so the free-chat path is consistent.
- Rebuilt; CHATGPT_GUIDE + "Continue generating" + "model picker" confirmed present in dist/sidepanel.js.
