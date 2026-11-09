/* Local-only skills state. No npm packages, downloaded code or eval in extension pages. */
;(async () => {
  const api = globalThis.SynapseSkills;
  const grid = document.getElementById('skills-grid');
  if (!api || !grid) return;
  const $ = id => document.getElementById(id);
  const status = message => { $('skills-status').textContent = message; };
  let enabled = [];
  let selected = api.catalog[0];
  let running = false;
  let writeQueue = Promise.resolve();
  const history = new Map();
  try {
    const stored = await chrome.storage.local.get(api.STORE);
    enabled = api.normalize(stored[api.STORE]);
  } catch (error) { status('Could not load saved skills: ' + error.message); }
  function choose(item, reveal = true) {
    if (running) { status('Wait for the current studio result before switching skills.'); return; }
    selected = item;
    $('skill-selected').textContent = item.name;
    $('skill-requirement').textContent = item.requirement || 'Ready for AI-assisted planning and writing. Browser actions use Synapse’s existing engine.';
    $('skill-studio-output').textContent = '';
    $('skill-agent').disabled = item.category !== 'Browser' && item.id !== 'just-scrape';
    if (reveal) { $('skill-task').focus(); document.dispatchEvent(new Event('synapse-open-studio')); }
  }
  function render() {
    const query = $('skills-search').value.toLowerCase().trim();
    const category = $('skills-category').value;
    const visible = api.catalog.filter(s => (!category || s.category === category) &&
      (s.name + ' ' + s.description + ' ' + s.requirement).toLowerCase().includes(query));
    $('skills-count').textContent = enabled.length + ' enabled · ' + api.catalog.length + ' playbooks';
    grid.replaceChildren();
    for (const item of visible) {
      const card = document.createElement('article'); card.className = 'skill-card';
      const top = document.createElement('div'); top.className = 'skill-card-top';
      const badge = document.createElement('span'); badge.className = 'skill-badge'; badge.textContent = item.category;
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'skill-switch';
      toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-checked', String(enabled.includes(item.id)));
      toggle.setAttribute('aria-label', 'Enable ' + item.name + ' playbook');
      toggle.addEventListener('click', () => {
        toggle.disabled = true;
        writeQueue = writeQueue.then(async () => {
          const next = enabled.includes(item.id) ? enabled.filter(id => id !== item.id) : [...enabled, item.id];
          await chrome.storage.local.set({ [api.STORE]: next }); enabled = next; render();
          status(item.name + (next.includes(item.id) ? ' playbook enabled.' : ' playbook disabled.'));
        }).catch(error => { status('Could not save skills: ' + error.message); render(); });
      });
      top.append(badge, toggle);
      const title = document.createElement('h3'); title.textContent = item.name;
      const description = document.createElement('p'); description.textContent = item.description;
      const state = document.createElement('small'); state.className = 'skill-runtime';
      state.textContent = item.requirement ? 'Playbook ready · external runtime not connected' : 'AI playbook ready';
      const actions = document.createElement('div'); actions.className = 'skill-actions';
      const use = document.createElement('button'); use.type = 'button'; use.className = 'btn btn-secondary'; use.textContent = 'Open studio';
      use.addEventListener('click', () => choose(item));
      const source = document.createElement('a'); source.href = item.source; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Source ↗';
      actions.append(use, source); card.append(top, title, description, state, actions); grid.append(card);
    }
    if (!visible.length) { const empty = document.createElement('p'); empty.className = 'skill-empty'; empty.textContent = 'No matching skills. Try a different search or category.'; grid.append(empty); }
  }
  $('skills-search').addEventListener('input', render);
  $('skills-category').addEventListener('change', render);
  $('skill-run').addEventListener('click', async () => {
    const task = $('skill-task').value.trim();
    if (!task) { status('Describe your task or paste text to work on.'); $('skill-task').focus(); return; }
    const item = selected; const button = $('skill-run'); running = true; button.disabled = true; button.textContent = 'Working…';
    status('Running ' + item.name + ' with your configured AI service…');
    const messages = [...(history.get(item.id) || []), { role: 'user', content: task }];
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AI_CHAT', payload: { messages: [
        { role: 'system', content: 'You are Synapse by LX Obsidian Labs. Apply this reviewed playbook to the user task. You have NO tools in this studio call. Return a useful text result, never claim execution, file changes, browsing or rendering.\n' + item.guide + '\n' + item.requirement },
        ...messages.slice(-10)
      ] } });
      if (!response?.success || !response.content?.trim()) throw new Error(response?.error || 'AI returned no content. Configure AI in Settings.');
      $('skill-studio-output').textContent = response.content;
      history.set(item.id, [...messages, { role: 'assistant', content: response.content }].slice(-10));
      status(item.name + ' finished. Follow-up messages keep this studio conversation in memory until the panel closes.');
    } catch (error) { status('Skill could not run: ' + error.message); }
    finally { running = false; button.disabled = false; button.textContent = 'Run playbook'; }
  });
  $('skill-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('skill-studio-output').textContent); status('Result copied.'); }
    catch { status('Clipboard unavailable. Select and copy the result manually.'); }
  });
  $('skill-agent').addEventListener('click', () => {
    const task = $('skill-task').value.trim();
    if (!task) { status('Describe the browser task first.'); return; }
    document.querySelector('.tab[data-tab="chat"]')?.click();
    const input = $('chat-input');
    $('chat-mode').value = 'browser';
    input.value = task + '\n\nApply this workflow: ' + selected.guide + '\n' + selected.requirement;
    input.focus();
    status('Browser task prepared in Chat. Review it and press Send to execute.');
  });
  render(); choose(selected, false);
})().catch(error => {
  const el = document.getElementById('skills-status'); if (el) el.textContent = 'Skills unavailable: ' + error.message;
});
