/** MCP Streamable HTTP client. Connections are configured by the user, never auto-discovered. */
export type McpConnection = { id: string; name: string; url: string; token?: string };
const STORE = 'synapse_mcp_connections_v1';
const TIMEOUT = 20000;
export async function listConnections(): Promise<Omit<McpConnection, 'token'>[]> {
  const r = await chrome.storage.local.get(STORE);
  return ((r[STORE] || []) as McpConnection[]).map(({id,name,url})=>({id,name,url}));
}
async function allConnections(): Promise<McpConnection[]> {
  const r = await chrome.storage.local.get(STORE);
  return Array.isArray(r[STORE]) ? r[STORE] : [];
}
function validateUrl(raw: string): string {
  const u = new URL(raw);
  if (u.username || u.password || u.hash) throw new Error('Credentials and fragments are not allowed in MCP URLs');
  const local = ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('MCP servers must use HTTPS (except localhost)');
  return u.toString();
}
export async function saveConnection(data: Partial<McpConnection>) {
  const name = String(data.name || '').trim().slice(0,80);
  if (!name) throw new Error('Server name required');
  const url = validateUrl(String(data.url || ''));
  const list = await allConnections();
  if (list.length >= 12 && !list.some(c=>c.id===data.id)) throw new Error('Maximum 12 servers');
  const id = data.id && list.some(c=>c.id===data.id) ? data.id : crypto.randomUUID();
  const next = list.filter(c=>c.id!==id);
  next.push({id,name,url,token:String(data.token || '').trim().slice(0,2048)});
  await chrome.storage.local.set({[STORE]:next});
  return {id,name,url};
}
export async function removeConnection(id: string) {
  await chrome.storage.local.set({[STORE]:(await allConnections()).filter(c=>c.id!==id)});
  return {success:true};
}
async function request(id: string, method: string, params: any = {}) {
  const c = (await allConnections()).find(c=>c.id===id);
  if (!c) throw new Error('Unknown MCP server');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), TIMEOUT);
  try {
    const headers: Record<string,string> = {'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'};
    if (c.token) headers.Authorization = 'Bearer ' + c.token;
    const response = await fetch(c.url,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:crypto.randomUUID(),method,params}),signal:controller.signal,redirect:'error'});
    if (!response.ok) throw new Error('MCP HTTP ' + response.status);
    const raw = await response.text();
    if (raw.length > 1024*1024) throw new Error('MCP response too large');
    let result: any;
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      const events = raw.split(/\\r?\\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(line=>line && line!=='[DONE]');
      result = JSON.parse(events[events.length-1] || '{}');
    } else result = JSON.parse(raw);
    if (result.error) throw new Error(String(result.error.message || 'MCP error'));
    return result.result;
  } finally {clearTimeout(timer)}
}
export async function listTools(id: string) {return request(id,'tools/list',{});}
export async function callTool(id: string, name: string, args: any) {
  if (!/^[\\w.\\/-]{1,150}$/.test(name)) throw new Error('Invalid tool name');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
  return request(id,'tools/call',{name,arguments:args});
}
