/* Minimal notice only when a newer packaged release is known to exist. */
;(async () => {
  const $ = id => document.getElementById(id);
  const settings = $('tab-settings')?.querySelector('.settings-scroll');
  const shell = document.querySelector('.minimal-shell');
  if (!settings || !shell) return;
  const card = document.createElement('section'); card.className = 'settings-card update-card'; card.id = 'update-settings';
  card.innerHTML = '<div class="settings-title">Synapse updates</div><p id="update-installed" class="settings-sub"></p><div class="skill-actions"><button type="button" class="btn btn-secondary" id="update-check">Check for updates</button><a id="update-download" hidden target="_blank" rel="noopener noreferrer">Download update</a></div><p id="update-status" class="settings-sub" role="status" aria-live="polite"></p><details><summary>What’s new and how to update</summary><ul id="update-highlights"></ul><p class="settings-sub">This build checks stable and test releases. For an unpacked extension, extract the ZIP into your existing extension folder, click Reload at chrome://extensions, refresh the webpage, then reopen Synapse. Chrome does not let an unpacked extension replace its own installed files.</p><a id="update-release" target="_blank" rel="noopener noreferrer" hidden>Release notes ↗</a></details>';
  settings.prepend(card);
  const notice = document.createElement('aside'); notice.className = 'update-notice'; notice.id = 'update-notice'; notice.hidden = true; notice.setAttribute('role', 'status');
  notice.innerHTML = '<span id="update-notice-text"></span><a id="update-notice-download" target="_blank" rel="noopener noreferrer">Download</a><button type="button" id="update-later" aria-label="Dismiss update notice">Later</button>';
  shell.insertBefore(notice, shell.querySelector('.content'));
  let availableVersion = '';
  function safeLink(element, raw) {
    const allowed = /^https:\/\/github\.com\/lx-obsidian-labs\/synapse-social\/releases\/(download|tag)\//.test(String(raw || ''));
    element.hidden = !allowed;
    if (allowed) element.href = raw; else element.removeAttribute('href');
  }
  async function check(force) {
    $('update-check').disabled = true;
    $('update-status').textContent = 'Checking releases…';
    try {
      const result = await chrome.runtime.sendMessage({ type:'CHECK_FOR_UPDATE', payload:{ force } });
      if (!result?.installedVersion) throw new Error(result?.error || 'Update check did not respond.');
      $('update-installed').textContent = 'Installed version ' + result.installedVersion;
      $('update-highlights').replaceChildren();
      for (const text of result.highlights || []) { const item = document.createElement('li'); item.textContent = text; $('update-highlights').append(item); }
      $('update-status').textContent = result.error ? 'Could not refresh update status: ' + result.error : result.available ? 'Version ' + result.latestVersion + ' is available.' : 'No newer packaged release is available.';
      safeLink($('update-download'), result.available ? result.downloadUrl : '');
      safeLink($('update-release'), result.releaseUrl);
      safeLink($('update-notice-download'), result.downloadUrl);
      const saved = await chrome.storage.local.get('synapse_update_dismissed');
      availableVersion = result.latestVersion || '';
      $('update-notice-text').textContent = 'Synapse ' + availableVersion + ' is available';
      notice.hidden = !result.available || $('update-notice-download').hidden || saved.synapse_update_dismissed === availableVersion;
    } catch (error) { $('update-status').textContent = 'Could not check for updates: ' + error.message; }
    finally { $('update-check').disabled = false; }
  }
  $('update-installed').textContent = 'Installed version ' + chrome.runtime.getManifest().version;
  $('update-check').addEventListener('click', () => check(true));
  $('update-later').addEventListener('click', async () => {
    notice.hidden = true;
    try { await chrome.storage.local.set({synapse_update_dismissed:availableVersion}); } catch { /* settings still exposes the update */ }
  });
  await check(false);
})().catch(error => console.warn('[updates]', error));
