import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { route, artworkGoal, delegatesToChat, RunBudget } = require('../src/orchestration.js')
const { EvidenceIndex, rankLinks, resolveLink, searchResult } = require('../src/retrieval.js')
const flow = require('../src/browser-flow.js')

test('ordinary writing and questions do not require browser automation', () => {
  for (const text of ['Hello', 'Draft an email', 'Explain orchestration', 'Write a design brief for our brand']) assert.equal(route(text).kind, 'reply')
  for (const text of ['navigate to lx obsidian labs and download the vista cinema apk', 'Summarize this page', 'Read my Gmail', 'Research current AI trends']) assert.equal(route(text).kind, 'browser')
  assert.equal(route('download file', 'reply').kind, 'reply')
})
test('research and copy requests cannot activate the artwork fallback', () => {
  assert.equal(artworkGoal('research the best logo design apps'), false)
  assert.equal(artworkGoal('create a marketing brief'), false)
  assert.equal(artworkGoal('generate three separate PNG images'), true)
  assert.equal(delegatesToChat('Summarize the current ChatGPT conversation'), false)
  assert.equal(delegatesToChat('Ask ChatGPT to explain this concept'), true)
})
test('search actions as well as typing recognize an already-submitted Google query', () => {
  assert.equal(flow.planSearchAction({ type:'search', target:'lx obsidian labs', value:'' }, 'https://www.google.com/search?q=lx+obsidian+labs').status, 'already-submitted')
  const result = flow.planSearchAction({ type:'search', target:'lx obsidian labs', value:'' }, 'https://example.com')
  assert.equal(result.query, 'lx obsidian labs')
  assert.equal(result.action.target, 'https://www.google.com/search?q=lx%20obsidian%20labs')
  assert.equal(flow.planSearchAction({type:'search',target:'bing: vista cinema apk'}, 'https://example.com').provider, 'bing')
})
test('loop budgets cover failed turns, repeated verification, deadlines and late cancellation', () => {
  const budget = new RunBudget({ maxTurns: 2 })
  budget.beginTurn(); budget.beginTurn()
  assert.throws(() => budget.beginTurn(), /planning-turn limit/)
  const failures = new RunBudget(); failures.failTurn(); failures.failTurn()
  assert.throws(() => failures.failTurn(), /3 failed turns/)
  const verification = new RunBudget(); verification.rejectCompletion(); verification.rejectCompletion()
  assert.throws(() => verification.rejectCompletion(), /3 attempts/)
  let time = 0; const timed = new RunBudget({ now: () => time, maxMs: 100 })
  time = 100; assert.throws(() => timed.check(), /time limit/)
  const stopped = new RunBudget(); stopped.stop()
  assert.throws(() => stopped.check(), error => error.code === 'RUN_STOPPED')
})
test('retrieval finds a middle-of-page APK description and retains its real source', () => {
  const index = new EvidenceIndex()
  index.ingest({ url:'https://example.com/vista', title:'Downloads', contentText: 'Navigation noise. '.repeat(270) + 'Vista Cinema Android APK download is available here. '.repeat(10) + 'Footer noise. '.repeat(250) })
  const hits = index.retrieve('Vista Cinema Android APK')
  assert.equal(hits[0].url, 'https://example.com/vista')
  assert.match(hits[0].text, /Vista Cinema/)
  index.clear(); assert.equal(index.retrieve('Vista').length, 0)
})
test('observed destination links survive beyond the first eight navigation links', () => {
  const links = Array.from({ length: 30 }, (_, i) => ({ text:'Menu ' + i, href:'https://example.com/menu/' + i }))
  links.push({ text:'Download Vista Cinema APK', href:'https://example.com/vista.apk?signature=' + 'a'.repeat(250) })
  assert.equal(rankLinks(links, 'download vista cinema apk')[0].href, links[30].href)
  assert.equal(rankLinks([{ text:'fake', href:'javascript:alert(1)' }], 'fake').length, 0)
})
test('observed result routing skips provider navigation and previously visited destinations', () => {
  const links = [
    {text:'LX Obsidian Labs search',href:'https://www.google.com/search?q=lx+obsidian+labs'},
    {text:'LX Obsidian Labs',href:'https://www.lxobsidianportal.co.za/'},
    {text:'LX Obsidian Labs Downloads',href:'https://www.lxobsidianportal.co.za/downloads'}
  ]
  assert.equal(searchResult(links,'lx obsidian labs').href, links[1].href)
  assert.equal(searchResult(links,'lx obsidian labs',new Set([links[1].href])).href, links[2].href)
})
test('a unique Explore Vista label resolves inside a larger product card; ambiguous labels do not', () => {
  const links = [{text:'01 / ENTERTAINMENT\nVista Cinema\nFestive movie discovery.\nExplore Vista ↗', href:'https://www.lxobsidianportal.co.za/vista'}]
  assert.equal(resolveLink(links,'Explore Vista ↗').href, links[0].href)
  assert.equal(resolveLink([...links,{text:'Another product. Explore Vista ↗',href:'https://example.com/other'}],'Explore Vista'), null)
})
