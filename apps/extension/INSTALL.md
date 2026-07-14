# Synapse AI — Installation

Synapse AI is a Chrome/Edge browser extension that automates web pages with AI.

## Install (from the downloaded ZIP)

1. **Download** `synapse-ai-v1.1.0.zip` and **unzip** it. You'll get a folder
   named `dist` (or `synapse-ai`) containing `manifest.json`.
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge:   `edge://extensions`
   - Brave:  `brave://extensions`
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder (the one with
   `manifest.json` inside).
5. Pin **Synapse AI** to your toolbar and click it to open the side panel.

That's it — the AI works out of the box. No API key or setup required.

## Optional: use your own NVIDIA API key

By default, Synapse routes AI requests through a secure hosted proxy, so you
don't need a key. If you'd rather use your own NVIDIA NIM key (e.g. for higher
limits), open the extension's **Settings** tab and paste your key. It's stored
locally on your device and used instead of the hosted proxy.

Get a free key at https://build.nvidia.com

## Requirements

- Google Chrome, Microsoft Edge, or any Chromium browser (v100+).

## Support

LX Obsidian Labs — https://www.lxobsidianportal.co.za
