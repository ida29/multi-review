# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-review is a CLI tool that performs parallel code reviews using multiple AI models via the GitHub Copilot SDK. It reviews diffs through 6 specialized perspectives (logic, security, design, performance, ux, testing) across configurable models, then merges results with consensus tracking.

## Commands

```bash
npm run dev              # Run CLI directly with tsx (e.g. npm run dev -- --diff)
npm run build            # Compile TypeScript to dist/
npm run check            # Full check: tsc + oxlint + oxfmt + knip
npm run fix              # Auto-fix: oxlint --fix + oxfmt
npm run test             # Run all tests (vitest run)
npm run test:watch       # Run tests in watch mode

# Run a single test file
npx vitest run tests/config.test.ts
```

## Architecture

### 4-Stage Pipeline

```
raw diff → Parse → Triage → Per-File Review → Aggregate → Output
```

1. **Parse** (`src/parse/`): Read diff input → parse into per-file `FileDiff` objects → load surrounding file context from working tree
2. **Triage** (`src/triage/`): Rule-based filtering (binaries, lockfiles, generated files) catches obvious skips; remaining files go through AI triage via Copilot SDK
3. **Per-File Review** (`src/review/`): Each file is reviewed in parallel across all (model × perspective) combinations. Controlled by `--concurrency` (files in parallel) with retry + exponential backoff per API call
4. **Aggregate** (`src/aggregate/`): Merge per-file results, deduplicate issues by title, escalate severity (highest wins), compute consensus (unanimous/majority/single)

### Key Modules

- `src/cli.ts` — Main orchestration, wires all 4 stages together
- `src/config.ts` — Config resolution: CLI args > env vars > defaults
- `src/types.ts` — All type definitions and default constants
- `src/shared/copilotPool.ts` — `CopilotClientPool`: one `@github/copilot-sdk` client per model, reused across reviews
- `src/shared/jsonParser.ts` — Extracts JSON from LLM responses, validates with Zod schemas
- `src/review/perspectives.ts` — Perspective definitions with detailed review instructions
- `src/review/prompt.ts` — System prompt and message construction
- `src/review/reviewer.ts` — Single file/model review with retry logic (transient errors retried, parse errors not)
- `src/review/parallelReviewer.ts` — Concurrent orchestration across files with semaphore pattern
- `src/triage/rules.ts` — Rule-based file filtering (no AI needed)
- `src/aggregate/merger.ts` — Issue deduplication and consensus computation

### Data Flow Types

```
FileDiff → FileDiffWithContext → TriagedFile → FileModelReview → FileMergedReview → AggregatedReport
```

### Config Resolution

Priority: CLI args > environment variables > defaults. Environment variables are prefixed `MULTI_REVIEW_` (e.g. `MULTI_REVIEW_MODELS`, `MULTI_REVIEW_TIMEOUT`).

### Tooling

- **Linter**: oxlint (config: `oxlint.json`)
- **Formatter**: oxfmt (config: `.oxfmtrc.json` — single quotes, trailing commas, printWidth 100)
- **Dead code**: knip (config: `knip.json`)
- **Tests**: Vitest (config: `vitest.config.ts`, tests in `tests/`)
- **Module system**: ESM (`"type": "module"`) — use `.js` extensions in imports
