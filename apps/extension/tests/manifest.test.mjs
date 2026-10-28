import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))

test('extension uses one consolidated required host permission', () => {
  assert.deepEqual(manifest.host_permissions, ['<all_urls>'])
  assert.equal(Object.hasOwn(manifest, 'optional_host_permissions'), false,
    'optional hosts must not overlap required <all_urls>')
})

test('browser automation permissions remain available', () => {
  for (const permission of ['storage', 'sidePanel', 'tabs', 'scripting', 'downloads']) {
    assert.ok(manifest.permissions.includes(permission), 'missing: ' + permission)
  }
  assert.ok(manifest.content_scripts.some(script =>
    script.matches.includes('<all_urls>') && script.js.includes('content.js')))
})

test('the extension keeps a valid Manifest V3 service worker and side panel', () => {
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.background.service_worker, 'background.js')
  assert.equal(manifest.side_panel.default_path, 'sidepanel.html')
})

test('document preview is packaged and renders report content as text', () => {
  const html = readFileSync(new URL('../src/document.html', import.meta.url), 'utf8')
  const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8')
  assert.match(build, /'document\.html'/)
  assert.match(html, /chrome\.storage\.local\.get/)
  assert.match(html, /textContent=doc\.content/)
  assert.match(html, /window\.print\(\)/)
  assert.match(html, /Download HTML/)
  assert.match(html, /Download TXT/)
})
