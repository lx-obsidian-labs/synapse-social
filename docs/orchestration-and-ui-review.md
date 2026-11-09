# Synapse 1.4: conversation-first orchestration review

## Critique of the 1.3 interface

The main problem was competing entry points, not the color palette. Seven main
tabs, a second Tools/Activity/Page rail, large skill cards, repeated shortcut
groups, a welcome bubble and a welcome heading all competed with the user's task.
Technical counters and step-by-step "success" messages occupied the conversation
without explaining whether the user's goal had actually succeeded.

The previous composer also treated every message as a browser mission. A request
to draft an email should not navigate the user's current tab or demand a browser
observation. Skills are implementation guidance, not another main destination.

### Revised hierarchy

- **Chat:** the main conversation canvas, multiline composer, compact Auto / Reply
  only / Use browser selector, and an optional Activity disclosure. No permanent
  secondary rail, repeated assistant avatar, timestamp, or per-step success wall.
- **Tools:** collapsed Browser actions, Workflow playbooks, Post generator and
  Content helpers. Existing content-tool handlers are retained under disclosures.
- **Settings:** AI configuration, optional connection diagnostics, appearance,
  Connected apps, creator profile and Learned memory. Memory is not labeled chat
  history, because it stores learned experience rather than conversations.

The three main navigation controls are real buttons. Former Create, Library,
Skills and History tab buttons are removed, and their panels are relocated into
Tools or Settings rather than left as inaccessible top-level tabs.

## Failure analysis of the supplied Vista task trace

1. Duplicate-search interception handled `type` actions but not `search` actions.
2. The `search` executor appended 2026 to every query, including product navigation.
3. Search success was reported from a tool response without verifying the results URL.
4. Long destination URLs were truncated to 120 characters and the planner saw only
   eight links. Product/download links could be excluded from context.
5. After a failed click, automatic Back navigation could undo legitimate progress.
6. Repeated exceptions and rejected completion attempts could bypass the step counter.
7. The chat wrapper recorded every run as completed and advanced saved jobs regardless
   of outcome. A stopped or failed task could contaminate later conversation context.
8. A broad design heuristic matched research/brand tasks, and a chat anti-stall
   fallback could request artwork for unrelated objectives.

## Implemented behavior

- Deterministic text/browser routing; direct responses have no browser-tool access.
- Every browser planning turn consumes the turn budget, including failures and
  unsuccessful verification. Consecutive exceptions and verification attempts have
  separate limits. A ten-minute wall-clock limit is checked between operations.
- Pause/Stop checkpoints after asynchronous planning and before execution prevent
  late planner replies from starting another action. An already-dispatched operation
  is not canceled or undone by this mechanism.
- Both search action formats use query-aware navigation; no automatic year suffix.
  Relevant observed search-result links can be opened without another model call.
  Provider navigation and previously visited destinations are excluded from this
  shortcut. With no grounded candidate, bounded replanning reports the blocker.
- Unique observed link labels can resolve inside larger product-card labels.
  Destination links retain up to 2048 characters. Failed clicks are re-observed
  on the actual page rather than blindly rolled back.
- Downloads use observed/user-supplied URLs. Repeated requests for the same task
  URL do not start duplicate files. Chrome download IDs and state are checked before
  completion; the evaluator must still decide whether the requested file/goal matches.
- Normal page-reading requests on a chat site do not trigger the first-message
  guard. Artwork-specific fallbacks are restricted to explicit artwork objectives.
- Actual reply content and truthful browser outcomes enter bounded conversation
  history. Saved legacy jobs are not automatically marked successful or recursively
  run by the chat wrapper.

## Local retrieval and page awareness

`retrieval.js` implements a small, session-local lexical retrieval index. This is
retrieval-augmented prompting, not an embedding model or a persistent vector database.

- Observations include up to 24,000 characters from `main`, `article` or the page body,
  instead of depending solely on a head/tail summary.
- Text is split into overlapping chunks; at most twelve source pages are retained
  for a browser run. At most five excerpts, with a two-per-source cap, enter retrieval
  context. URLs and titles stay attached to excerpts.
- Link ranking considers the objective, preserves observed destination URLs and
  brings relevant links beyond the first eight menu items into planner context.
- Retrieved source content is explicitly labeled untrusted evidence. It does not
  become an instruction source or proof of execution. Follow-up conversation context
  is separately labeled and bounded.
- Enabled skills are selected by relevance; unrelated playbooks are not inserted
  simply because they were enabled. Site/content-specific guides are conditionally
  loaded, reducing unrelated Gmail/Facebook/design guidance in navigation tasks.

This index is cleared for each browser run and on New chat. It is not background
crawling, private-account indexing or semantic search across files.

## Public-source research

Reviewed during this change on 9 November 2026:

- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
  supports simple routing, explicit stop conditions and environment-grounded feedback.
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) uses structured
  page observations and grounded action targets rather than requiring a vision call
  for every operation.
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
  describes a persistent companion experience and explicitly recommends avoiding
  unnecessary distraction.
- [LX homepage](https://www.lxobsidianportal.co.za/), [Vista page](https://www.lxobsidianportal.co.za/vista)
  and [Downloads](https://www.lxobsidianportal.co.za/downloads) expose observed routes
  to Vista and the Android endpoint `/api/vista-download?platform=android`. These
  routes informed the link-resolution regression scenarios. The APK was not installed,
  and the complete live model-driven download task was not validated by these fetches.

## Verification scope

The local test build passes 30 regression tests and 11 Chromium extension UI tests.

Regression coverage includes the duplicate-search action form, stale-card label
resolution, source-linked middle-of-page retrieval, URL preservation, cancellation
after planning, bounded exceptions and verification, direct text routing, and
download-state checks. Browser fixtures and AI replies are mocked where appropriate;
the real extension and content script run inside Chromium for UI/content tests.

Remaining engineering limits include model-dependent task planning, imperfect page
visibility/iframe coverage, finite-response MCP transport and external runtimes that
still need companion/service integrations. No parallel browser workers were added:
multiple writers controlling one active tab would create more state conflicts.
