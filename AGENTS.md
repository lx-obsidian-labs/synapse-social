# Synapse AI — Project Guide (read me first)

This is the top-level guide for any developer or AI agent working in this
repository. It explains **what the app is**, **how it is built**, **how it is
distributed**, and **how to release new versions**. For the extension's runtime
capabilities (the 30+ browser actions the in-app agent can perform), see
[`apps/extension/AGENTS.md`](apps/extension/AGENTS.md).

---

## 1. What is Synapse AI?

**Synapse AI** is an AI-powered browser extension (Chrome / Edge / Brave,
Manifest V3) that turns any web page into an autonomous, controllable workspace.
It runs an **observe → plan → execute → verify** agent loop: it reads the live
page, an AI model picks one action, the extension performs it, checks the
result, and repeats until the objective is done.

Highlights:
- Autonomous web automation (navigate, click, type, extract, fill forms, etc.)
- AI content generation with a brand/creator profile (LX Obsidian Labs voice)
- Facebook / social content operating system, Gmail management, Canva design
- Vision fallback (screenshot understanding) when the DOM is empty
- Self-learning memory, model rotation/failover, and a technical HUD
- Works **out of the box** — no API key required from end users

The extension talks to **NVIDIA NIM** models. The API key is **never shipped**
inside the extension; it lives server-side in a Supabase Edge Function proxy
(see §4).

---

## 2. Repository layout

```
/apps/
  extension/        # The Chrome extension (the product that ships)
    src/
      background.ts # Service worker: AI calls, model routing, proxy/key logic
      content.ts    # In-page tools (DOM actions, extraction, automation)
      sidepanel.js  # The agent loop, planner prompts, UI logic
      sidepanel.html / popup.html
    public/icons/   # Extension icons
    manifest.json   # MV3 manifest (source of truth for the version number)
    build.mjs       # esbuild bundler + asset copy + placeholder injection
    dist/           # Build output (gitignored) — what you load/zip
    AGENTS.md       # Runtime capability reference (all agent actions)
    INSTALL.md      # End-user install guide
  web/              # Next.js companion web app (dashboard/settings/onboarding)
  agent/            # (supporting)

/packages/          # Shared UI, types, api-client, utilities
/workers/           # Facebook parser, analytics, automation helpers

/supabase/
  functions/nvidia-proxy/index.ts  # Edge Function that holds the NVIDIA key

/scripts/
  release.ps1       # One-command build → zip → tag → GitHub Release
```

---

## 3. Building the extension

Requirements: Node.js + pnpm.

```powershell
pnpm install

# Build the extension (bakes in the Supabase proxy URL so no key is shipped)
$env:SUPABASE_PROXY_URL="https://fvfrbxyrlonmucyvzppk.supabase.co/functions/v1/nvidia-proxy"
node build.mjs        # run inside apps/extension
```

Output lands in `apps/extension/dist/`. Load it via `chrome://extensions` →
**Developer mode** → **Load unpacked** → select the `dist` folder.

`build.mjs` injects three placeholders at build time:
- `__APP_URL__`          ← `APP_URL` env (defaults to `http://localhost:3000`)
- `__SUPABASE_PROXY_URL__` ← `SUPABASE_PROXY_URL` env (the secure proxy)
- `__NVIDIA_API_KEY__`   ← `NVIDIA_API_KEY` env — **left empty when a proxy URL
  is set**, so a raw key can never leak into a public build.

> Security rule: for any public/distributed build, always set
> `SUPABASE_PROXY_URL` and confirm `dist/background.js` contains **no**
> `nvapi-` string.

---

## 4. How the API key stays secret (Supabase proxy)

The extension does **not** contain the NVIDIA key. Instead:

1. The extension POSTs chat-completion requests to the Supabase Edge Function
   `nvidia-proxy`.
2. The function adds the `NVIDIA_API_KEY` (stored as a Supabase **secret**)
   and forwards the request to `integrate.api.nvidia.com`, streaming the
   response straight back.

