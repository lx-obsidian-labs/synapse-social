<?php
/**
 * Synapse AI — download button for lxobsidianportal.co.za
 *
 * Server side: resolves the NEWEST GitHub release URL + version (cached 30 min
 * to avoid GitHub's ~60 req/hr unauthenticated limit).
 * Client side: probes the installed extension via postMessage; shows
 *   • "Download Synapse AI vX"      (not installed)
 *   • "Update Synapse AI (vX)"      (installed, outdated)
 *   • "Synapse AI is up to date"    (installed, current)
 * To release a new version: bump manifest.json, run scripts/release.ps1.
 */

function synapse_latest_release($cache_minutes = 30) {
    $cache = sys_get_temp_dir() . '/synapse_release.json';
    $fresh = !file_exists($cache) || (time() - filemtime($cache)) > $cache_minutes * 60;

    if ($fresh) {
        $ctx = stream_context_create([
            'http' => ['header' => "Accept: application/vnd.github+json"],
        ]);
        $json = @file_get_contents(
            'https://api.github.com/repos/lx-obsidian-labs/synapse-social/releases/latest',
            false,
            $ctx
        );
        if ($json) file_put_contents($cache, $json);
    }

    $data = json_decode(@file_get_contents($cache), true);
    $asset = $data['assets'][0] ?? null;

    return [
        'url'     => $asset['browser_download_url']
                    ?? $data['html_url']
                    ?? 'https://github.com/lx-obsidian-labs/synapse-social/releases/latest',
        'version' => ltrim($data['tag_name'] ?? 'latest', 'v'),
    ];
}

$latest = synapse_latest_release();
$url     = htmlspecialchars($latest['url'], ENT_QUOTES);
$version = htmlspecialchars($latest['version'], ENT_QUOTES);
?>

<a id="synapse-download" href="<?= $url ?>" class="synapse-btn"
   target="_blank" rel="noopener noreferrer">Download Synapse AI v<?= $version ?></a>

<script>
(function () {
  const btn = document.getElementById("synapse-download");
  const latestVersion = "<?= $version ?>";

  function parseVersion(v) { return (v || "").replace(/^v/i, "").split(".").map(n => parseInt(n, 10) || 0); }
  function cmp(a, b) {
    const pa = parseVersion(a), pb = parseVersion(b), len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
    return 0;
  }

  window.addEventListener("message", (e) => {
    const d = e.data || {};
    if (d.type === "SYNAPSE_PROBE_RESPONSE" && d.version) {
      if (cmp(latestVersion, d.version) > 0) {
        btn.textContent = `Update Synapse AI (v${latestVersion})`;
      } else {
        btn.textContent = `Synapse AI is up to date (v${d.version})`;
      }
    }
  });
  window.postMessage({ type: "SYNAPSE_PROBE" }, "*");
})();
</script>
