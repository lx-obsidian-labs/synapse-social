/* Synapse desktop shell — progressive enhancement; core agent remains in sidepanel.js. */
(() => {
  const $ = id => document.getElementById(id);
  const tabs = document.querySelector('.tabs'), content = document.querySelector('.content');
  const header = document.querySelector('body > .header'), page = document.querySelector('body > .page-bar');
  if (!tabs || !content || !header || !page) return;
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
  const shortcutsData = [['◎','Web Search','Research the web and cite sources'],['▤','Read Page','Summarize the current page'],['ϟ','Automate','Complete a browser task'],['⌘','Use App','Manage MCP integrations']];
  shortcutsData.forEach(([icon,label,description],i) => {
    const button=document.createElement('button');button.className='syn-shortcut';
    const symbol=document.createElement('span');symbol.className='syn-shortcut-icon';symbol.textContent=icon;
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
  rightTabs.innerHTML='<button class="active" data-right="tools">Tools</button><button data-right="activity">Activity</button><button data-right="page">Page</button>';
  rightTabs.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{
    rightTabs.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===button));
    rightBody.dataset.view=button.dataset.right;
    if(button.dataset.right==='page') rightHeading.textContent='Current page';
    else rightHeading.textContent=button.dataset.right==='activity'?'Agent activity':'Tools';
  }));
  const intro=document.createElement('div');intro.className='syn-intro';
  intro.innerHTML='<h2>What can I help you do?</h2><p>Search the web, automate your browser, and connect your apps.</p>';
  const cards=document.createElement('div');cards.className='syn-cards';
  [['⌕','Research','Find answers with sources'],['ϟ','Automate','Complete tasks in your browser'],['⌘','Integrations','Work with connected apps']].forEach(([icon,title,desc],i)=>{
    const b=document.createElement('button');b.className='syn-card';
    const ico=document.createElement('span');ico.className='syn-card-icon';ico.textContent=icon;
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
