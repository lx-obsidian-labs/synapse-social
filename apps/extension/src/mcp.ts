/** MCP Streamable HTTP client. Connections are configured by the user, never auto-discovered. */
export type McpConnection = { id: string; name: string; url: string; token?: string; readOnly?: boolean };
const STORE = 'synapse_mcp_connections_v1';
const TIMEOUT = 20000;
export async function listConnections(): Promise<Omit<McpConnection, 'token'>[]> {
  const r = await chrome.storage.local.get(STORE);
  return ((r[STORE] || []) as McpConnection[]).map(({id,name,url,readOnly})=>({id,name,url,readOnly:readOnly === true}));
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
  next.push({id,name,url,token:String(data.token || '').trim().slice(0,2048),readOnly:data.readOnly === true});
  await chrome.storage.local.set({[STORE]:next});
  sessions.delete(id);
  initialized.delete(id);
  return {id,name,url};
}
export async function removeConnection(id: string) {
  await chrome.storage.local.set({[STORE]:(await allConnections()).filter(c=>c.id!==id)});
  sessions.delete(id);
  initialized.delete(id);
  return {success:true};
}
const sessions = new Map<string,string>();
const initialized = new Set<string>();
async function request(id: string, method: string, params: any = {}, notification = false): Promise<any> {
  const c = (await allConnections()).find(c=>c.id===id);
  if (!c) throw new Error('Unknown MCP server');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), TIMEOUT);
  try {
    const headers: Record<string,string> = {'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-03-26'};
    if (c.token) headers.Authorization = 'Bearer ' + c.token;
    if (c.readOnly && new URL(c.url).hostname === 'api.githubcopilot.com') headers['X-MCP-Readonly'] = 'true';
    if (sessions.has(id)) headers['Mcp-Session-Id'] = sessions.get(id)!;
    const requestId = crypto.randomUUID();
    const response = await fetch(c.url,{method:'POST',headers,body:JSON.stringify(notification ? {jsonrpc:'2.0',method,params} : {jsonrpc:'2.0',id:requestId,method,params}),signal:controller.signal,redirect:'error'});
    if (!response.ok) {
      if (response.status === 404) { sessions.delete(id); initialized.delete(id); }
      throw new Error('MCP HTTP ' + response.status);
    }
    const sid = response.headers.get('Mcp-Session-Id');
    if (sid) sessions.set(id,sid);
    if (notification && response.status === 202) return null;
    const raw = await response.text();
    if (notification && !raw.trim()) return null;
    if (raw.length > 1024*1024) throw new Error('MCP response too large');
    let result: any;
    if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
      const events = raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).filter(line=>line && line!=='[DONE]');
      result = JSON.parse(events[events.length-1] || '{}');
    } else result = JSON.parse(raw);
    if (result.error) throw new Error(String(result.error.message || 'MCP error'));
    if (!notification && result.id !== requestId) throw new Error('MCP response id mismatch');
    return result.result;
  } finally {clearTimeout(timer)}
}
async function ensureInitialized(id: string) {
  if (initialized.has(id)) return;
  const result = await request(id,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'Synapse AI',version:'1.2.0'}});
  if (!result || typeof result.protocolVersion !== 'string') throw new Error('MCP server did not return a valid initialization response');
  await request(id,'notifications/initialized',{},true);
  initialized.add(id);
}
export async function listTools(id: string) {await ensureInitialized(id);return request(id,'tools/list',{});}
export async function callTool(id: string, name: string, args: any) {
  if (!/^[\w./-]{1,150}$/.test(name)) throw new Error('Invalid tool name');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
  await ensureInitialized(id);
  const catalog = await request(id,'tools/list',{});
  if (!Array.isArray(catalog?.tools) || !catalog.tools.some((tool: {name?: string})=>tool.name === name)) {
    throw new Error('Tool is not advertised by this MCP server: ' + name);
  }
  const result = await request(id,'tools/call',{name,arguments:args});
  if (result?.isError) throw new Error('MCP tool error: ' + JSON.stringify(result.content || []).slice(0,500));
  return result;
}
