import { test, expect, chromium } from '@playwright/test'
import { resolve } from 'node:path'

let context, extensionId, worker
test.beforeAll(async () => {
  const dist = resolve('dist')
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  })
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
  extensionId = new URL(worker.url()).hostname
  // UI tests exercise update states deterministically without GitHub network traffic.
  await worker.evaluate(async () => {
    const version = chrome.runtime.getManifest().version
    await chrome.storage.local.set({synapse_update_cache_v1:{installedVersion:version,checkedAt:Date.now(),latestVersion:version}})
  })
  await context.addInitScript(() => {
    localStorage.setItem('synapse-theme', 'dark')
    localStorage.setItem('synapse-onboarded', 'true')
    localStorage.setItem('synapse-creator-profile', JSON.stringify({ name: 'LX Obsidian Labs', category: 'tech', voice: 'professional' }))
  })
})
test.afterAll(async () => { await context?.close() })
async function openSkills(page) {
  await page.locator('.tab[data-tab="tools"]').click()
  if (!(await page.locator('#tools-skills').evaluate(el => el.open))) await page.locator('#tools-skills > summary').click()
}

test('real extension library persists switches, filters and prepares browser tasks', async () => {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await openSkills(page)
  await expect(page.locator('.skill-card')).toHaveCount(18)
  await page.locator('#skills-search').fill('grill')
  await expect(page.locator('.skill-card')).toHaveCount(1)
  const toggle = page.getByRole('switch', { name: 'Enable Grill Me playbook' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await openSkills(page)
  await expect(page.getByRole('switch', { name: 'Enable Grill Me playbook' })).toHaveAttribute('aria-checked', 'true')
  // Verify saved preferences actually affect planner guidance, not just the switch.
  const guidance = await page.evaluate(async () => {
    return buildActionPrompt({ url: 'https://example.com', textSummary: '' }, {
      objective: 'Grill my plan', url: 'https://example.com', plan: [], completedTasks: [],
      chatTurns: 0, steps: 0, maxSteps: 60, lastError: '',
    })
  })
  expect(guidance).toContain('exactly one focused question')
  await page.locator('#skills-search').fill('impossible-no-skill')
  await expect(page.locator('.skill-empty')).toBeVisible()
  await page.locator('#skills-search').fill('')
  await page.locator('#skills-category').selectOption('Browser')
  await page.locator('.skill-card').filter({ hasText: 'Use My Browser' }).getByRole('button', { name: 'Open studio' }).click()
  await page.locator('#skill-task').fill('Read the current page and summarize its key points')
  await page.locator('#skill-agent').click()
  await expect(page.locator('#chat-input')).toHaveValue(/Read the current page.*[\s\S]*Classify whether evidence/)
  await openSkills(page)
  await page.locator('#skills-category').selectOption('')
  await page.locator('.hub-scroll').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: 'test-results/obsidian-skills-desktop.png', fullPage: true })
  expect(errors).toEqual([])
  await page.close()
})

test('studio handles AI errors and successful output without executing browser tasks', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await openSkills(page)
  await page.locator('#skills-search').fill('compress')
  await page.locator('.skill-card').getByRole('button', { name: 'Open studio' }).click()
  await page.locator('#skill-task').fill('Please make sure to preserve npm install and https://example.com exactly.')
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (message, ...args) => message.type === 'AI_CHAT'
      ? Promise.resolve({ success: false, error: 'Test service offline' }) : original(message, ...args)
  })
  await page.locator('#skill-run').click()
  await expect(page.locator('#skills-status')).toContainText('Test service offline')
  await expect(page.locator('#skill-run')).toBeEnabled()
  await page.evaluate(() => { chrome.runtime.sendMessage = async () => ({ success: true, content: 'Preserve npm install and https://example.com exactly.' }) })
  await page.locator('#skill-run').click()
  await expect(page.locator('#skill-studio-output')).toContainText('Preserve npm install')
  await page.close()
})

