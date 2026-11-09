const REPO = 'lx-obsidian-labs/synapse-social';
const API = 'https://api.github.com/repos/' + REPO + '/releases?per_page=30';
const CACHE = 'synapse_update_cache_v1';
const MAX_AGE = 6 * 60 * 60 * 1000;
export const CURRENT_HIGHLIGHTS = [
  'Minimal Chat, Tools and Settings interface.',
  'Grounded browser navigation, download verification and page retrieval.',
  'In-app update checks, release links and installed-version information.'
];
export function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function selectRelease(releases: any[]) {
  const valid = releases.flatMap(release => {
    if (release?.draft) return [];
    const match = String(release?.tag_name || '').match(/^v(\d+\.\d+\.\d+)(-test)?$/);
    if (!match) return [];
    const version = match[1], tag = match[0];
    const assetName = 'synapse-ai-v' + version + (match[2] || '') + '.zip';
    const expectedUrl = 'https://github.com/' + REPO + '/releases/download/' + tag + '/' + assetName;
    const asset = (Array.isArray(release.assets) ? release.assets : []).find((item: any) => item.name === assetName && item.browser_download_url === expectedUrl && item.state === 'uploaded');
    if (!asset) return [];
    return [{ version, downloadUrl: expectedUrl, releaseUrl: 'https://github.com/' + REPO + '/releases/tag/' + tag,
      notes: String(release.body || '').slice(0, 2000), prerelease: !!release.prerelease }];
  });
  return valid.sort((a, b) => compareVersions(b.version, a.version) || Number(a.prerelease) - Number(b.prerelease))[0] || null;
}
let pending: Promise<any> | null = null;
export async function checkForUpdate(force = false) {
  if (pending) return pending;
  pending = (async () => {
    const installedVersion = chrome.runtime.getManifest().version;
    const stored = await chrome.storage.local.get(CACHE);
    const cached = stored[CACHE]?.installedVersion === installedVersion ? stored[CACHE] : null;
    const view = (status: any) => ({ ...status, installedVersion,
      available: !!status.latestVersion && compareVersions(status.latestVersion, installedVersion) > 0,
      highlights: CURRENT_HIGHLIGHTS, channel: 'Stable and test releases' });
    if (!force && cached && Date.now() - cached.checkedAt < MAX_AGE) return view(cached);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal, credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? 'GitHub update checks are rate-limited. Try again later.' : 'Update server returned HTTP ' + response.status);
      const releases = await response.json();
      if (!Array.isArray(releases)) throw new Error('Update server returned an invalid release list.');
      const release = selectRelease(releases);
      if (!release) throw new Error('No installable extension release was found.');
      const status = { installedVersion, checkedAt: Date.now(), latestVersion: release.version, downloadUrl: release.downloadUrl, releaseUrl: release.releaseUrl, notes: release.notes };
      await chrome.storage.local.set({ [CACHE]: status });
      return view(status);
    } catch (error: any) {
      return view({ ...cached, error: error?.name === 'AbortError' ? 'Update check timed out. Try again later.' : String(error?.message || error) });
    } finally { clearTimeout(timer); }
  })();
  try { return await pending; } finally { pending = null; }
}
