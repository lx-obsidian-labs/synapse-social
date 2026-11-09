import test from 'node:test'
import assert from 'node:assert/strict'
import { listProviders, providerConfig } from './providers.mjs'
import { listSkills, getSkill } from './skills.mjs'

test('all four expected providers are registered', () => {
  const ids = listProviders().map(p => p.id).sort()
  assert.deepEqual(ids, ['browserbase','chrome-devtools','firecrawl','linkedin'])
})

test('provider connection config is immutable to callers', () => {
  const chrome = providerConfig('chrome-devtools')
  chrome.args.push('--bad-flag')
  assert.ok(!providerConfig('chrome-devtools').args.includes('--bad-flag'))
  assert.throws(() => providerConfig('__missing__'), /Unknown provider/)
})

test('remote providers have HTTPS endpoints', () => {
  for (const id of ['firecrawl', 'browserbase']) {
    const config = providerConfig(id)
    assert.equal(config.transport, 'http')
    assert.equal(new URL(config.url).protocol, 'https:')
  }
})

test('local providers define subprocesses', () => {
  for (const id of ['chrome-devtools', 'linkedin']) {
    const config = providerConfig(id)
    assert.equal(config.transport, 'stdio')
    assert.ok(config.command)
    assert.ok(config.args.length)
  }
})

test('skill dependencies resolve to known providers', () => {
  const ids = new Set(listProviders().map(p => p.id))
  for (const skill of listSkills()) {
    assert.ok(skill.providers.length)
    for (const provider of skill.providers) assert.ok(ids.has(provider), skill.id)
    assert.ok(['read', 'approval'].includes(skill.safety))
  }
})

test('skill detail is available and unknown IDs rejected', () => {
  const detail = getSkill('linkedin-profile-audit')
  assert.ok(detail.instructions.length >= 2)
  assert.equal(detail.safety, 'read')
  assert.throws(() => getSkill('nonexistent'), /Unknown skill/)
})
