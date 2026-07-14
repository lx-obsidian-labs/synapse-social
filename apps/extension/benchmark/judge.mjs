// judge.mjs — Agent-as-a-judge scoring for Synapse benchmark tasks.
//
// Ported from browser-use/benchmark's judge.py: an independent LLM grades the
// agent execution trace against the task + ground-truth answer, returning a
// structured verdict (verdict, failure_reason, impossible_task, reached_captcha)
// with ground-truth treated as highest priority and strict "did the action
// actually happen" verification.

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions'

// Text judge model (fast, capable).
const JUDGE_MODEL = 'qwen/qwen3.5-122b-a10b'
// Vision judge model, used only when screenshots are attached (JUDGE_VISION=1).
const JUDGE_VISION_MODEL = 'qwen/qwen3.5-122b-a10b'

function callNvidia(messages, apiKey, { timeout = 30000, temperature = 0, model = JUDGE_MODEL } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  return fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: 800,
      top_p: 0.9,
    }),
    signal: controller.signal,
  })
    .then((res) => {
      clearTimeout(timer)
      if (res.status === 429 || res.status === 503) return { skip: true, status: res.status }
      if (!res.ok) return res.text().then((t) => ({ error: `HTTP ${res.status}: ${t.slice(0, 200)}` }))
      return res.json()
    })
    .then((data) => {
      if (data.skip || data.error) return data
      return { content: data.choices?.[0]?.message?.content || '' }
    })
    .catch((err) => ({ error: String(err) }))
}

function extractJson(text) {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

function truncate(text, max = 40000) {
  return text.length <= max ? text : text.slice(0, max - 20) + '...[truncated]...'
}

// Build judge messages. `evidence`:
//   { task, final_result, agent_steps:[str], screenshots_b64:[str], pageInfo, ctx }
function buildMessages(evidence, { vision }) {
  const task = truncate(evidence.task?.confirmed_task || evidence.task || '')
  const groundTruth = evidence.task?.answer || evidence.ground_truth || ''
  const steps = truncate((evidence.agent_steps || []).join('\n'))
  const finalResult = truncate(evidence.final_result || '')
  const pageText = truncate(evidence.pageInfo?.text?.slice(0, 4000) || '')

  const groundTruthSection = groundTruth
    ? `
**GROUND TRUTH VALIDATION (HIGHEST PRIORITY):**
The <ground_truth> section contains verified correct information for this task. This can be:
- Evaluation criteria that must be met
- Factual answers (e.g. "1815", "Canberra", "Jensen Huang")
- Expected outcomes after completion
The ground truth takes ABSOLUTE precedence. If it is NOT satisfied by the agent's execution and final response, the verdict MUST be false.
`
    : ''

  const systemPrompt = `You are an expert judge evaluating browser automation agent performance.

<evaluation_framework>
${groundTruthSection}
**PRIMARY EVALUATION CRITERIA (in order of importance):**
1. Task Satisfaction (most important): Did the agent accomplish what the user asked? Break the task into key criteria and verify each. Focus on user intent and final outcome.
2. Output Quality: Is the final result in the correct format and complete? Does it match exactly what was requested?
3. Tool Effectiveness: Were browser interactions effective? How many tools failed?
4. Agent Reasoning: Quality of decision-making and recovery.
5. Browser Handling: Navigation stability, error recovery. If the page did not load, a captcha blocked the task, or the browser crashed, the score must be very low.

**VERDICT GUIDELINES:**
- true: Task completed as requested, human-like execution, all key criteria met, no fabricated information.
- false: Task not completed, or only partially completed.

**FAILURE CONDITIONS (verdict false):**
- Blocked by captcha or missing authentication
- Output format wrong or missing
- Infinite loops or severe technical failures
- Critical user requirements ignored
- Page not loaded / browser crashed
- Agent could not interact with required UI elements
- Agent moved on from an important step without completing it
- Agent made up content not present in the page/screenshot
- Agent called done before completing all key points

**IMPOSSIBLE TASK DETECTION (impossible_task=true):** task fundamentally could not be completed due to:
- Vague/ambiguous instructions
- Website genuinely broken (be conservative)
- Required links truly inaccessible (404/403)
- Requires auth/login but no credentials provided
- Functionality does not exist on the target site
Do NOT mark impossible if the agent made poor decisions but the task was achievable.

**CAPTCHA DETECTION (reached_captcha=true):** screenshots show captcha challenges, agent reports bot-detection blocking, or anti-bot errors.

**IMPORTANT:** Be very picky about the user's request — high standard for exact completion. Be initially doubtful of the agent's self-reported success; verify its methods actually fulfill the user's desires.
</evaluation_framework>

<response_format>
Respond with EXACTLY this JSON (no text before or after):
{"reasoning": "Breakdown of task into key points and analysis of what worked/did not.", "verdict": true or false, "failure_reason": "Max 5 sentences if failed, else empty string.", "impossible_task": true or false, "reached_captcha": true or false}
</response_format>`

  const groundTruthPrompt = groundTruth ? `\n<ground_truth>\n${groundTruth}\n</ground_truth>\n` : ''

  const userText = `
<task>
${task || 'No task provided'}
</task>
${groundTruthPrompt}
<agent_trajectory>
${steps || 'No trajectory provided'}
</agent_trajectory>

<final_page_text>
${pageText || '(none)'}
</final_page_text>

<final_result>
${finalResult || 'No final result provided'}
</final_result>

${vision && evidence.screenshots_b64?.length ? `${evidence.screenshots_b64.length} screenshot(s) from execution are attached.` : 'No screenshots attached.'}

Evaluate this agent execution and respond with the exact JSON structure requested.`

  if (vision && evidence.screenshots_b64?.length) {
    const content = [{ type: 'text', text: userText }]
    for (const img of evidence.screenshots_b64.slice(-10)) {
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } })
    }
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ]
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ]
}

// Returns { verdict:bool|null, failure_reason, impossible_task:bool, reached_captcha:bool, reasoning, confidence }
export async function scoreTask(evidence, apiKey, { vision = false } = {}) {
  if (!apiKey) {
    return {
      verdict: null,
      failure_reason: '',
      impossible_task: false,
      reached_captcha: false,
      reasoning: 'No NVIDIA_API_KEY set — run with --no-judge to record execution only.',
      confidence: 0,
    }
  }

  const model = vision ? JUDGE_VISION_MODEL : JUDGE_MODEL
  const messages = buildMessages(evidence, { vision })
  const result = await callNvidia(messages, apiKey, { timeout: 30000, temperature: 0, model })

  if (result.skip) return { verdict: null, failure_reason: '', impossible_task: false, reached_captcha: false, reasoning: `Judge rate-limited (HTTP ${result.status})`, confidence: 0 }
  if (result.error) return { verdict: null, failure_reason: '', impossible_task: false, reached_captcha: false, reasoning: `Judge error: ${result.error}`, confidence: 0 }

  const parsed = extractJson(result.content || '')
  if (!parsed) {
    return { verdict: null, failure_reason: '', impossible_task: false, reached_captcha: false, reasoning: `Judge returned no JSON: ${(result.content || '').slice(0, 160)}`, confidence: 0 }
  }
  return {
    verdict: parsed.verdict === true,
    failure_reason: String(parsed.failure_reason || ''),
    impossible_task: parsed.impossible_task === true,
    reached_captcha: parsed.reached_captcha === true,
    reasoning: String(parsed.reasoning || ''),
    confidence: parsed.verdict === true ? 0.9 : 0.1,
  }
}
