<?php
/**
 * Synapse AI — server-side download link for lxobsidianportal.co.za
 *
 * Always returns the NEWEST GitHub release URL. Cache the API response so
 * high-traffic pages don't hit GitHub's ~60 req/hr unauthenticated limit.
 * To release a new version: bump manifest.json, run scripts/release.ps1.
 */

function synapse_download_url($cache_minutes = 30) {
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

$dl = synapse_download_url();
echo '<a class="synapse-btn" href="' . htmlspecialchars($dl['url']) . '" '
   . 'target="_blank" rel="noopener noreferrer">'
   . 'Download Synapse AI v' . htmlspecialchars($dl['version'])
   . '</a>';
