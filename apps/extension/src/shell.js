/* Synapse desktop shell — progressive enhancement; core agent remains in sidepanel.js. */
(() => {
  const $ = id => document.getElementById(id);
  const tabs = document.querySelector('.tabs'), content = document.querySelector('.content');
  const header = document.querySelector('body > .header'), page = document.querySelector('body > .page-bar');
  if (!tabs || !content || !header || !page) return;
  // Local inline outline icons: no CDN or remote scripts required in MV3.
  const paths = {
    chat:'<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.48 8.48 0 0 1 8 8v.5Z"/>',
    create:'<path d="m12 3 1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3Z"/><path d="m19 18 .6 1.4L21 20l-1.4.6L19 22l-.6-1.4L17 20l1.4-.6L19 18Z"/>',
    library:'<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="10" y="4" width="7" height="16" rx="1"/><path d="m17 7 4 13"/>',
    tools:'<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 11.6 12.4 21l5.3-6.3a4 4 0 0 0 5.4-5.4l-3 3-3.4-.7-.7-3.4 3-3Z"/>',
    history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
    settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l-1.8 1.8a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6H9a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-1.8-1.8a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14v-4a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l1.8-1.8A1.7 1.7 0 0 0 8 5.6 1.7 1.7 0 0 0 9 4h6a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l1.8 1.8a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1v4a1.7 1.7 0 0 0-1.6 1Z"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    read:'<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    automate:'<path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z"/>',
    integrate:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>'
  };
  const iconSvg = (name) => '<svg class="syn-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  const tabIcons = {chat:'chat',create:'create',library:'library',tools:'tools',history:'history',settings:'settings'};
  tabs.querySelectorAll('.tab').forEach(tab => {
    const name = tab.dataset.tab;
    if (!tabIcons[name]) return;
    const label = tab.textContent.trim().replace(/^[^A-Za-z]+/, '').trim() || name;
    tab.textContent = '';
    tab.insertAdjacentHTML('afterbegin', iconSvg(tabIcons[name]));
    const span = document.createElement('span');span.className='syn-tab-label';span.textContent=label;tab.append(span);
    tab.setAttribute('aria-label', label);tab.title=label;
  });
  const shell = document.createElement('div'); shell.className = 'syn-shell';
  const nav = document.createElement('aside'); nav.className = 'syn-nav';
  const brand = document.createElement('div'); brand.className = 'syn-brand';
  brand.innerHTML = '<div class="syn-mark">◈</div><div><strong>SYNAPSE AI</strong><small>LX OBSIDIAN LABS</small></div>';
  const center = document.createElement('main'); center.className = 'syn-center';
  const top = document.createElement('div'); top.className = 'syn-top';
  const tabLabel = document.createElement('span'); tabLabel.className='syn-session'; tabLabel.textContent = '＋  New Chat';
  const right = document.createElement('aside'); right.className = 'syn-right';
  const rightTabs = document.createElement('div'); rightTabs.className='syn-right-tabs';
  const rightBody = document.createElement('div'); rightBody.className='syn-right-body';
  const rightHeading = document.createElement('div'); rightHeading.className='syn-right-title'; rightHeading.textContent='Tools';
  const shortcuts = document.createElement('div'); shortcuts.className='syn-shortcuts';
  const shortcutsData = [['search','Web Search','Research the web and cite sources'],['read','Read Page','Summarize the current page'],['automate','Automate','Complete a browser task'],['integrate','Use App','Manage MCP integrations']];
  shortcutsData.forEach(([icon,label,description],i) => {
    const button=document.createElement('button');button.className='syn-shortcut';
    const symbol=document.createElement('span');symbol.className='syn-shortcut-icon';symbol.innerHTML=iconSvg(icon);
    const caption=document.createElement('span');caption.textContent=label;
    button.append(symbol,caption);button.title=description;
    button.addEventListener('click',()=>{
      if(i===3){document.querySelector('.tab[data-tab="settings"]')?.click();$('mcp-name')?.focus();return}
      document.querySelector('.tab[data-tab="chat"]')?.click();
      const input=$('chat-input');if(!input)return;
      input.value=i===0?'Research this topic and provide source links: ':i===1?'Summarize the current page with key points and source references.':'Help me automate this task: ';
      input.focus();
    });shortcuts.appendChild(button);
  });
  const activity = document.createElement('section'); activity.className='syn-activity';
  const activityTitle = document.createElement('div');activityTitle.className='syn-activity-title';
  activityTitle.innerHTML='<strong>Agent activity</strong><button type="button" class="syn-clear-log">Clear</button>';
  const log = $('hud-log');
  activity.appendChild(activityTitle);
  if(log) activity.appendChild(log);
  activityTitle.querySelector('button').addEventListener('click',()=>log?.replaceChildren());
  const hud = $('agent-hud');
  const hudHost = document.createElement('div');hudHost.className='syn-hud-host';
  if(hud) hudHost.appendChild(hud);
  rightBody.append(rightHeading,shortcuts,hudHost,activity);
  rightTabs.innerHTML='<button class="active" data-right="tools">'+iconSvg('tools')+'<span>Tools</span></button><button data-right="activity">'+iconSvg('history')+'<span>Activity</span></button><button data-right="page">'+iconSvg('read')+'<span>Page</span></button>';
  rightTabs.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
    rightTabs.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));
    rightBody.dataset.view=button.dataset.right;
    if(button.dataset.right==='page') rightHeading.textContent='Current page';
    else rightHeading.textContent=button.dataset.right==='activity'?'Agent activity':'Tools';
  }));
  const intro=document.createElement('div');intro.className='syn-intro';
  intro.innerHTML='<h2>What can I help you do?</h2><p>Search the web, automate your browser, and connect your apps.</p>';
  const cards=document.createElement('div');cards.className='syn-cards';
  [['search','Research','Find answers with sources'],['automate','Automate','Complete tasks in your browser'],['integrate','Integrations','Work with connected apps']].forEach(([icon,title,desc],i)=>{
    const b=document.createElement('button');b.className='syn-card';
    const ico=document.createElement('span');ico.className='syn-card-icon';ico.innerHTML=iconSvg(icon);
    const h=document.createElement('strong');h.textContent=title;
    const p=document.createElement('small');p.textContent=desc;
    b.append(ico,h,p);b.addEventListener('click',()=>shortcuts.children[i===2?3:i]?.click());cards.appendChild(b);
  });
  const chat=$('tab-chat');
  if(chat){const messages=$('chat-messages'); if(messages){chat.insertBefore(intro,messages);chat.insertBefore(cards,messages)}}
  const footer=document.querySelector('body > .app-footer');
  const navFooter=document.createElement('div');navFooter.className='syn-nav-footer';
  navFooter.textContent='LX Obsidian Labs · v1.2.0';
  nav.append(brand,tabs,navFooter);
  top.append(tabLabel,header,page);
  center.append(top,content);
  right.append(rightTabs,rightBody);
  shell.append(nav,center,right);
  document.body.insertBefore(shell,document.body.firstChild);
  if(footer) footer.hidden=true;
  const observer=new MutationObserver(()=>{
    const msgs=$('chat-messages');if(!msgs)return;
    const hasConversation=msgs.querySelectorAll('.msg').length>1;
    intro.hidden=hasConversation;cards.hidden=hasConversation;
  });
  if($('chat-messages')) observer.observe($('chat-messages'),{childList:true});
  const isCompact=()=>window.matchMedia('(max-width: 850px)').matches;
  const sync=()=>{shell.classList.toggle('syn-compact',isCompact())};
  window.addEventListener('resize',sync);sync();
})();