Runtime key resolution order (`background.ts` → `resolveEndpoint`):
1. A per-device key the user pasted in **Settings** → call NVIDIA directly.
2. The baked-in **proxy URL** → call the proxy (no key shipped). ← default
3. A baked-in NVIDIA key (dev only) → call NVIDIA directly.
4. Nothing → "AI service not configured".

Deploy / update the proxy:
```powershell
supabase link --project-ref fvfrbxyrlonmucyvzppk
supabase secrets set NVIDIA_API_KEY=nvapi-...      # your key, server-side only
supabase functions deploy nvidia-proxy --no-verify-jwt
```
Function URL: `https://fvfrbxyrlonmucyvzppk.supabase.co/functions/v1/nvidia-proxy`

> The proxy uses one shared NVIDIA key for all downloaders, so it shares your
> rate limits. Monitor usage; add rate-limiting to the function if needed.

---

## 5. Distribution & versioning

The packaged extension is published as a **GitHub Release** so the website can
always fetch the latest build.

- Repo: `github.com/lx-obsidian-labs/synapse-social`
- Latest release (for the website's download button):
  `https://api.github.com/repos/lx-obsidian-labs/synapse-social/releases/latest`
  → read `.assets[0].browser_download_url`
- Versioned download:
  `https://github.com/lx-obsidian-labs/synapse-social/releases/download/v<version>/synapse-ai-v<version>.zip`

The **version number** lives in `apps/extension/manifest.json` and drives the
tag (`v<version>`) and zip name.

### Cutting a new release (automated)

```powershell
# 1. Bump "version" in apps/extension/manifest.json
# 2. Run the release script (needs a GitHub token with 'repo' scope)
./scripts/release.ps1 -Token ghp_xxx
```

`scripts/release.ps1` will: read the version → build with the proxy URL →
verify no key leaked → zip → create & push tag `v<version>` → create the GitHub
Release → upload the zip as a download asset.

You can also set `$env:GITHUB_TOKEN` instead of passing `-Token`.

---

## 6. Using Synapse AI (end user)

1. Install (from a release zip): unzip → `chrome://extensions` → Developer mode
   → **Load unpacked** → pick the folder with `manifest.json`. See
   [`apps/extension/INSTALL.md`](apps/extension/INSTALL.md).
2. Click the Synapse AI toolbar icon to open the **side panel**.
3. Type an objective (e.g. "Find the top 5 results for X and summarise them",
   "Write and post a Facebook update about Y", "Fill this signup form").
4. The agent plans and executes step by step; use **Pause/Stop** in the HUD to
   control it. The **Enhance** button rewrites a rough instruction into a
   detailed, reliable prompt.
5. Optional: paste your own NVIDIA key in **Settings** for private/higher limits.

Full list of supported actions and site-specific playbooks (ChatGPT, Gmail,
YouTube, Facebook, Google, LinkedIn, GitHub, Canva, etc.) is in
[`apps/extension/AGENTS.md`](apps/extension/AGENTS.md).

---

## 7. Guardrails for agents editing this repo

- **Never commit secrets.** `.env` files are gitignored; keep them that way.
  Never bake `nvapi-` keys into a public build.
- **Rebuild after editing** `background.ts`, `content.ts`, or `sidepanel.js`:
  run `node build.mjs` and verify `dist/`.
- `sidepanel.js` is copied raw (not bundled), so `build.mjs` runs a syntax
  check on it — a syntax error there fails the build.
- Bump `manifest.json` version for every public release; tags/zip derive from it.
- Prefer **GitHub Releases** over committing binaries; `*.zip` is gitignored.

---

## Credits

**Synapse AI** is designed, built, and maintained by **LX Obsidian Labs**.

- Website: https://www.lxobsidianportal.co.za
- Brand: LX Obsidian Labs — enterprise software, AI, cloud, mobile, and digital
  platforms.

© LX Obsidian Labs. All rights reserved.
