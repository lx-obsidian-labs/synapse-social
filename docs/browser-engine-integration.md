# Synapse Browser Engine — implementation and smoke tests

## Source-level references

- [OpenBrowser](https://github.com/dylansantwani/openbrowser): native value setters, framework-compatible input/change events, compact actionable DOM, and explicit verification. Synapse adapts these patterns into its existing content script; it does **not** bundle OpenBrowser, its hub, or its Chrome debugger transport.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp): snapshot-scoped element references and refreshed page observations. Synapse exposes refs in `accessibilitySnapshot` and resolves them on clicks and input fields.
- [Stagehand](https://github.com/browserbase/stagehand): deterministic known actions instead of LLM calls for every mechanical operation. Synapse routes recognized search tasks to encoded search-result URLs.
- [open-browser-use](https://github.com/open-browser-use/open-browser-use): native extension + companion separation. Synapse has an experimental MCP companion, but no native messaging connection to the extension yet.

**This is an adaptation of documented patterns, not a vendored copy of any upstream project.** No unreviewed third-party scripts are loaded into the Chrome extension.

## Behavior

1. Observe the active page and publish result links and actionable refs.
2. For known search engines (Google, YouTube, Bing and DuckDuckGo), convert search typing into a deterministic navigation to the provider's results URL.
3. Verify the observed URL contains the requested query before reporting search success. A successful `keydown` by itself never establishes search success.
4. For other forms, select a native editable input or genuine contenteditable element, set and verify its value, and use `requestSubmit()` where supported.
5. Reject repeated search submissions and stop after bounded corrective replanning.
6. For YouTube playback tasks, confirm that media is playing and playback time advances; merely opening a video page is not completion.

## CI

```sh
cd apps/extension
npm install
npm test
npm run zip
```

The workflow runs Node regression tests, compiles TypeScript, checks copied JavaScript syntax and validates the ZIP archive's root-level files.

## Browser smoke-test checklist

Run each with the newly unpacked extension in Chrome. Confirm the page visibly changes, not merely that a tool says "success".

- **Google:** "Research three free AI coding assistants. Visit their official sites and compare features." Confirm the URL reaches `/search?q=...` once, official-site links are surfaced, and the planner does not repeatedly enter the same query.
- **YouTube:** "Open YouTube, search for Giveon's popular songs, open a relevant video and confirm playback." Confirm the results URL contains `search_query`, a watch page opens, and `mediaPlayback.currentTime` increases.
- **Native form:** Fill a search form on an ordinary website. Confirm no `TypeError: Illegal invocation` is thrown and the form submits.
- **Failure budget:** Force a non-existent selector. Confirm the agent reports the failure and stops instead of consuming all 60 steps.

### Known limitations

Synthetic DOM events are not equivalent to CDP trusted input on every website. Dynamic iframes, anti-bot controls, shadow roots and sites that disallow automation may require a separate, opt-in trusted-input engine. Browser-based end-to-end coverage is not yet automated. MCP stdio is available only through the separate experimental companion and is not wired to the side panel.
