# Synapse Benchmark Harness

A **Playwright-driven** benchmark for the Synapse browser-agent extension, modeled on
[browser-use/benchmark](https://github.com/browser-use/benchmark)'s orchestrator. Because
Synapse is a *real-browser MV3 extension* (not a headless Python agent), the harness:

1. Launches Chromium with the built extension loaded (persistent profile).
2. For each task, opens the `start_url` as the **active tab** — the agent always acts on
   `chrome.tabs.query({ active: true })`, so the active tab is what it controls.
3. Starts the agent loop inside the side panel via the `window.synapse` debug hook and
   polls `getState()` until it returns to `IDLE` (finished or gave up).
4. Collects evidence (final page state, agent context, chat transcript).
5. Scores the task with an **agent-as-a-judge** LLM (`judge.mjs`) against the ground-truth
   `answer`.
6. Aggregates per-run results into `official_results/`.

## Setup

```bash
# From apps/extension
npm run build                 # build the extension into dist/

cd benchmark
npm install                   # installs playwright
npx playwright install chromium   # downloads the browser

# Required for judging
export NVIDIA_API_KEY="nvapi-..."
```

## Run

```bash
# Full run (judges every task)
node orchestrator.mjs

# Skip the LLM judge (records execution only, for manual grading)
NO_JUDGE=1 node orchestrator.mjs

# Include screenshots in judging (uses the vision judge model)
JUDGE_VISION=1 node orchestrator.mjs

# Run a subset
TASK_IDS=custom-001,gaia-001 node orchestrator.mjs

# Headless (uses --headless=new; extensions work in new headless)
HEADLESS=true node orchestrator.mjs
```

## Task format (`tasks.json`)

BU-Bench-style plus a `start_url` (the page opened before the agent starts, so the content
script is active):

```json
{
  "task_id": "gaia-001",
  "category": "GAIA",
  "confirmed_task": "Search the web for the current CEO of NVIDIA and report their name.",
  "answer": "Jensen Huang",
  "start_url": "https://www.google.com"
}
```

## Results

Per-run JSON is written to `official_results/Synapse_bench_<timestamp>.json`, one record per
task:

```json
{
  "task_id": "gaia-001",
  "success": true,
  "confidence": 0.9,
  "judge_reason": "Jensen Huang shown on page and in transcript",
  "gave_up": false,
  "steps": 6,
  "completed_actions": ["navigate", "type", "click", "extract"],
  "final_url": "https://www.nvidia.com/en-us/"
}
```

The harness prints a final success rate (judged tasks only).

## Result schema (`official_results/Synapse_bench_<timestamp>.json`)

One record per task — the judge mirrors browser-use's structured verdict:

```json
{
  "task_id": "gaia-001",
  "success": true,
  "confidence": 0.9,
  "judge_reason": "Jensen Huang shown on page and in transcript",
  "failure_reason": "",
  "impossible_task": false,
  "reached_captcha": false,
  "vision_used": false,
  "gave_up": false,
  "steps": 6,
  "completed_actions": ["navigate", "type", "click", "extract"],
  "final_url": "https://www.nvidia.com/en-us/"
}
```

- `success` — the judge's `verdict` (true/false/null when unjudged or rate-limited).
- `failure_reason` — judge's explanation when `success` is false.
- `impossible_task` — true if the task was fundamentally unachievable (auth/captcha/broken site).
- `reached_captcha` — true if the agent was blocked by anti-bot measures.
- `vision_used` — true when `JUDGE_VISION=1` and a screenshot was analyzed.

## Notes / limitations

- The agent targets the **active tab**; the harness keeps the task's web page focused.
- `--headless=new` is required for extensions in headless mode; default is headless:false
  for reliability.
- Requires network access to the sites in `tasks.json` and to the NVIDIA API for judging.
- `window.synapse` is a debug hook added to `sidepanel.js` purely for this harness; it has
  no effect on normal interactive use.
