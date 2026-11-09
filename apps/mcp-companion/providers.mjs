// Built-in provider templates: configuration examples, not active sessions.
// Local commands run only in the trusted desktop companion, never in the web app.
export const providers = Object.freeze({
  "chrome-devtools": {
    name: "Chrome DevTools",
    category: "browser",
    description: "Local Chrome automation, debugging and performance analysis",
    requiresAuthentication: false,
    config: { transport: "stdio", command: "npx", args: ["-y", "chrome-devtools-mcp@latest", "--isolated", "--no-usage-statistics"] },
    source: "https://github.com/ChromeDevTools/chrome-devtools-mcp"
  },
  linkedin: {
    name: "LinkedIn",
    category: "social",
    description: "Read profiles, search jobs and perform supported LinkedIn account actions",
    requiresAuthentication: true,
    config: { transport: "stdio", command: "uvx", args: ["mcp-server-linkedin"], env: { UV_HTTP_TIMEOUT: "300" } },
    source: "https://github.com/stickerdaniel/linkedin-mcp-server"
  },
  firecrawl: {
    name: "Firecrawl",
    category: "research",
    description: "Search, scrape and parse live public websites; advanced features need credentials",
    requiresAuthentication: false,
    config: { transport: "http", url: "https://mcp.firecrawl.dev/v2/mcp" },
    source: "https://github.com/firecrawl/firecrawl-mcp-server"
  },
  browserbase: {
    name: "Browserbase",
    category: "cloud-browser",
    description: "Optional managed remote browser; provider login and costs may apply",
    requiresAuthentication: true,
    config: { transport: "http", url: "https://mcp.browserbase.com/mcp" },
    source: "https://docs.browserbase.com/integrations/mcp/introduction"
  }
})
export function listProviders() {
  return Object.entries(providers).map(([id, p]) => ({
    id, name: p.name, category: p.category, description: p.description,
    requiresAuthentication: p.requiresAuthentication, source: p.source
  }))
}
export function providerConfig(id) {
  if (!Object.hasOwn(providers, id)) throw Error("Unknown provider: " + id)
  return structuredClone(providers[id].config)
}
