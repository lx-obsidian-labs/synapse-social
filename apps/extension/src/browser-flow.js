/*
 * Synapse Browser Flow — deterministic routing for known search engines.
 * Inspired by OpenBrowser's deterministic action layer and Playwright MCP's
 * observe/act boundary. No third-party runtime or remote scripts required.
 *
 * Search is navigation, not a synthetic Enter keypress. We accept a search as
 * submitted only when the URL reflects the requested query.
 */
(function (root) {
  'use strict';
  const HOSTS = {
    google: /^(?:www\.)?google\.(?:[a-z]{2,3}|(?:com|co|org|net)\.[a-z]{2})$/i,
    youtube: /(^|\.)youtube\.com$/i,
    bing: /(^|\.)bing\.com$/i,
    duckduckgo: /(^|\.)duckduckgo\.com$/i
  };
  function providerOf(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      for (const [name, re] of Object.entries(HOSTS)) if (re.test(host)) return name;
    } catch {}
    return null;
  }
  function searchQuery(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const provider = providerOf(rawUrl);
      if (!provider) return null;
      const pathOK = provider === 'youtube' ? url.pathname === '/results'
        : provider === 'google' ? url.pathname === '/search'
        : provider === 'bing' ? url.pathname === '/search' : true;
      if (!pathOK) return null;
      const param = provider === 'youtube' ? 'search_query' : 'q';
      return url.searchParams.get(param);
    } catch { return null; }
  }
  function normalizeQuery(q) {
    return String(q || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function planSearchAction(action, currentUrl) {
    if (!action || action.type !== 'type' || !/search|query|google or type a url/i.test(String(action.target || ''))) return { status: 'passthrough', action };
    const provider = providerOf(currentUrl);
    if (!provider) return { status: 'passthrough', action };
    const q = String(action.value || '').trim();
    if (!q) return { status: 'passthrough', action };
    const existing = searchQuery(currentUrl);
    if (existing !== null && normalizeQuery(existing) === normalizeQuery(q))
      return { status: 'already-submitted', action, provider, query: q };
    const host = {google: 'https://www.google.com/search?q=', youtube: 'https://www.youtube.com/results?search_query=', bing: 'https://www.bing.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q='}[provider];
    return { status: 'navigate', provider, query: q, action: {type:'navigate',target:host + encodeURIComponent(q),value:''} };
  }
  function confirmsSearch(rawUrl, query) {
    return normalizeQuery(searchQuery(rawUrl)) === normalizeQuery(query) && !!normalizeQuery(query);
  }
  function researchReadiness(objective, notes) {
    const requestedThree = /\b(three|3)\b/i.test(String(objective || ''));
    const domains = new Set();
    for (const note of (Array.isArray(notes) ? notes : [])) {
      try {
        const host = new URL(note.url).hostname;
        if (host) domains.add(host.toLowerCase());
      } catch {}
    }
    const required = requestedThree ? 3 : 1;
    return { ready: domains.size >= required, sourceCount: domains.size, required };
  }
  // YouTube playback is an observable browser state, not an LLM-generated
  // cycle of "search -> click -> search". Treat a watch page as a terminal
  // destination that must be verified before reporting completion.
  function isPlaybackGoal(objective) {
    return /\byoutube\b/i.test(String(objective || '')) &&
      /\b(play|playback|watch|listen)\b/i.test(String(objective || ''));
  }
  function isYouTubeWatch(urlString) {
    try {
      const url = new URL(urlString);
      return providerOf(urlString) === 'youtube' &&
        url.pathname === '/watch' && !!url.searchParams.get('v');
    } catch { return false; }
  }
  function normalizedLabel(text) {
    return String(text || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '')
      .toLowerCase().trim();
  }
  function videoActionForObjective(objective, pageState) {
    if (!isPlaybackGoal(objective) || providerOf(pageState?.url) !== 'youtube') return null;
    if (isYouTubeWatch(pageState.url)) {
      if (pageState?.mediaPlayback?.playing) return { type: 'done', target: '', value: '' };
      return { type: 'media', target: 'play', value: '' };
    }
    try {
      const url = new URL(pageState.url);
      if (url.pathname !== '/results') return null;
    } catch { return null; }
    const candidates = (Array.isArray(pageState.links) ? pageState.links : [])
      .map(link => {
        try {
          const dest = new URL(link.href || link.url, pageState.url);
          if (!isYouTubeWatch(dest.href)) return null;
          return { url: dest.href, text: String(link.text || link.title || link.label || '') };
        } catch { return null; }
      }).filter(Boolean);
    if (!candidates.length) return null;
    const m = String(objective).match(/\b(?:search\s+for|music\s+by|songs?\s+by)\s+([^\s’']+)/i);
    const artist = normalizedLabel(m?.[1] || '');
    const choice = (artist && candidates.find(video => normalizedLabel(video.text).includes(artist))) || candidates[0];
    return { type: 'navigate', target: choice.url, value: '' };
  }
  function hasAdvancedPlayback(before, after) {
    return !!before?.playing && !!after?.playing && !before.adPlaying && !after.adPlaying &&
      Number.isFinite(before.currentTime) && Number.isFinite(after.currentTime) &&
      after.currentTime > before.currentTime + 0.2;
  }
  const api = Object.freeze({ providerOf, searchQuery, planSearchAction, confirmsSearch, researchReadiness, isPlaybackGoal, isYouTubeWatch, videoActionForObjective, hasAdvancedPlayback });
  root.SynapseBrowserFlow = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