test('narrow side panel has no horizontal overflow and supports light mode', async () => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await expect(page.locator('.tab')).toHaveCount(3)
  await expect(page.locator('.tab')).toHaveText(['Chat', 'Tools', 'Settings'])
  await expect(page.locator('.minimal-intro')).toBeVisible()
  await expect(page.locator('#chat-send')).toBeInViewport()
  expect(await page.locator('.chat-input-area').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.locator('#agent-activity')).toBeHidden()
  await page.screenshot({ path: 'test-results/minimal-chat-panel.png', fullPage: true })
  await openSkills(page)
  await expect(page.locator('.skill-card')).toHaveCount(18)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.skills-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/obsidian-skills-panel.png', fullPage: true })
  await page.locator('#theme-toggle').click()
  await expect(page.locator('body')).toHaveClass(/light/)
  expect(await page.locator('.minimal-shell').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(250, 250, 250)')
  await page.close()
})

test('minimal chat routes a writing request directly without any browser tool', async () => {
  const page = await context.newPage()
  await page.setViewportSize({ width: 1200, height: 850 })
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const result = await page.evaluate(async () => {
    const calls = []
    sendToBackground = async (type, payload) => { calls.push(type); return { success:true, content:'A concise professional email draft.' } }
    await window.synapse.sendChatMessage('Draft an email thanking a client')
    return { calls, history: chatHistory }
  })
  expect(result.calls).toEqual(['AI_CHAT'])
  expect(result.history[1].content).toBe('A concise professional email draft.')
  await expect(page.locator('#chat-messages')).toContainText('A concise professional email draft.')
  await expect(page.locator('.minimal-intro')).toBeHidden()
  await page.screenshot({ path:'test-results/minimal-chat-desktop.png', fullPage:true })
  await page.close()
})

test('the reported repeated-search scenario stops without resubmitting the query', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const result = await page.evaluate(async () => {
    let plans = 0, executions = 0
    planMission = async () => []
    observePage = async () => ({ url:'https://www.google.com/search?q=lx+obsidian+labs', title:'Google', buttons:[{text:'Search'}], links:[], textSummary:'Search results for LX Obsidian Labs.' })
    planNextAction = async () => { plans++; return {type:'search',target:'lx obsidian labs',value:''} }
    executeAction = async () => { executions++; return {success:true} }
    const outcome = await window.synapse.runAgentLoop('navigate to lx obsidian labs and download the vista cinema apk')
    return { outcome, plans, executions, steps:agentContext.steps }
  })
  expect(result).toEqual({ outcome:'failed', plans:2, executions:0, steps:1 })
  await expect(page.locator('#chat-messages')).not.toContainText('Completed and verified')
  await page.close()
})

test('failed browser outcomes stay failed in history and source text cannot inject markup', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const result = await page.evaluate(async () => {
    runAgentLoop = async () => { agentContext.lastError = 'Source unavailable'; return 'failed' }
    await window.synapse.sendChatMessage('navigate to the product website')
    addMessage('assistant', '<img src=x onerror="window.injected=true"> **Source** [Product](https://example.com/product)')
    return chatHistory.at(-1).content
  })
  expect(result).toContain('failed')
  expect(result).not.toContain('Completed')
  await expect(page.locator('#chat-messages img')).toHaveCount(0)
  await expect(page.locator('#chat-messages strong')).toHaveText('Source')
  await expect(page.locator('#chat-messages a')).toHaveAttribute('href','https://example.com/product')
  await page.close()
})

