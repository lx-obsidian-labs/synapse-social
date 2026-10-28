import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const flow = require('../src/browser-flow.js')
const type = (q, target='Search') => ({type:'type',target,value:q})
test('Google search is deterministic verified navigation',()=>{
  const r=flow.planSearchAction(type('free AI coding assistants 2026'),'https://www.google.com/')
  assert.equal(r.status,'navigate')
  assert.equal(r.action.target,'https://www.google.com/search?q=free%20AI%20coding%20assistants%202026')
  assert.equal(flow.confirmsSearch(r.action.target,'free AI coding assistants 2026'),true)
})
test('YouTube search uses results URL rather than synthetic Enter',()=>{
  const r=flow.planSearchAction(type('Giveon best songs'),'https://www.youtube.com/')
  assert.equal(r.status,'navigate')
  assert.equal(flow.searchQuery(r.action.target),'Giveon best songs')
})
test('Same query already on results is not executed again',()=>{
  const r=flow.planSearchAction(type('AI assistants'),'https://www.google.com/search?q=AI+assistants')
  assert.equal(r.status,'already-submitted')
  assert.equal(flow.confirmsSearch('https://www.google.com/search?q=AI+assistants','AI assistants'),true)
})
test('Do not intercept forms on unrelated websites',()=>{
  assert.equal(flow.planSearchAction(type('abc'),'https://example.com/settings').status,'passthrough')
  assert.equal(flow.planSearchAction({type:'type',target:'Email',value:'me@x.com'},'https://www.google.com').status,'passthrough')
})
test('Does not mistake search text typed into YouTube watch page for results',()=>{
  assert.equal(flow.searchQuery('https://www.youtube.com/watch?v=123&search_query=test'),null)
})
test('Works with encoded characters and query normalization',()=>{
  assert.equal(flow.confirmsSearch('https://www.google.co.za/search?q=Giveon%27s+Songs',"giveon's songs"),true)
})
test('Rejects a mere query field without an actual submitted results URL',()=>{
  assert.equal(flow.confirmsSearch('https://www.google.com/?q=foo','foo'),false)
})

test('Three-source research cannot finish after one or two sites',()=>{
  const two=[{url:'https://cursor.com/'},{url:'https://github.com/features/copilot'}]
  const verdict=flow.researchReadiness('Research three free AI coding assistants',two)
  assert.equal(verdict.ready,false)
  assert.equal(verdict.sourceCount,2)
  assert.equal(verdict.required,3)
})
test('Three distinct source hosts satisfy the three-source gate',()=>{
  const notes=[{url:'https://cursor.com/'},{url:'https://github.com/features/copilot'},{url:'https://codeium.com/'},{url:'https://github.com/pricing'}]
  assert.equal(flow.researchReadiness('Compare three coding assistants',notes).ready,true)
  assert.equal(flow.researchReadiness('Compare three coding assistants',notes).sourceCount,3)
})
