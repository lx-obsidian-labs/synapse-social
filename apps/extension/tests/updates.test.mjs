import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const bundle = await build({ entryPoints:[fileURLToPath(new URL('../src/updates.ts',import.meta.url))], bundle:true, write:false, format:'iife', globalName:'Updates' })
function harness(fetch, initial = {}) {
  const storage = { ...initial }
  const context = vm.createContext({ fetch, AbortController, setTimeout, clearTimeout, chrome:{ runtime:{getManifest:()=>({version:'1.4.1'})}, storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)}} } })
  vm.runInContext(bundle.outputFiles[0].text,context)
  return context.Updates
}
function release(version, { prerelease = true, draft = false } = {}) {
  const tag = 'v' + version + (prerelease ? '-test' : '')
  const name = 'synapse-ai-v' + version + (prerelease ? '-test' : '') + '.zip'
  return { tag_name:tag, prerelease, draft, body:'Release notes', assets:[{name,state:'uploaded',browser_download_url:'https://github.com/lx-obsidian-labs/synapse-social/releases/download/' + tag + '/' + name}] }
}
test('update discovery includes test releases and sorts versions numerically', () => {
  const api = harness(null)
  const result = api.selectRelease([release('1.9.0'),release('1.10.0'),release('1.8.0',{prerelease:false})])
  assert.equal(result.version,'1.10.0')
  assert.match(result.downloadUrl,/1\.10\.0-test/)
  assert.equal(api.compareVersions('1.4.1','1.4.1'),0)
})
test('draft, missing, foreign or non-extension release assets are not advertised', () => {
  const api = harness(null)
  const foreign = release('9.0.0'); foreign.assets[0].browser_download_url = 'https://example.com/app.zip'
  const missing = release('8.0.0'); missing.assets = []
  assert.equal(api.selectRelease([release('10.0.0',{draft:true}),foreign,missing]),null)
  const stable = api.selectRelease([release('1.5.0'),release('1.5.0',{prerelease:false})])
  assert.equal(stable.prerelease,false)
})
test('automatic checks share a request and use cache; manual checks refresh', async () => {
  let calls = 0
  const api = harness(async () => { calls++; return new Response(JSON.stringify([release('1.5.0')])) })
  const [a,b] = await Promise.all([api.checkForUpdate(),api.checkForUpdate()])
  assert.equal(calls,1); assert.equal(a.available,true); assert.equal(b.latestVersion,'1.5.0')
  await api.checkForUpdate(); assert.equal(calls,1)
  await api.checkForUpdate(true); assert.equal(calls,2)
})
test('offline checks report unknown status and never claim a fresh up-to-date check', async () => {
  const api = harness(async () => { throw new Error('offline') })
  const result = await api.checkForUpdate()
  assert.equal(result.installedVersion,'1.4.1'); assert.equal(result.available,false)
  assert.match(result.error,/offline/); assert.equal(result.checkedAt,undefined)
})
test('a cache from an older installed version is rechecked after an upgrade', async () => {
  let calls = 0
  const api = harness(async () => { calls++; return new Response(JSON.stringify([release('1.4.1')])) },{
    synapse_update_cache_v1:{installedVersion:'1.4.0',checkedAt:Date.now(),latestVersion:'1.4.0'}
  })
  const result = await api.checkForUpdate()
  assert.equal(calls,1); assert.equal(result.available,false); assert.equal(result.latestVersion,'1.4.1')
})