test('orchestration exceptions and rejected completion both have finite budgets', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const result = await page.evaluate(async () => {
    planMission = async () => []
    observePage = async () => ({url:'https://example.com',buttons:[{text:'Next'}],links:[],textSummary:'A normal page with live content.'})
    planNextAction = async () => { throw new Error('Transient planner failure') }
    const errors = await window.synapse.runAgentLoop('open the next section')
    const errorSteps = agentContext.steps
    planNextAction = async () => ({type:'done',target:'',value:''})
    reflectProgress = async () => ({ status:'continue' })
    verifyObjective = async () => ({complete:false,confidence:0,reason:'Evidence missing'})
    executeAction = async () => ({success:true})
    const verification = await window.synapse.runAgentLoop('open the next section')
    return {errors,errorSteps,verification,verificationSteps:agentContext.steps}
  })
  expect(result).toEqual({errors:'failed',errorSteps:3,verification:'failed',verificationSteps:3})
  await page.close()
})

test('Stop during planning prevents the late action from executing', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await page.evaluate(() => {
    window.executions = 0
    planMission = async () => []
    observePage = async () => ({url:'https://example.com',buttons:[{text:'Submit'}],links:[],textSummary:'A form is visible.'})
    planNextAction = () => new Promise(resolve => { window.finishPlan = resolve })
    executeAction = async () => { window.executions++; return {success:true} }
    window.runResult = window.synapse.runAgentLoop('click Submit')
  })
  await expect.poll(() => page.evaluate(() => typeof window.finishPlan)).toBe('function')
  await page.locator('#agent-stop').click()
  const result = await page.evaluate(async () => {
    window.finishPlan({type:'click',target:'Submit',value:''})
    return { outcome:await window.runResult, executions:window.executions }
  })
  expect(result).toEqual({outcome:'stopped',executions:0})
  await page.close()
})

test('reading an existing AI conversation never activates the forced-message guard', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const actions = await page.evaluate(async () => {
    const executed = []; let turns = 0
    planMission = async () => []
    observePage = async () => ({url:'https://chatgpt.com/c/example',inputs:[{role:'textbox',placeholder:'Message ChatGPT'}],buttons:[{text:'Send'}],links:[],textSummary:'Existing assistant conversation content to read.'})
    planNextAction = async () => ({type:turns++ ? 'done' : 'observe',target:'',value:''})
    executeAction = async action => { executed.push(action.type); return {success:true} }
    reflectProgress = async () => ({status:'goal_met'})
    verifyObjective = async () => ({complete:true,confidence:1})
    await window.synapse.runAgentLoop('Read the existing conversation')
    return executed
  })
  expect(actions).toEqual(['observe'])
  await page.close()
})

test('download completion requires Chrome state, prevents duplicates and rejects invented URLs', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const result = await page.evaluate(async () => {
    const url = 'https://example.com/vista.apk'
    agentContext.objective = 'Download Vista Cinema APK'
    agentContext.observedUrls = new Set([url]); agentContext.downloads = []
    let starts = 0, state = 'in_progress'
    sendToBackground = async (_type, payload) => {
      if (payload.tool === 'download_url') { starts++; return {success:true,result:'Download started (ID: 7): ' + url} }
      if (payload.tool === 'get_download_status') return {success:true,result:JSON.stringify({id:7,url,state,filename:'vista.apk'})}
      return {success:true,content:'{"complete":true,"confidence":1,"reason":"Requested file downloaded"}'}
    }
    const invented = await executeAction({type:'save',target:'https://example.com/invented.apk'})
    await executeAction({type:'save',target:url}); await executeAction({type:'save',target:url})
    const pending = await verifyObjective({url:'https://example.com'}, agentContext)
    state = 'complete'
    const completed = await verifyObjective({url:'https://example.com'}, agentContext)
    return { invented:invented.success, starts, pending:pending.complete, completed:completed.complete }
  })
  expect(result).toEqual({invented:false,starts:1,pending:false,completed:true})
  await page.close()
})

