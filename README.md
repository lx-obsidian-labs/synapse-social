# Synapse Social

An AI-powered browser extension for Facebook Page management.

## Overview

Synapse Social combines browser automation, AI content generation, community management, analytics intelligence, competitor analysis, and workflow automation into a single browser extension.

## Architecture

- **Frontend**: Next.js with TypeScript, TailwindCSS, shadcn/ui
- **Backend**: NestJS (planned for future phases)
- **Extension**: Chrome Extension MV3
- **AI**: NVIDIA NIM with Nemotron, Llama, VILA models

## Development

```bash
pnpm install
pnpm dev
```

## Structure

```
/apps/
  web/          # Next.js frontend
  extension/    # Chrome extension

/packages/
  ui/           # UI components (shadcn/ui)
  types/        # TypeScript types
  api-client/   # API client
  shared/       # Shared utilities

/workers/
  facebook-parser/  # Facebook DOM parsing
  analytics/        # Analytics processing
  automation/       # Automation workflows
```

## Phases

1. **UI Prototype** (2 weeks) - All pages, navigation, responsive design
2. **Extension Infrastructure** (1 week) - Manifest, content scripts, side panel
3. **Backend** (2 weeks) - Auth, database, API
4. **AI Integration** (2 weeks) - Content generation, chat assistant
5. **Facebook Intelligence** (2 weeks) - Analytics and comment parsing
6. **Beta Release** (1 week) - Testing and optimization
