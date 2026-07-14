// orchestrator.mjs — Playwright-driven benchmark harness for Synapse.
//
// Modeled on browser-use/benchmark's orchestrator.py, adapted for Synapse which
// is a REAL-BROWSER MV3 extension (not a headless Python agent):
//   1. Launch Chromium with the built extension loaded (persistent context).
//   2. For each task: open the start URL as the ACTIVE tab (the agent always
//      acts on chrome.tabs.query({active:true})), then start the agent loop in
//      the side panel via the window.synapse debug hook.
//   3. Poll the agent state until it returns to IDLE (task finished or gave up).
//   4. Collect evidence (final page state, agent context, transcript).
//   5. Score with the agent-as-a-judge (judge.mjs).
//   6. Aggregate per-run results into official_results/.

import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { scoreTask } from './judge.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const EXT_DIR = path.resolve(ROOT, 'dist')
const PROFILE_DIR = path.resolve(__dirname, '.profile')
const TASKS_PATH = path.resolve(__dirname, 'tasks.json')
const RESULTS_DIR = path.resolve(__dirname, 'official_results')
const RUN_START = new Date().toISOString().replace(/[:.]/g, '-')

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || ''
const HEADLESS = process.env.HEADLESS === 'true'
const NO_JUDGE = process.env.NO_JUDGE === '1' || process.env.NO_JUDGE === 'true'
const TASK_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS || 8 * 60 * 1000)
const POLL_MS = 2000

const tasks = JSON.parse(readFileSync(TASKS_PATH, 'utf-8')).tasks
const tasksToRun = process.env.TASK_IDS
  ? tasks.filter((t) => process.env.TASK_IDS.split(',').includes(t.task_id))
  : tasks

// --- Extension helpers -----------------------------------------------------

async function getExtensionId(browser) {
  const cdp = await browser.newBrowserCDPSession()
  const { targetInfos } = await cdp.send('Target.getTargets')
  const bg = targetInfos.find(
    (t) => t.type === 'background_page' && t.url.includes('chrome-extension://')
  )
  if (!bg) throw new Error('Extension background page not found — is dist/ built and loadable?')
  return new URL(bg.url).host
}

// --- Result aggregation ----------------------------------------------------

function saveRunResult(runRecord) {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const file = path.join(RESULTS_DIR, `Synapse_bench_${RUN_START}.json`)
  const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : []
  all.push(runRecord)
  writeFileSync(file, JSON.stringify(all, null, 2))
  return file
}

// --- Main ------------------------------------------------------------------

async function runOneTask(browser, task, extId) {
  const page = await browser.newPage()
  const startUrl = task.start_url || 'https://www.google.com'
  await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})

  const spPage = await browser.newPage()
  const spUrl = `chrome-extension://${extId}/sidepanel.html`
  await spPage.goto(spUrl, { waitUntil: 'domcontentloaded' })
  await spPage.waitForFunction(
    () => window.synapse && typeof window.synapse.runAgentLoop === 'function',
    { timeout: 30000 }
  )

  // The agent always targets the active tab — make the web page active.
  await page.bringToFront()

  console.log(`▶ [${task.task_id}] ${task.confirmed_task}`)
  await spPage.evaluate((obj) => window.synapse.runAgentLoop(obj), task.confirmed_task)

  const start = Date.now()
  let state = 'EXECUTING'
  let gaveUp = false
  while (Date.now() - start < TASK_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    state = await spPage.evaluate(() => window.synapse.getState())
    if (state === 'IDLE') break
    if (state === 'FAILED') { gaveUp = true; break }
  }
  if (state !== 'IDLE' && state !== 'FAILED') gaveUp = true

  // Collect evidence
  const ctx = await spPage.evaluate(() => window.synapse.getContext())
  const pageInfo = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body ? document.body.innerText.slice(0, 4000) : '',
  })).catch(() => ({ url: '', title: '', text: '' }))
  const transcript = await spPage.evaluate(() => {
    const msgs = document.querySelectorAll('#chat-messages > *')
    return Array.from(msgs).map((m) => m.textContent).join('\n')
  }).catch(() => '')

  const lines = transcript.split('\n').map((s) => s.trim()).filter(Boolean)
  const finalResult = lines[lines.length - 1] || ''
  const agentSteps = lines
  const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false }).catch(() => null)
  const vision = process.env.JUDGE_VISION === '1' && !!screenshot

  let verdict = {
    verdict: null,
    failure_reason: '',
    impossible_task: false,
    reached_captcha: false,
    reasoning: 'not judged',
    confidence: 0,
  }
  if (!NO_JUDGE) {
    verdict = await scoreTask(
      { task, final_result: finalResult, agent_steps: agentSteps, screenshots_b64: screenshot ? [screenshot] : [], pageInfo, ctx },
      NVIDIA_API_KEY,
      { vision }
    )
  }

  await spPage.close().catch(() => {})
  await page.close().catch(() => {})

  const record = {
    task_id: task.task_id,
    category: task.category,
    confirmed_task: task.confirmed_task,
    answer: task.answer || null,
    success: verdict.verdict,
    confidence: verdict.confidence,
    judge_reason: verdict.reasoning,
    failure_reason: verdict.failure_reason,
    impossible_task: verdict.impossible_task,
    reached_captcha: verdict.reached_captcha,
    vision_used: vision,
    gave_up: gaveUp,
    steps: ctx?.steps ?? null,
    completed_actions: ctx?.completedTasks || [],
    final_url: pageInfo.url,
    run_start: RUN_START,
  }
  console.log(
    `  ${verdict.verdict === true ? '✅' : verdict.verdict === false ? '❌' : '⚠️'} ` +
    `[${task.task_id}] verdict=${verdict.verdict} (${verdict.reasoning.slice(0, 80)})`
  )
  return record
}

async function main() {
  if (!existsSync(EXT_DIR)) {
    throw new Error('dist/ not found. Run `npm run build` in apps/extension first.')
  }

  const args = [
    `--disable-extensions-except=${EXT_DIR}`,
    `--load-extension=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]
  if (HEADLESS) args.push('--headless=new')

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    args,
    // Extensions require a persistent context; ignore HTTP errors on sites.
    ignoreHTTPSErrors: true,
  })

  let extId
  try {
    extId = await getExtensionId(browser)
  } catch (e) {
    await browser.close()
    throw e
  }
  console.log(`Extension id: ${extId}`)

  const records = []
  for (const task of tasksToRun) {
    try {
      records.push(await runOneTask(browser, task, extId))
    } catch (err) {
      console.error(`Task ${task.task_id} crashed:`, err)
      records.push({
        task_id: task.task_id,
        category: task.category,
        confirmed_task: task.confirmed_task,
        success: null,
        confidence: 0,
        judge_reason: `harness error: ${String(err).slice(0, 200)}`,
        gave_up: true,
        run_start: RUN_START,
      })
    }
  }

  await browser.close()

  const file = saveRunResult(records)
  const scored = records.filter((r) => r.success === true || r.success === false)
  const successes = records.filter((r) => r.success === true).length
  const rate = scored.length ? ((successes / scored.length) * 100).toFixed(1) : 'n/a'
  console.log('\n=== Benchmark complete ===')
  console.log(`Tasks: ${records.length} | Judged: ${scored.length} | Success: ${successes} (${rate}%)`)
  console.log(`Results: ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