test('live content script preserves deep-page text and long observed download URLs', async () => {
  const url = 'https://awareness.synapse.test/vista'
  const longUrl = 'https://awareness.synapse.test/vista.apk?token=' + 'a'.repeat(250)
  await context.route('https://awareness.synapse.test/**', route => route.fulfill({ contentType:'text/html', body:
    '<html><head><title>Vista Downloads</title></head><body><nav>Menu noise</nav><main>' +
    Array.from({length:30}, (_,i) => `<a href="https://awareness.synapse.test/menu/${i}">Menu ${i}</a>`).join('') +
    '<p>' + 'General introduction. '.repeat(240) + '</p><h2>Vista Cinema Android APK</h2><p>Download the Android installer for Vista Cinema.</p>' +
    `<a download href="${longUrl}">Download Vista Cinema APK</a></main></body></html>`
  }))
  const source = await context.newPage(); await source.goto(url)
  await expect.poll(() => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({url:'https://awareness.synapse.test/*'})
    try { return (await chrome.tabs.sendMessage(tab.id,{type:'SYNAPSE_PING'})).active } catch { return false }
  })).toBe(true)
  const observed = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({url:'https://awareness.synapse.test/*'})
    return JSON.parse((await chrome.tabs.sendMessage(tab.id,{type:'TOOL_EXECUTE',payload:{tool:'observe_page',args:[]}})).result)
  })
  expect(observed.contentText).toContain('Vista Cinema Android APK')
  expect(observed.links.some(link => link.href === longUrl && link.download)).toBe(true)
  const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  const retrieved = await panel.evaluate(state => {
    const index = new SynapseRetrieval.EvidenceIndex(); index.ingest(state)
    return { source:index.retrieve('Vista Cinema Android APK')[0].url, firstLink:SynapseRetrieval.rankLinks(state.links,'download vista cinema apk')[0].href }
  }, observed)
  expect(retrieved).toEqual({source:url,firstLink:longUrl})
  await panel.close(); await source.close(); await context.unroute('https://awareness.synapse.test/**')
})

test('in-app update notice appears for a newer build, can be dismissed, and manual errors are visible', async () => {
  await worker.evaluate(async () => {
    const installedVersion = chrome.runtime.getManifest().version
    await chrome.storage.local.set({synapse_update_cache_v1:{installedVersion,checkedAt:Date.now(),latestVersion:'1.5.0',
      downloadUrl:'https://github.com/lx-obsidian-labs/synapse-social/releases/download/v1.5.0-test/synapse-ai-v1.5.0-test.zip',
      releaseUrl:'https://github.com/lx-obsidian-labs/synapse-social/releases/tag/v1.5.0-test'}})
  })
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await expect(page.locator('#update-notice')).toBeVisible()
  await expect(page.locator('#update-notice-text')).toContainText('1.5.0')
  await expect(page.locator('#update-notice-download')).toHaveAttribute('href',/synapse-ai-v1\.5\.0-test\.zip$/)
  await page.locator('#update-later').click()
  await page.reload()
  await expect(page.locator('#update-notice')).toBeHidden()
  await page.locator('.tab[data-tab="settings"]').click()
  await expect(page.locator('#update-download')).toBeVisible()
  await expect(page.locator('#update-installed')).toContainText('1.4.1')
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (message,...args) => message.type === 'CHECK_FOR_UPDATE'
      ? Promise.resolve({installedVersion:chrome.runtime.getManifest().version,error:'Network unavailable'}) : original(message,...args)
  })
  await page.locator('#update-check').click()
  await expect(page.locator('#update-status')).toContainText('Network unavailable')
  await expect(page.locator('#update-check')).toBeEnabled()
  await page.close()
  await worker.evaluate(async () => {
    const version = chrome.runtime.getManifest().version
    await chrome.storage.local.set({synapse_update_cache_v1:{installedVersion:version,checkedAt:Date.now(),latestVersion:version}})
    await chrome.storage.local.remove('synapse_update_dismissed')
  })
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(popup.locator('#popup-version')).toContainText('v1.4.1')
  await popup.close()
})
