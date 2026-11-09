import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const skills = require('../src/skills.js')

test('every requested skill source has a unique identity, including browser variants', () => {
  assert.equal(skills.catalog.length, 18)
  assert.equal(new Set(skills.catalog.map(s => s.id)).size, 18)
  assert.equal(skills.catalog.filter(s => s.id.startsWith('agent-browser-')).length, 4)
  for (const item of skills.catalog) assert.equal(new URL(item.source).protocol, 'https:')
})
test('disabled and unknown playbooks never enter the planner prompt', () => {
  assert.equal(skills.prompt([], 'browse'), '')
  assert.equal(skills.prompt(['not-installed'], 'browse'), '')
  assert.deepEqual(skills.normalize(['grill-me', 'grill-me', 'bad']), ['grill-me'])
})
test('enabled matching playbooks retain execution limits and bounded context', () => {
  const selected = skills.select(skills.catalog.map(s => s.id), 'CRXJS Vite builds')
  assert.equal(selected[0].id, 'crxjs')
  assert.equal(selected.length, 3)
  assert.match(skills.prompt(['crxjs'], 'migrate'), /not in this extension/)
  assert.match(skills.prompt(['website-to-video'], 'video'), /Do not claim to have rendered/)
})
