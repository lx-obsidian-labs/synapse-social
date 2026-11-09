/* Bounded, session-local lexical retrieval. Source text is evidence, not instructions. */
;(function (root) {
  const terms = text => [...new Set(String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'what', 'please']);
  function rankLinks(links, objective, limit = 16) {
    const words = terms(objective).filter(w => !stop.has(w));
    const seen = new Set();
    return (Array.isArray(links) ? links : []).filter(link => {
      try { if (!/^https?:$/.test(new URL(link.href).protocol) || seen.has(link.href)) return false; }
      catch { return false; }
      seen.add(link.href); return true;
    }).map((link, i) => ({ link, i, score: words.reduce((sum, word) => sum + (String(link.text).toLowerCase().includes(word) ? 3 : 0) + (String(link.href).toLowerCase().includes(word) ? 1 : 0), 0) }))
      .sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map(x => x.link);
  }
  const label = value => String(value || '').toLowerCase().replace(/[↗→↓]/g, '').replace(/\s+/g, ' ').trim();
  function resolveLink(links, target) {
    const query = label(target);
    if (!query) return null;
    const valid = (Array.isArray(links) ? links : []).filter(item => /^https?:\/\//i.test(item.href || ''));
    const exact = valid.filter(item => label(item.text) === query);
    const candidates = exact.length ? exact : (query.length >= 5 ? valid.filter(item => label(item.text).includes(query)) : []);
    const urls = new Set(candidates.map(item => item.href));
    return urls.size === 1 ? candidates[0] : null;
  }
  function searchResult(links, query, visited = new Set()) {
    const words = terms(query).filter(word => !stop.has(word));
    const candidates = rankLinks(links, query, 100).filter(item => {
      if (visited.has(item.href)) return false;
      try { if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|youtube\.com)$/.test(new URL(item.href).hostname)) return false; } catch { return false; }
      return words.some(word => label(item.text).includes(word) || item.href.toLowerCase().includes(word));
    });
    return candidates[0] || null;
  }
  class EvidenceIndex {
    constructor() { this.documents = new Map(); }
    clear() { this.documents.clear(); }
    ingest(state, extra = '') {
      let url;
      try { url = new URL(state?.url); } catch { return; }
      if (!/^https?:$/.test(url.protocol) || /^(accounts|mail)\.google\.com$/.test(url.hostname)) return;
      url.hash = '';
      const text = String(extra || state.contentText || state.textSummary || '').trim().slice(0, 24000);
      if (text.length < 50) return;
      const chunks = [];
      for (let start = 0; start < text.length && chunks.length < 30; start += 700) chunks.push(text.slice(start, start + 900));
      this.documents.delete(url.href);
      this.documents.set(url.href, { url: url.href, title: String(state.title || url.hostname).slice(0, 160), chunks });
      while (this.documents.size > 12) this.documents.delete(this.documents.keys().next().value);
    }
    retrieve(query, currentUrl = '', limit = 5) {
      const words = terms(query).filter(w => !stop.has(w));
      const candidates = [];
      for (const doc of this.documents.values()) for (const [i, text] of doc.chunks.entries()) {
        const haystack = (doc.title + ' ' + text).toLowerCase();
        const score = words.reduce((s, word) => s + (haystack.includes(word) ? 1 : 0), 0) + (doc.url === currentUrl ? .2 : 0);
        if (score > 0) candidates.push({ url: doc.url, title: doc.title, text, chunk: i, score });
      }
      const perSource = new Map();
      return candidates.sort((a, b) => b.score - a.score).filter(item => {
        const count = perSource.get(item.url) || 0;
        if (count >= 2) return false;
        perSource.set(item.url, count + 1); return true;
      }).slice(0, limit);
    }
    context(query, currentUrl) {
      return this.retrieve(query, currentUrl).map((item, i) => `[S${i + 1}] ${item.title}\nURL: ${item.url}\nExcerpt: ${item.text}`).join('\n\n');
    }
  }
  const api = { EvidenceIndex, rankLinks, resolveLink, searchResult };
  root.SynapseRetrieval = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
