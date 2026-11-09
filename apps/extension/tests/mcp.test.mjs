import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/mcp.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'Mcp' })
function harness(fetch) {
  const store = {}
  const context = vm.createContext({
    URL, crypto: webcrypto, AbortController, setTimeout, clearTimeout, fetch,
    chrome: { runtime: { getManifest: () => ({ version: '1.3.0' }) }, storage: { local: {
      get: async key => ({ [key]: store[key] }), set: async value => Object.assign(store, value),
    } } },
  })
  vm.runInContext(bundle.outputFiles[0].text, context)
  return context.Mcp
}
const json = (req, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), { headers: { 'Content-Type': 'application/json' } })

test('MCP handshake precedes tools, shares concurrent initialization and supports stateless servers', async () => {
  const calls = []
  const client = harness(async (_url, options) => {
    const req = JSON.parse(options.body); calls.push(req)
    if (req.method === 'initialize') return json(req, { protocolVersion: '2025-06-18' })
    if (req.method === 'notifications/initialized') { assert.equal(req.id, undefined); return new Response(null, { status: 202 }) }
    assert.equal(options.headers['MCP-Protocol-Version'], '2025-06-18')
    return json(req, { tools: [] })
  })
  const connection = await client.enablePreset('deepwiki')
  await Promise.all([client.listTools(connection.id), client.listTools(connection.id)])
  assert.equal(calls.filter(c => c.method === 'initialize').length, 1)
  assert.deepEqual(calls.map(c => c.method).slice(0, 2), ['initialize', 'notifications/initialized'])
})
test('SSE response matches request ID rather than a trailing server notification', async () => {
  const client = harness(async (_url, options) => {
    const req = JSON.parse(options.body)
    if (req.method === 'initialize') return json(req, { protocolVersion: '2025-03-26' })
    if (req.method === 'notifications/initialized') return new Response(null, { status: 202 })
    const result = { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: 'verified output' }] } }
    const body = `: keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(result)}\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\r\n\r\n`
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  const connection = await client.enablePreset('deepwiki')
  const result = await client.callTool(connection.id, 'ask_wiki_question', { question: 'How?' })
  assert.equal(result.content[0].text, 'verified output')
})
test('required credentials are enforced and not exposed by listing connections', async () => {
  const client = harness(async () => new Response(null, { status: 401 }))
  assert.throws(() => client.enablePreset('github'), /requires an access token/)
  const connection = await client.enablePreset('github', 'test-placeholder')
  assert.equal((await client.listConnections())[0].token, undefined)
  await assert.rejects(client.listTools(connection.id), /configure an access token/)
  await assert.rejects(client.callTool(connection.id, 'bad tool name', {}), /Invalid tool name/)
})
