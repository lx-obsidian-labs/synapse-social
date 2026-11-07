# Synapse Social

**Social media automation and management tooling | LX Obsidian Labs**

**Stage:** To confirm from current implementation and releases.  
**Verification:** Monorepo manifest and documentation reviewed; individual features, browser-extension permissions and production integrations not independently tested.

## Purpose and scope

Synapse Social explores a web application and browser-extension workflow for social media management, AI assistance and automation. The repository's existing product roadmap mentions Facebook Page management, analytics and content generation. **Roadmap features are not automatically implemented features.**

## Repository structure

The checked-in root manifest declares a pnpm workspace with `apps/`, `docs/`, `scripts/` and `supabase/` directories. Inspect each workspace package for actual runtime requirements and extension capabilities.

## Local development

Install a compatible Node.js runtime and pnpm, then run:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Root scripts available for verification:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:extension
```

These commands are defined in the root manifest; **passing results have not been established in this review**.

## Architecture and security review

- **Web:** Check authentication, data access, authorization and error states.
- **Browser extension:** Inspect Manifest V3 permissions, content scripts, message validation and host access before distribution.
- **AI integration:** Verify provider configuration, request limits, user consent and treatment of generated content.
- **Social platform access:** Confirm compliance with applicable platform policies and authorization boundaries. Never imply official platform endorsement.
- **Supabase:** Review schema migrations, row-level security and credential separation.
- **Privacy:** Document data collected from accounts/pages, retention and deletion behavior.
- **Testing:** Capture reproducible build, lint, typecheck and test results per package.

## Delivery milestones

1. Produce a source-backed feature matrix (implemented / experimental / planned).
2. Test the extension against supported browser versions using a dedicated test account.
3. Verify API permissions and social platform compliance.
4. Document screenshots, installation, release packaging and rollback.
5. Publish a case study only for demonstrated behavior and independently attributable work.

## Maintainer

**LX Obsidian Labs** · [Engineering portfolio](https://github.com/lx-obsidian-labs/lx-obsidian-labs) · [Contact](mailto:vilanenathan@gmail.com)
