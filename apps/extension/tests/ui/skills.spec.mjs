import { test, expect, chromium } from '@playwright/test'
import { resolve } from 'node:path'

let context, extensionId
test.beforeAll(async () => {
  const dist = resolve('dist')
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  })
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
  extensionId = new URL(worker.url()).hostname
  await context.addInitScript(() => {
    localStorage.setItem('synapse-onboarded', 'true')
    localStorage.setItem('synapse-creator-profile', JSON.stringify({ name: 'LX Obsidian Labs', category: 'tech', voice: 'professional' }))
  })
})
test.afterAll(async () => { await context?.close() })

test('real extension library persists switches, filters and prepares browser tasks', async () => {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await page.locator('.tab[data-tab="skills"]').click()
  await expect(page.locator('.skill-card')).toHaveCount(18)
  await page.locator('#skills-search').fill('grill')
  await expect(page.locator('.skill-card')).toHaveCount(1)
  const toggle = page.getByRole('switch', { name: 'Enable Grill Me playbook' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await page.locator('.tab[data-tab="skills"]').click()
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
  await page.locator('.tab[data-tab="skills"]').click()
  await page.locator('#skills-category').selectOption('')
  await page.locator('.skills-scroll').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: 'test-results/obsidian-skills-desktop.png', fullPage: true })
  expect(errors).toEqual([])
  await page.close()
})

test('studio handles AI errors and successful output without executing browser tasks', async () => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await page.locator('.tab[data-tab="skills"]').click()
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
  await page.locator('.tab[data-tab="skills"]').click()
  await expect(page.locator('.skill-card')).toHaveCount(18)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.skills-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/obsidian-skills-panel.png', fullPage: true })
  await page.locator('#theme-toggle').click()
  await expect(page.locator('body')).toHaveClass(/light/)
  expect(await page.locator('.syn-shell').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(244, 246, 250)')
  await page.close()
})
