/* Synapse-authored workflow adaptations. Upstream projects are linked, not vendored.
 * A playbook adds instructions; it never grants a new executable tool or CLI. */
;(function (root) {
  const skill = (id, name, category, source, description, guide, requirement = '') =>
    Object.freeze({ id, name, category, source, description, guide, requirement });
  const catalog = Object.freeze([
    skill('chrome-extensions', 'Chrome Extensions · Google', 'Build', 'https://github.com/googlechrome/modern-web-guidance',
      'MV3 architecture, permissions, messaging and publication review.',
      'Review manifest entries against actual assets, keep remote code out of extension pages, persist durable service-worker state, and verify side-panel opening. Separate source observations from untested behavior.'),
    skill('chrome-extension', 'Chrome Extension · Samber', 'Build', 'https://github.com/samber/cc-skills',
      'Plan extension components and reliable browser API boundaries.',
      'Map service worker, content script and extension-page responsibilities. Validate messages at trust boundaries; identify permissions and lifecycle constraints. Produce a concrete change plan and acceptance checks.'),
    skill('crxjs', 'CRXJS', 'Build', 'https://github.com/samber/cc-skills',
      'Manifest-driven Vite builds and hot-reload migration planning.',
      'Compare the existing build pipeline with a Vite/CRXJS migration. Inventory copied assets, content scripts, CSP and environment injection. Preserve distributable behavior and propose a reversible migration.',
      'Vite and @crxjs/vite-plugin run in a development environment, not in this extension.'),
    skill('grill-me', 'Grill Me', 'Planning', 'https://github.com/mattpocock/skills',
      'Sharpen an idea by challenging assumptions, one question at a time.',
      'Interview the user about their plan. Identify the highest-impact unresolved assumption, explain why it matters, and ask exactly one focused question. Use answers already supplied. Do not fabricate answers or prematurely declare the plan complete.'),
    skill('agent-browser-vercel', 'Agent Browser · Vercel', 'Browser', 'https://github.com/vercel-labs/agent-browser',
      'Snapshot → act → re-observe → verify browser workflows.',
      'Use current page observations and snapshot-scoped references. Re-observe after navigation or DOM changes; never reuse stale targets. Verify visible outcomes and report evidence. In Synapse use only its existing browser actions.',
      'The upstream agent-browser CLI requires a local browser runtime; it is not bundled.'),
    ...[
      ['halt-catch-fire', 'https://github.com/halt-catch-fire/skills'],
      ['qu-skills', 'https://github.com/qu-skills/skills'],
      ['101-skills', 'https://github.com/101-skills/skills']
    ].map(([author, source]) => skill('agent-browser-' + author, 'Agent Browser · ' + author, 'Browser', source,
      'Provider-specific browser workflow reference with a separate identity.',
      'Plan an open, interact, fresh-snapshot, verify, close workflow. Keep sessions and evidence separate. Use Synapse browser actions for current-tab work; do not claim that an external inference.sh or belt session has been started.',
      'External provider CLI, account and service configuration are not connected to Synapse.')),
    skill('use-my-browser', 'Use My Browser', 'Browser', 'https://github.com/xixu-me/skills',
      'Work in the current signed-in tab and verify rendered state.',
      'Classify whether evidence requires live browser state. For dashboards, uploads, media and forms use the live page rather than a static fetch. Prefer site-generated links, confirm changes visibly, close only task-owned tabs, and record reusable verified site behavior.'),
    skill('browser-act', 'BrowserAct', 'Browser', 'https://github.com/browser-act/skills',
      'Plan browser sessions, rendered extraction and workflow diagnostics.',
      'Use rendered state for interaction tasks. Keep browser sessions isolated, capture the observed failure before retrying, and distinguish successful navigation from task completion. Network capture and external BrowserAct execution must be reported unavailable unless actually connected.',
      'BrowserAct CLI (Python/uv) and its session bridge are not bundled.'),
    skill('anti-detect-browser', 'Anti-Detect Browser', 'Browser', 'https://github.com/antibrow/anti-detect-browser-skills',
      'Profile-isolation and device-consistency planning for owned workflows.',
      'Design separate persistent profiles for separate owned identities. Document device, session and timezone requirements. A normal Chrome extension cannot change the Chromium engine fingerprint or launch an anti-detect profile. Never promise an undetectable session.',
      'Antibrow SDK and its Chromium runtime require an external host; no fingerprint engine is installed.'),
    skill('computer-use', 'Computer Use · Orca', 'Browser', 'https://github.com/stablyai/orca',
      'Observe-first interaction plans for tasks beyond a simple DOM click.',
      'Ground every interaction in current visible evidence. Prefer semantic browser targets; ask for missing context rather than guessing coordinates. Synapse controls browser pages only, not arbitrary desktop apps.',
      'Requested upstream slug computer-use is unavailable; the repository lists orca-computer-use. Desktop execution needs Orca.'),
    skill('just-scrape', 'Just Scrape', 'Research', 'https://github.com/scrapegraphai/just-scrape',
      'Turn a source page into a structured extraction brief.',
      'Define the extraction schema first. Read source content, preserve source URLs, mark missing fields as null and separate facts from inference. Use current-page read/data actions for native extraction. Do not claim a crawl or monitor ran unless its results exist.',
      'ScrapeGraph cloud search/crawl/monitor requires an external adapter and SGAI_API_KEY; operations may consume credits.'),
    skill('reverse-engineer-anything', 'Reverse Engineer Anything', 'Research', 'https://github.com/Speedrunlab/reverse-engineer-anything',
      'Evidence-led analysis briefs and reference-product comparisons.',
      'Separate observed behavior, published source facts and hypotheses. Define inputs, outputs and acceptance criteria before recreating a workflow. Use public documentation for product comparisons. Binary analysis needs a concrete artifact and an authorized external analysis environment.',
      'Ghidra and other native artifact-analysis tools cannot execute inside a browser extension.'),
    skill('ai-research-reproduction', 'AI Research Reproduction', 'Research', 'https://github.com/lllllllama/rigorpilot-skills',
      'README-first reproduction plans with explicit evidence and blockers.',
      'Read the target repository README first. Select its smallest documented inference or evaluation command. Record dependencies, expected outputs, assumptions and deviations. Distinguish a proposed run from an executed run; never claim reproduced metrics from planning alone.',
      'Python orchestration, datasets and model execution require a configured external environment.'),
    skill('caveman-compress', 'Caveman Compress', 'Writing', 'https://github.com/juliusbrussee/caveman',
      'Compress supplied prose while retaining technical meaning.',
      'Compress the supplied prose by removing filler and repetition. Preserve code blocks, commands, identifiers, URLs, file paths, numbers, negation and requirements exactly. Return compressed text and note any uncertainty. Do not claim a local file was overwritten or backed up.'),
    skill('caveman-help', 'Caveman Help', 'Writing', 'https://github.com/juliusbrussee/caveman',
      'Explain concise-writing modes and when to use them.',
      'Explain concise technical writing and prose compression with a short before/after example. Preserve constraints and technical strings. Clearly distinguish this Synapse writing playbook from the upstream local-file compression CLI.'),
    skill('website-to-video', 'Website to Video', 'Content', 'https://github.com/heygen-com/hyperframes',
      'Create a brand-aware storyboard and production brief from a website.',
      'Read the supplied website content and identify brand, audience and value proposition. Produce a timed storyboard with narration, on-screen copy, aspect ratio, asset list and motion notes. Do not claim to have rendered or exported a video.',
      'The upstream repository no longer lists website-to-video. Video rendering requires a Hyperframes production integration.')
  ]);
  const STORE = 'synapse_skills_v1';
  const defaults = ['agent-browser-vercel', 'use-my-browser'];
  function normalize(value) {
    const ids = Array.isArray(value) ? value : defaults;
    return [...new Set(ids)].filter(id => catalog.some(s => s.id === id));
  }
  function select(ids, objective, limit = 3) {
    const words = String(objective || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3);
    return catalog.filter(s => normalize(ids).includes(s.id))
      .map((s, index) => ({ s, index, score: words.filter(w => (s.name + ' ' + s.description + ' ' + s.category).toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(x => x.s);
  }
  function prompt(ids, objective) {
    const selected = select(ids, objective);
    if (!selected.length) return '';
    return '\n## Enabled Synapse workflow playbooks\nThese are guidance, not extra executable tools. Use only actions actually exposed in this session.\n' +
      selected.map(s => s.name + ': ' + s.guide + (s.requirement ? ' Runtime limit: ' + s.requirement : '')).join('\n');
  }
  const api = { catalog, STORE, normalize, select, prompt };
  root.SynapseSkills = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
