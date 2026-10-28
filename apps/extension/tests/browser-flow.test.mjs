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

test('YouTube results choose the first relevant official video, not a channel',()=>{
  const s={
    url:'https://www.youtube.com/results?search_query=Giveon+popular+songs',
    links:[
      {text:'GIVĒON @Giveon - channel',href:'https://www.youtube.com/@Giveon'},
      {text:'Unrelated singer - video',href:'https://www.youtube.com/watch?v=12345678901'},
      {text:'GIVĒON - Heartbreak Anniversary (Official Music Video)',href:'https://www.youtube.com/watch?v=ABCDEFGHIJK'},
      {text:'GIVĒON - Another Song',href:'https://www.youtube.com/watch?v=ABCDEFGHIJL'}
    ]
  }
  const a=flow.videoActionForObjective("Open YouTube, search for Giveon’s most popular songs, play the first relevant music video, and confirm that playback has started.",s)
  assert.deepEqual(a,{type:'navigate',target:'https://www.youtube.com/watch?v=ABCDEFGHIJK',value:''})
})
test('On YouTube watch page, suppress repeated search and verify actual playback',()=>{
  const objective="Open YouTube, search for Giveon’s most popular songs, play the first relevant music video"
  const watch='https://www.youtube.com/watch?v=ABCDEFGHIJK'
  assert.deepEqual(flow.videoActionForObjective(objective,{url:watch,mediaPlayback:{playing:false,currentTime:0}}),{type:'media',target:'play',value:''})
  assert.deepEqual(flow.videoActionForObjective(objective,{url:watch,mediaPlayback:{playing:true,currentTime:2}}),{type:'done',target:'',value:''})
  assert.equal(flow.isYouTubeWatch(watch),true)
  assert.equal(flow.isYouTubeWatch('https://www.youtube.com/results?search_query=Giveon'),false)
})
test('Playback verification requires media time to advance while playing',()=>{
  assert.equal(flow.hasAdvancedPlayback({playing:true,currentTime:1},{playing:true,currentTime:2}),true)
  assert.equal(flow.hasAdvancedPlayback({playing:true,currentTime:1},{playing:true,currentTime:1}),false)
  assert.equal(flow.hasAdvancedPlayback({playing:true,currentTime:1},{playing:false,currentTime:2}),false)
})
test('Do not take control of ordinary non-playback YouTube research',()=>{
  const state={url:'https://www.youtube.com/watch?v=ABCDEFGHIJK',mediaPlayback:{playing:true,currentTime:1}}
  assert.equal(flow.videoActionForObjective('Read YouTube video description',state),null)
})
