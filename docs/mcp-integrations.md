# Synapse AI — MCP integration plan and setup

This repository contains **two different runtimes**:

- `apps/web`: the conversation-first Next.js application. Its `/api/chat` currently calls NVIDIA NIM. It **does not** execute MCP tools.
- `apps/extension`: Manifest V3 extension with existing browser automation and an HTTP MCP client.
- `apps/mcp-companion`: local Node.js MCP host supporting stdio subprocesses and Streamable HTTP connections. It requires `approved: true` for calls, but callers must enforce *real user confirmation* before setting that field.

Never expose stdio processes, browser debugging ports, or authenticated MCP sessions on the public Next.js deployment. A remote website cannot launch `uvx` or `npx` on a user's computer.

## Verified upstream references

| Provider | Source | Usage |
| --- | --- | --- |
| Chrome DevTools MCP | https://github.com/ChromeDevTools/chrome-devtools-mcp | Local browser interaction, debugging, traces |
| LinkedIn MCP | https://github.com/stickerdaniel/linkedin-mcp-server | Authenticated LinkedIn reading and supported messaging |
| Firecrawl | https://github.com/firecrawl/firecrawl-mcp-server | Search, scraping, crawling; usage-dependent costs |
| Browserbase | https://mcp.browserbase.com/mcp | Optional cloud browser, managed credentials and usage |
| MCP reference servers | https://github.com/modelcontextprotocol/servers | Educational patterns; review before production |
| Archived Puppeteer MCP | https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer | Do not use as the default browser provider |

## Local companion setup

From the monorepo root:

```bash
pnpm install --frozen-lockfile
pnpm --filter synapse-mcp-companion start
```

The companion exchanges JSON-lines with a **trusted local process** over stdin/stdout, not a public HTTP port. One JSON request per line, with a unique `id`.

### Connect Chrome DevTools (local)

```json
{"id":"1","method":"connect","name":"chrome","config":{"transport":"stdio","command":"npx","args":["-y","chrome-devtools-mcp@latest","--no-usage-statistics","--isolated"]}}
```

Chrome DevTools can see the contents of its Chrome browser. The `--isolated` flag is recommended for separate test profiles. Review browser access carefully.

### Connect LinkedIn (local)

Install uv first, then authenticate on your own machine with `uvx mcp-server-linkedin --login`. The server stores login state locally. Do not share cookies, passwords or the stored browser profile.

```json
{"id":"2","method":"connect","name":"linkedin","config":{"transport":"stdio","command":"uvx","args":["mcp-server-linkedin"],"env":{"UV_HTTP_TIMEOUT":"300"}}}
```

The LinkedIn MCP mainly supports reading and account interactions; it does **not** currently expose direct profile-section editing methods. Browser actions that alter the account require separate controls, and may be subject to LinkedIn's terms.

### Connect Firecrawl (hosted, limited keyless mode)

```json
{"id":"3","method":"connect","name":"firecrawl","config":{"transport":"http","url":"https://mcp.firecrawl.dev/v2/mcp"}}
```

Keyless usage has reduced functionality. For authenticated usage, add secret-header support to the companion and keep keys in a local secret store or server environment. Never include credentials in prompts or repository files.

### Browserbase (optional)

```json
{"id":"4","method":"connect","name":"browserbase","config":{"transport":"http","url":"https://mcp.browserbase.com/mcp"}}
```

This requires the provider's supported authentication flow. Its former self-hosted repository is archived. Test cost and session limitations before enabling it.

## Companion commands

```json
{"id":"5","method":"connections"}
{"id":"6","method":"listTools","name":"chrome"}
{"id":"7","method":"callTool","name":"chrome","tool":"list_pages","arguments":{},"approved":true}
{"id":"8","method":"disconnect","name":"chrome"}
```

A call carrying `approved:true` is **not** proof the human approved it. A future orchestration bridge must issue user-visible confirmations and bind approval to exact server/tool/arguments before forwarding it to the companion. Until that bridge exists, treat the companion as a developer tool, not an autonomous internet-facing agent.

## Tool execution architecture (next implementation stage)

1. A privileged, locally installed Synapse companion maintains the MCP connections.
2. The chat assistant proposes a structured tool call and shows its plan to the human.
3. A typed tool registry matches a provider, checks an explicit allowlist and validates inputs.
4. Sensitive effects (posting, sending, deleting, applying, purchases, credential access) always require per-action confirmation.
5. The agent calls the local companion *only after* verification of that confirmation.
6. Results are sanitized, size-bounded, and quoted as untrusted external observations, not followed as instructions.
7. Store non-secret execution receipts with time, server, tool, approval ID and result.
8. Expose pause, stop, budget and time limits.
9. Provide a single chat-based interface for these actions, with an expandable activity log rather than a wall of buttons.

## Acceptance criteria

- `pnpm --filter synapse-web typecheck` and `pnpm --filter synapse-web build` pass.
- The new web home page opens chat directly on mobile and desktop.
- Several conversations can be created, switched and deleted; only browser-local history persists.
- No UI text implies an MCP provider is connected when it is not.
- Companion can connect to a trusted test MCP server, list tools, run a **human-approved** read-only call, and disconnect.
- LinkedIn end-to-end test requires a locally authenticated browser session and cannot be verified from GitHub alone.
- No credentials committed to the repository.
- Extension's existing browser automation continues to work; its side-panel conversion is a separate, still-open milestone.

## Current scope and limitations

This branch implements a **chat-first web shell** and general-purpose assistant prompt. It creates an integration guide and provider catalogue, **not** an end-to-end tool-calling agent. To claim functional integrations, implement the secure local app-to-companion bridge, action-approval UI and automated integration tests described above. Do not deploy this branch as a full autonomous agent until those checks pass.
