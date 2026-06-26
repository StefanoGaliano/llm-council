# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

This repo is **pre-implementation**. The only artifact is `llm-council-blueprint.md` — the full design spec. No `src/`, `package.json`, or config exists yet. When building, follow the **Build Order** in §9 of the blueprint (Steps 1–13, each independently runnable/testable). Treat the blueprint as the source of truth for architecture, types, and the agent protocol.

## What This Is

A CLI (`council`) that runs a multi-agent *adversarial* evaluation of B2B/enterprise software concepts: 1 Researcher + 7 specialized personas + a visible Master Orchestrator, driven through a strict 5-phase protocol, ending in a `GO` / `NO-GO` / `CONDITIONAL GO` verdict with a weighted 5-dimension score matrix. Built to *kill* bad ideas via enforced role separation and claim grounding. Single-user terminal tool.

## Commands (once scaffolded)

- `pnpm dev run "<concept>"` — Run an evaluation (dev mode, tsx)
- `pnpm build` — Compile to `dist/`
- `pnpm test` — Run Vitest
- `pnpm test <path>` — Run a single test file (e.g. `pnpm test tests/orchestrator/phases.test.ts`)
- `pnpm lint` — ESLint + Prettier
- `council run "<concept>"` — Run via installed binary (no arg → interactive Ink prompt)
- `council resume <run-id> [--pivot "<change>"]` — Resume / re-ground a run
- `council list` — List past runs with verdict + cost
- `council config` — Set/verify API keys

## Tech Stack

Node 20+ / TypeScript (strict, ESM) / Commander / Ink (React-for-CLI) / `@anthropic-ai/sdk` (Opus 4.8 + Sonnet 4.6) / Tavily + Brave search / Octokit / Zod. Filesystem persistence. Vitest. **pnpm**.

## Architecture

- `src/orchestrator/` — The state machine. Deterministic phase/turn sequencing + per-turn **Orchestrator Check** (LLM flagging). Source of truth for a run; runs identically headless (no Ink).
- `src/agents/` — Persona constitutions + generic `runAgent`; `decider.ts` is the Phase 4 synthesis.
- `src/researcher/` — Tool-using grounding agent (web_search + github_lookup) → `state.md` + `payload.json` (Zod-validated).
- `src/llm/` — Anthropic wrapper (streaming, `cache_control`), model routing, cost accounting.
- `src/ui/` — Ink components; a **pure view** that subscribes to orchestrator events, never drives logic.
- `src/persistence/` — Run-folder lifecycle, resume/pivot.
- `src/config/` — Zod env validation + pinned model IDs/pricing.
- `src/types/` — Shared contracts (Run, StateDocument, Turn, Flag, Verdict).

### Data Flow

CLI → orchestrator runs Phase 0 (Researcher tools → State Document, integrity gate) → Phases 1–4 (each persona turn → Orchestrator Check → flags/re-submit → persist) → Decider verdict. The Ink UI only renders orchestrator events. Every turn is persisted to `runs/<id>/run.json` for resumability.

### Phase / turn rules (deterministic — enforced in `phases.ts`)

- Phase 0: Researcher grounding; repeat if data incomplete.
- Phase 1: Business Man → Informatic → Financial Man → Ethicist, then Conflict Map.
- Phase 2: 3 rounds; Objection Ledger + Claim Scorecard updated per round. **Ethicist speaks only R2 + Phase 3.**
- Phase 3: Feynman audit (re-explanation + Client gap determination).
- Phase 4: **Decider** synthesis. The Decider is **silent until Phase 4**.

## Key Patterns

- **Protocol is code, judgment is LLM.** Phase/turn order is deterministic; only flagging and content generation call the model.
- **State Document is the single source of truth.** Every persona prompt injects `payload.json` (with prompt caching). Unsupported-claim detection compares claims against it.
- **One retry on flags.** A flagged turn gets exactly one re-submission ("source or retract"); then the flag stands and is logged.
- **Graceful degradation.** Tavily→Brave failover; GitHub unauth fallback (with low-confidence tagging); paid sources (Crunchbase/PitchBook/LinkedIn) derived from web search and tagged `confidence: "low"`. Never require a paid API.
- **Cost tracked everywhere.** Token + USD per call, running total in the TUI footer and `run.json`.

## Non-Negotiable Rules

1. Protocol enforced by code — phase/turn order is never delegated to LLM good intentions.
2. No claim without grounding — any named company/stat/funding figure absent from `payload.json` is flagged `UNSUPPORTED_CLAIM`.
3. Persona constitutions are inviolable — breaches (Decider speaking early, Informatic/Business Man proposing solutions) flagged `PERSONA_BREACH`.
4. Never start the debate on incomplete data — Phase 0 integrity gate must pass first.
5. Never require a paid data API; degrade and tag low-confidence.
6. Model IDs live **only** in `src/config/models.ts` (`claude-opus-4-8`, `claude-sonnet-4-6`). Never hardcode elsewhere; never invent IDs.
7. Persist after every turn so runs are resumable.
8. Keep the State Document at the top of every phase's context (compress near context limits, preserving all quantitative data).

## Code Organization

- Max 500 lines per file; extract when longer.
- Path alias `@/` → `src/`. No barrel exports — import from source.
- All external API calls (Anthropic, Tavily, Brave, GitHub) go through **injectable clients** so tests can mock them. **Never hit the network in unit/integration tests.**
- The orchestrator must run identically headless — never put protocol logic in UI components.
- TypeScript strict, no `any`. Validate all boundaries with Zod.

## Model Routing

- Personas + Researcher: `claude-sonnet-4-6`.
- Orchestrator Check + Decider: `claude-opus-4-8`.
- `--model-tier all-opus | all-sonnet | tiered` overrides at runtime.
- Use `cache_control` on persona constitutions + the State Document.
- When doing any Anthropic SDK work, use the `/claude-api` skill for authoritative model IDs, pricing, streaming, tool-use, and prompt-caching params — do not guess.

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude access |
| `TAVILY_API_KEY` | Yes | Primary web search |
| `BRAVE_API_KEY` | Optional | Fallback web search |
| `GITHUB_TOKEN` | Recommended | GitHub repo signals (read-only PAT) |
| `COUNCIL_DEBUG` | Optional | Verbose logging when `1` |

`src/config/env.ts` loads from env + `.env` + optional `~/.councilrc`, validates with Zod, fails fast with a `council config` hint.
