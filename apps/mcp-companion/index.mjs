// Local MCP companion: stdio or Streamable HTTP client.
// Run only on the user's machine. No remote listener is exposed.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import readline from 'node:readline'
const rl = readline.createInterface({input:process.stdin,terminal:false})
const sessions = new Map()
const respond = (id, result, error) => process.stdout.write(JSON.stringify({id,...(error?{error:String(error)}:{result})}) + String.fromCharCode(10))
async function connect(name, config) {
  if (!/^[a-z0-9_-]{1,64}$/i.test(name)) throw Error('Invalid connection name')
  if (sessions.has(name)) throw Error('Connection already exists')
  const client = new Client({name:'synapse-companion',version:'0.1.0'})
  let transport
  if (config.transport === 'stdio') {
    if (!config.command || !Array.isArray(config.args)) throw Error('Missing command/args')
    transport = new StdioClientTransport({command:config.command,args:config.args,env:{...process.env,...config.env}})
  } else if (config.transport === 'http') {
    const url = new URL(config.url)
    if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw Error('HTTPS required for remote MCP')
    transport = new StreamableHTTPClientTransport(url)
  } else throw Error('Unsupported MCP transport')
  await client.connect(transport)
  sessions.set(name,client)
  return {name,tools:(await client.listTools()).tools.map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}))}
}
rl.on('line',async line=>{
  let req
  try {
    req=JSON.parse(line)
    const {id,method,name}=req
    if(method==='connect') return respond(id,await connect(name,req.config))
    if(method==='connections') return respond(id,[...sessions.keys()])
    const client=sessions.get(name)
    if(!client) throw Error('Not connected: '+name)
    if(method==='listTools') return respond(id,(await client.listTools()).tools)
    if(method==='callTool') {
      if(!req.approved) throw Error('Tool invocation requires explicit approval')
      const tools=(await client.listTools()).tools
      if(!tools.some(t=>t.name===req.tool)) throw Error('Unknown tool')
      return respond(id,await client.callTool({name:req.tool,arguments:req.arguments||{}}))
    }
    if(method==='disconnect'){await client.close();sessions.delete(name);return respond(id,{closed:true})}
    throw Error('Unknown method')
  } catch(e){respond(req?.id??null,null,e?.message||e)}
})
process.on('SIGINT',async()=>{for(const c of sessions.values())await c.close();process.exit(0)})
