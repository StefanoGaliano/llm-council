# LLM Council

A CLI (`council`) that runs a structured, multi-agent **adversarial** evaluation of early-stage B2B / enterprise software concepts. You type a concept; the tool spins up **1 Researcher + 7 specialized personas** governed by a visible **Master Orchestrator**, and drives them through a strict **5-phase protocol** ending in a `GO` / `NO-GO` / `CONDITIONAL GO` verdict backed by a weighted 5-dimension score matrix.

It is built to *kill* bad ideas: enforced role separation eliminates confirmation bias, every named claim must trace back to the Researcher's timestamped **State Document**, and the orchestrator interrupts unsupported claims and persona breaches in real time.

## Two ways to run — just say the catchphrase

If you open this repo in **[Claude Code](https://claude.com/claude-code)** (or any agent that loads this project's skills), you don't need to learn any commands. Just type one of these:

| Say this | Mode | Needs API keys? | Cost |
|---|---|---|---|
| `evaluate this idea inline "<your idea>"` | **Inline** — the agent runs the whole 5-phase council *in the chat*, grounds it with live web search, and writes a focused `verdict.md` at the end. | **No** | Free (runs on your existing Claude plan) |
| `evaluate this idea "<your idea>"` | **CLI** — runs the real `council` binary: deterministic state machine, live TUI, persisted `run.json`, cost meter. | **Yes** (`ANTHROPIC_API_KEY` + `TAVILY_API_KEY`) | Billed to your Anthropic API account |

Examples:

```text
evaluate this idea inline "a local-first tool that scores who understands each part of a codebase"
evaluate this idea "an AI tool that auto-generates SOC2 evidence for B2B SaaS startups"
```

The phrase is recognized by the **`evaluate-idea`** skill in `.claude/skills/` — it ships with the repo, so anyone who clones it gets the catchphrase for free. **Inline mode** is the zero-setup path: no keys, no build, nothing to bill. **CLI mode** is the full deterministic engine and is documented under [Setup](#setup) / [Usage](#usage) below.

### What inline mode writes

At the end of an inline run, `verdict.md` is written to `runs/<idea-slug>-<date>/`. It is a deliberately **short decision document** — not the transcript — containing only:

- the **decision** (`GO` / `CONDITIONAL GO` / `NO-GO`) + weighted score,
- the **3–5 factors that actually drove it**,
- the 5-dimension **score matrix**,
- **ideas worth trying** to move the weak dimensions (each with the risk it retires),
- and a clear **re-evaluation call**: re-run with the improved idea, proceed as-is, or stop because a fatal kill-condition stands.

## How it works

| Phase | What happens |
|-------|--------------|
| **0 — Grounding** | The Researcher uses web search + GitHub to build a `State Document` (competitors, OSS alternatives, market sizing, benchmarks, regulation, talent). A deterministic **integrity gate** repeats Phase 0 until the data is complete. |
| **1 — Opening** | Business Man → Informatic → Financial Man → Ethicist each give an in-role assessment; the orchestrator builds a **Conflict Map**. |
| **2 — Debate** | 3 adversarial rounds. A **Claim Scorecard** and the Client's **Objection Ledger** update each round. The Ethicist speaks only in Round 2. |
| **3 — Feynman audit** | The concept is re-explained in the simplest terms; the Client determines the decisive gap. |
| **4 — Verdict** | The silent **Decider** (Opus) synthesizes everything into a verdict + weighted score matrix, each score citing ≥2 quotes from the proceedings. |

**Every turn** runs through an Opus **Orchestrator Check** that flags `UNSUPPORTED_CLAIM`, `PERSONA_BREACH`, and `CIRCULAR_REASONING`; a flagged turn gets exactly one "source or retract" re-submission.

## Setup

Requires **Node 20+** and **pnpm**.

```bash
pnpm install
pnpm build
```

Set your API keys (shell env, a `.env` file, or `~/.councilrc`):

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | yes | Claude access (Opus 4.8 + Sonnet 4.6) |
| `TAVILY_API_KEY` | yes | Primary web search |
| `BRAVE_API_KEY` | optional | Search fallback |
| `GITHUB_TOKEN` | recommended | GitHub repo signals (read-only PAT) |

Copy `.env.example` to `.env` to get started. Check status anytime with `council config`.

## Usage

```bash
# Run an evaluation (dev mode, no build needed)
pnpm dev run "An AI tool that auto-generates SOC2 evidence for B2B SaaS startups"

# Or via the built binary
council run "<concept>"
council run                       # no arg → interactive prompt

council resume <run-id>           # continue an interrupted run from its saved phase
council resume <run-id> --pivot "target mid-market instead of enterprise"

council list                      # past runs with verdict + cost
council config                    # verify API keys
```

**Model routing** (`--model-tier`): `tiered` (default — Sonnet for personas/Researcher, Opus for the Orchestrator Check + Decider), `all-opus`, or `all-sonnet`.

A live token/USD meter is pinned to the footer; the full breakdown lands in `run.json`.

## Run artifacts

Each run writes a folder under `runs/<concept-slug>-<timestamp>/`:

| File | Contents |
|------|----------|
| `state.md` | Human-readable State Document |
| `payload.json` | Zod-validated grounding (single source of truth) |
| `transcript.md` | Full debate, phase by phase, with flags inline |
| `verdict.md` | Decider's judgment + score matrix |
| `run.json` | Full run state (resume source of truth) |

Persistence happens after **every turn**, so a run is always resumable.

## Development

```bash
pnpm dev run "<concept>"   # run via tsx
pnpm build                 # compile to dist/
pnpm test                  # vitest
pnpm test <path>           # a single test file
pnpm lint                  # eslint + prettier --check
pnpm format                # prettier --write
```

All external API calls (Anthropic, Tavily, Brave, GitHub) go through injectable clients, so the full pipeline runs headless and fully mocked in tests — no network is ever hit in the suite.

The build compiles `@/…` path aliases to real relative paths (`tsc && tsc-alias`), so the global `council` binary works after `pnpm build` + `npm i -g .` — not just `pnpm dev`.

## Integrity probe (red-team the council)

A live, adversarial diagnostic that hits the real model to see whether the personas actually hold their constitutions under pressure:

```bash
ANTHROPIC_API_KEY=sk-... pnpm probe
```

It runs three stress tests and prints a pass/⚠️ report:

1. **Hallucination bait** — tempts a persona to name competitors/figures absent from the State Document, then checks whether the Orchestrator Check flags them `UNSUPPORTED_CLAIM`.
2. **Long-output instruction decay (canary)** — asks for a long answer with an instruction to emit an exact marker every *N* words; the analyzer measures the cadence and reports whether instruction-following **degraded** as the output grew.
3. **Contradiction handling** — feeds a self-contradictory State Document and checks whether the persona surfaces the conflict instead of papering over it with false precision.

The **canary** (`src/util/canary.ts`) is reusable on any persona turn via `AgentContext.canary = { everyWords, phrase }` — off by default. Deterministic, no-network versions of all three probes live in `tests/agents/extreme.test.ts` and `tests/util/canary.test.ts`.

### Architecture

- `src/orchestrator/` — the deterministic state machine (phase/turn order + per-turn Orchestrator Check). Runs identically headless.
- `src/agents/` — persona constitutions, the generic runner, and the Decider.
- `src/researcher/` — the tool-using grounding agent + State Document.
- `src/llm/` — Anthropic wrapper (caching) + cost accounting.
- `src/ui/` — Ink components; a **pure view** subscribing to orchestrator events.
- `src/persistence/` — run-folder lifecycle, resume + pivot.
- `src/config/` — env validation + pinned model IDs/pricing.

The guiding principle: **protocol is code, judgment is LLM.** Phase and turn order are never delegated to the model — only flagging and content generation are.
