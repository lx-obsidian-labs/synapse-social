/* A single conversation canvas. Advanced controls live behind native disclosures. */
(() => {
  const $ = id => document.getElementById(id);
  const tabs = document.querySelector('body > .tabs');
  const content = document.querySelector('body > .content');
  const header = document.querySelector('body > .header');
  const page = document.querySelector('body > .page-bar');
  if (!tabs || !content || !header || !page) return;
  function disclosure(id, title, description, nodes) {
    const details = document.createElement('details'); details.id = id; details.className = 'hub-section';
    const summary = document.createElement('summary');
    const strong = document.createElement('strong'); strong.textContent = title;
    const small = document.createElement('span'); small.textContent = description;
    summary.append(strong, small);
    const body = document.createElement('div'); body.className = 'hub-section-body';
    for (const node of nodes.filter(Boolean)) {
      node.classList.remove('tab-content', 'active'); node.classList.add('embedded-feature'); body.append(node);
    }
    details.append(summary, body); return details;
  }
  const tools = $('tab-tools');
  const browserNodes = [...tools.children];
  const toolHub = document.createElement('div'); toolHub.className = 'hub-scroll';
  const heading = document.createElement('header'); heading.className = 'hub-heading';
  heading.innerHTML = '<h2>Tools</h2><p>Choose a capability when you need it. Everyday tasks start in Chat.</p>';
  toolHub.append(heading,
    disclosure('tools-browser', 'Browser actions', 'Navigate, read, extract and interact', browserNodes),
    disclosure('tools-skills', 'Workflow playbooks', 'Guidance and focused text workflows', [$('tab-skills')]),
    disclosure('tools-create', 'Post generator', 'Create and refine platform-ready copy', [$('tab-generate')]),
    disclosure('tools-content', 'Content helpers', 'Replies, hooks, repurposing and exports', [$('tab-content')])
  );
  tools.append(toolHub);
  const settings = $('tab-settings').querySelector('.settings-scroll');
  const mcp = $('mcp-settings');
  const memory = $('tab-memory');
  const profile = $('profile-bar');
  if (profile) settings.prepend(profile);
  settings.append(disclosure('settings-memory', 'Learned memory', 'Inspect or clear verified experience', [memory]));
  if (mcp) settings.insertBefore(disclosure('settings-integrations', 'Connected apps', 'MCP endpoints, credentials and tool discovery', [mcp]), settings.lastChild);
  // Collapse optional diagnostics and appearance, keeping AI setup straightforward.
  for (const card of [...settings.querySelectorAll(':scope > .settings-card')]) {
    const title = card.querySelector('.settings-title')?.textContent.trim();
    if (/Connection|Appearance|About/.test(title || '')) settings.insertBefore(disclosure('', title.replace(/^[^A-Za-z]+/, ''), 'Optional settings', [card]), settings.querySelector('#settings-integrations'));
  }
  const version = document.querySelector('.set-version');
  if (version) version.textContent = 'Synapse ' + chrome.runtime.getManifest().version + ' · LX Obsidian Labs';
  const shell = document.createElement('main'); shell.className = 'minimal-shell';
  const top = document.createElement('div'); top.className = 'minimal-top';
  const brand = document.createElement('div'); brand.className = 'minimal-brand'; brand.textContent = 'Synapse';
  const sub = document.createElement('small'); sub.textContent = 'v' + chrome.runtime.getManifest().version; brand.append(sub);
  top.append(brand, header); shell.append(top, tabs, page, content);
  const newChat = document.createElement('button'); newChat.className = 'new-chat'; newChat.textContent = '+';
  newChat.type = 'button'; newChat.title = 'New chat'; newChat.setAttribute('aria-label', 'New chat');
  newChat.addEventListener('click', () => document.dispatchEvent(new Event('synapse-new-chat')));
  top.insertBefore(newChat, header);
  document.body.prepend(shell);
  const syncPage = () => { page.hidden = !page.querySelector('.value')?.textContent.trim() || page.querySelector('.value')?.textContent.trim() === '—'; };
  new MutationObserver(syncPage).observe(page, { childList:true, subtree:true, characterData:true }); syncPage();
  const footer = document.querySelector('body > .app-footer'); if (footer) footer.remove();
  tabs.setAttribute('aria-label', 'Main navigation');
  for (const tab of tabs.querySelectorAll('.tab')) {
    const label = tab.dataset.tab;
    tab.textContent = label[0].toUpperCase() + label.slice(1);
    tab.setAttribute('aria-controls', 'tab-' + label);
  }
  const activity = disclosure('agent-activity', 'Activity', 'Plan, sources and execution details', [$('hud-log')]);
  activity.hidden = true;
  const plan = document.createElement('div'); plan.id = 'agent-plan'; activity.querySelector('.hub-section-body').prepend(plan);
  $('tab-chat').insertBefore(activity, $('chat-messages'));
  const intro = document.createElement('div'); intro.className = 'minimal-intro';
  intro.innerHTML = '<span class="minimal-spark" aria-hidden="true">◈</span><h2>What can I help you with?</h2><p>Ask a question, write something, or work on the page beside you.</p>';
  $('chat-messages').before(intro);
  const sync = () => {
    const hasMessages = $('chat-messages').children.length > 0;
    intro.hidden = hasMessages; $('suggestions').hidden = hasMessages;
  };
  new MutationObserver(sync).observe($('chat-messages'), { childList: true }); sync();
  // Skills are an optional Tools section; selecting a workflow brings its studio into view.
  document.addEventListener('synapse-open-studio', () => {
    $('tools-skills').open = true;
    document.querySelector('.skill-studio')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
})();
