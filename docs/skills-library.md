# Synapse 1.3 test build: Skills Library

## What ships

The extension contains 18 independently named, Synapse-authored workflow playbooks.
They are reviewed summaries and adaptations with source links, not copies of the
upstream skill packages or their native executables.

- **Skills** opens a searchable, category-filtered library. Switches persist in
  `chrome.storage.local` under `synapse_skills_v1`.
- Up to three enabled playbooks, ranked against the objective, enter each browser
  planning turn. Disabling every playbook produces no skill prompt context.
- **Open studio** selects a playbook. **Run playbook** uses the configured AI
  service to generate text. Studio follow-ups retain a bounded, per-playbook
  conversation in memory until the panel closes. Studio does not execute tools.
- **Prepare browser task** transfers a reviewed browser/extraction instruction to
  Chat. It does not send the instruction until the user presses Send.
- Runtime requirements are displayed separately from playbook availability.

## Included sources and practical uses

| Playbook | Source | Useful in Synapse |
| --- | --- | --- |
| Chrome Extensions | googlechrome/modern-web-guidance | MV3 architecture and publication reviews |
| Chrome Extension | samber/cc-skills | Messaging, permission and lifecycle planning |
| CRXJS | samber/cc-skills | Plan a manifest-driven build/HMR migration |
| Grill Me | mattpocock/skills | Interview the user about a plan, one question per turn |
| Agent Browser | vercel-labs/agent-browser | Fresh observations and verified browser outcomes |
| Agent Browser | halt-catch-fire/skills | Provider-specific workflow reference |
| Agent Browser | qu-skills/skills | Provider-specific workflow reference |
| Agent Browser | 101-skills/skills | Provider-specific workflow reference |
| Use My Browser | xixu-me/skills | Work in the user's current signed-in tab |
| BrowserAct | browser-act/skills | Rendered-content workflow and failure diagnosis |
| Anti-Detect Browser | antibrow/anti-detect-browser-skills | Plan isolated profiles and device-consistent testing |
| Computer Use | stablyai/orca | Observe-first interaction planning |
| Just Scrape | scrapegraphai/just-scrape | Structured extraction schema and source-linked data brief |
| Reverse Engineer Anything | Speedrunlab/reverse-engineer-anything | Evidence/hypothesis separation and behavior specifications |
| AI Research Reproduction | lllllllama/rigorpilot-skills | README-first minimal-run reproduction plan |
| Caveman Compress | juliusbrussee/caveman | Compress supplied prose while preserving technical strings |
| Caveman Help | juliusbrussee/caveman | Concise-writing explanation and examples |
| Website to Video | heygen-com/hyperframes | Timed storyboard, narration and asset brief |

The requested Orca slug `computer-use` was not found upstream; the repository
listed `orca-computer-use`. Hyperframes did not list `website-to-video` when
installation was attempted. These two entries are explicitly labeled adaptations,
not successful installations of those upstream slugs.

## Execution boundaries

Chrome cannot execute npm/Python CLIs, launch a custom Chromium engine, analyze
native binaries, train models, or render a Hyperframes video merely by loading a
skill file. Those capabilities require separate authenticated services or a local
companion bridge. The current companion is not connected through native messaging.
No adapter availability is inferred from a saved playbook switch.

Current native browser work uses Synapse's existing content script actions.
Anti-detect fingerprint modification, arbitrary desktop control, cloud crawling,
research execution and video rendering are not implemented by this test build.

## MCP integrations

Settings includes DeepWiki, Context7, Hugging Face, 1ClickWebsite and GitHub presets.
Enabling saves configuration. **Tools** performs protocol initialization and actual
tool discovery; a successful toggle alone does not prove endpoint availability.
GitHub and 1ClickWebsite require credentials. MCP tool runs remain manually
confirmed in Settings, not autonomously selected by the browser agent.

The transport now sends `notifications/initialized`, shares initialization between
concurrent requests, remembers stateless initialization, uses the negotiated
protocol version and matches SSE responses by JSON-RPC request ID. Its finite
response reader does not implement an indefinitely open server-event subscription.

## Test locally

From `apps/extension`:

```powershell
$env:SUPABASE_PROXY_URL="https://fvfrbxyrlonmucyvzppk.supabase.co/functions/v1/nvidia-proxy"
node build.mjs
npm test
npx playwright install chromium
npm run test:ui
python package.py
```

The UI suite loads the real unpacked extension in Chromium. It checks persistence,
search/filtering, actual planner prompt inclusion, browser-task preparation,
360px overflow and light mode. AI Studio success/error responses are mocked;
this is not a live NVIDIA integration test. MCP protocol tests use mock HTTP
responses, not authenticated third-party accounts.

Local verification for this build: 22 regression tests and 3 real-extension UI
tests passed. An additional live probe using the transport discovered 2 Context7
tools and 4 Hugging Face tools. The latest DeepWiki probe failed at the network
layer; its current availability is not established. GitHub and 1ClickWebsite
authenticated calls and the live AI text-generation service were not tested.

The ZIP name derives from the built manifest version and is validated for required
root-level assets and ZIP integrity. GitHub CI builds with the proxy URL and
publishes a versioned test prerelease after its checks pass.

## Test in Chrome or Edge

1. Extract `synapse-ai-v1.3.0-test.zip` into a new folder.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode and
   choose **Load unpacked**. Select the extracted folder containing `manifest.json`.
3. Open Synapse, complete or skip setup, then open **Skills**.
4. Try Grill Me with a product idea, or Caveman Compress with supplied text.
5. Try Use My Browser, prepare a current-page summary task, then review and send
   it from Chat. Configure AI in Settings if the shared service is unavailable.
6. In Settings, enable DeepWiki and choose Tools to check real endpoint discovery.
