# Build Progress — LLM Council

Tracks the 13-step build order from `llm-council-blueprint.md` §9. Update after each step.

**Legend:** ✅ done · 🚧 in progress · ⬜ not started

| Step | Description | Status |
|------|-------------|--------|
| 1 | Scaffolding (toolchain, configs, dir tree) | ✅ |
| 2 | Config & types (`models.ts`, `env.ts`, `types/index.ts`) | ✅ |
| 3 | LLM client + cost accounting | ✅ |
| 4 | Researcher schema + State Document | ✅ |
| 5 | Researcher tools (Tavily/Brave, GitHub) | ✅ |
| 6 | Researcher agent loop | ✅ |
| 7 | Persona constitutions + generic runner | ✅ |
| 8 | Orchestrator Check (flags) | ✅ |
| 9 | Orchestrator state machine | ✅ |
| 10 | The Decider (Phase 4) | ✅ |
| 11 | Persistence + resume + pivot | ✅ |
| 12 | Ink TUI + CLI commands | ✅ |
| 13 | Hardening + docs | ✅ |

---

## Step 1 — Scaffolding ✅ (2026-06-25)

**Goal:** an installable, buildable, testable, lintable empty project per blueprint §9 Step 1.

### Done
- Verified toolchain: Node v24.15.0, pnpm 11.7.0.
- `package.json` — ESM (`type: module`), `bin.council → dist/index.js`, scripts: `dev` (tsx), `build` (tsc), `test` (vitest run), `test:watch`, `lint` (eslint + prettier --check), `format`.
- `tsconfig.json` — strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; ESNext/Bundler; `@/* → ./src/*`; `react-jsx`; outDir `dist`, rootDir `src`.
- `vitest.config.ts` — node env, globals, `@` alias, `tests/**/*.test.ts(x)`.
- `eslint.config.js` — flat config: js + typescript-eslint recommended + prettier; `no-explicit-any: error`.
- `.prettierrc.json`, `.prettierignore` (ignores `dist`, `runs`, `.claude`, `*.md`), `.gitignore`, `.env.example`.
- `pnpm-workspace.yaml` — `onlyBuiltDependencies: [esbuild]` + `allowBuilds.esbuild: true` (esbuild postinstall was blocked by pnpm 11's build-script gating).
- Full directory tree created (`src/{commands,orchestrator,agents/constitutions,researcher/tools,llm,ui/components,persistence,config,types,util}`, `tests/{orchestrator,researcher,llm,helpers}`, `runs/`) with `.gitkeep` placeholders.
- `src/index.ts` — shebang stub (real Commander/Ink mount comes in Step 12).
- `tests/helpers/scaffold.test.ts` — smoke test (removed when Step 2 adds real suites).

### Verification
- `pnpm build` → emits `dist/index.{js,d.ts,js.map}`, exit 0.
- `pnpm lint` → clean.
- `pnpm test` → 1 file / 1 test passing.

### Notes / gotchas for later
- **Not a git repo yet** — `git init` when ready to version.
- pnpm 11 no longer reads the `pnpm` field in `package.json`; build-script allowlist lives in `pnpm-workspace.yaml`.
- Runtime deps (`@anthropic-ai/sdk`, `commander`, `ink`, `@octokit/rest`, `@tavily/core`, etc.) are **not yet installed** — added per-step as needed.
- TS 6 deprecates `baseUrl`; using `paths` with `./`-prefixed targets instead.

---

## Step 2 — Config & types ✅ (2026-06-25)

**Goal:** pinned model IDs/pricing, fail-fast env validation, and all shared run types.

### Done
- Installed runtime deps `zod@4`, `dotenv@17`.
- `src/config/models.ts` — pinned IDs (`claude-opus-4-8`, `claude-sonnet-4-6`), `PRICING` (Opus $5/$25, Sonnet $3/$15 per Mtok; 1M context), `CACHE_MULTIPLIERS` (write5m 1.25×, read 0.1×), and `modelForRole(role, tier)` routing (tiered = Opus for Orchestrator Check + Decider, Sonnet for personas + Researcher; `all-opus`/`all-sonnet` overrides). **Pricing verified via the `/claude-api` skill.**
- `src/config/env.ts` — Zod schema, `loadEnv(source?)` (process.env + `.env` via dotenv + optional `~/.councilrc`), `EnvValidationError` with `missingKeys` + a `council config` hint. Required: `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`; optional: `BRAVE_API_KEY`, `GITHUB_TOKEN`, `COUNCIL_DEBUG`.
- `src/types/index.ts` — all blueprint §4 contracts: `Run`, `StateDocument` (+ `Competitor`/`OssAlt`/`MarketSizing`/`Benchmark`/`RegItem`/`TalentItem`/`OverwriteEntry`), `Turn`/`TurnUsage`, `Flag`/`FlagType`, `Conflict`, `Verdict` (+ `EvidenceItem`/`ConflictResolution`/`DimensionScore`/`Decision`), `CostLedger`, `PersonaId`, `Phase`.
- `.env.example` already covered the keys (from Step 1).

### Tests (`pnpm test` → 12 passing across 2 files)
- `tests/config/env.test.ts` — accepts minimal keys, carries optional keys, **rejects missing required key** (asserts `missingKeys` + `council config` hint), rejects whitespace-only, parses `COUNCIL_DEBUG`.
- `tests/config/models.test.ts` — routing per tier; every pinned id has positive pricing.
- Removed the Step 1 scaffold smoke test.

### Notes
- The Step 1 `tsconfig` `@/* → ./src/*` alias is exercised for the first time here (env/models tests import via `@/`); resolves cleanly under both `tsc` and Vitest.

---

## Step 3 — LLM client + cost ✅ (2026-06-25)

**Goal:** Anthropic wrapper (streaming/cache-ready, injectable for tests) + token→USD accounting.

### Done
- Installed `@anthropic-ai/sdk@0.105`.
- `src/llm/cost.ts` — `RawUsage`, `normalizeUsage` (SDK null/absent → 0), `costUsd(model, usage)` (uncached input + cache-read 0.1× + cache-write 1.25× + output), `toTurnUsage`, `emptyLedger`/`addToLedger`.
- `src/llm/client.ts` — `LlmBackend` interface (the injected network boundary), `createAnthropicBackend(apiKey)` (wraps the real SDK), `LlmClient.complete(params)` returning `{text, toolUse, stopReason, rawUsage, usage}`. Narrow local wire types (`TextBlockParam` carries `cache_control`, `ToolDef`, `ToolChoice`) — no `any`. Default max_tokens 16k.
- `tests/helpers/mockAnthropic.ts` — `MockBackend` (queue or responder fn, records every `create` body), `textResponse`/`toolUseResponse` builders. **The deterministic stub all later steps mock against.**

### Tests (`pnpm test` → 22 passing across 4 files)
- `tests/llm/cost.test.ts` — base rates (Sonnet $3/$15, Opus $5/$25), cache-read 0.1× and cache-write 1.25× discounts, four-component sum, `normalizeUsage` defaults, `toTurnUsage` mapping, ledger accumulation.
- `tests/llm/client.test.ts` — text extraction + usage + body forwarding; tool_use extraction + `tool_choice` forwarding.

### Notes
- Streaming surface is stubbed for now (`complete()` is create-based); token-by-token streaming for the TUI is wired in Step 12 against the same backend boundary.
- The real SDK's typed params are cast at the `createAnthropicBackend` boundary only; everywhere else uses the narrow local types.

---

## Step 4 — Researcher schema + State Document ✅ (2026-06-25)

**Goal:** Zod schema for the grounding payload (single source of truth) + state.md renderer + overwrite diff.

### Done
- `src/researcher/schema.ts` — full Zod tree mirroring `StateDocument`: `competitorSchema`, `ossAltSchema` (displacementRiskScore 1–5), `marketSizingSchema`, `benchmarkSchema`, `regItemSchema`, `talentItemSchema`, `overwriteEntrySchema`. `confidence` defaults to `'low'`; degraded numeric fields default to `null`. `validateStateDocument(unknown)` returns a tagged result whose `errorText` is ready to feed back as a corrective re-prompt (used by the Step 6 retry).
- `src/researcher/stateDocument.ts` — `renderStateDocument(doc)` → markdown (§2 layout, nulls as `—`, overwrite-log section only when non-empty), and `computeOverwrites(old, new, reason, ts)` diffing top-level fields → `[MEMORY_OVERWRITE]` entries for the Pivot Protocol.
- `tests/helpers/fixtures.ts` — `canonicalPayload` + `makeStateDocument(overrides)`, shared by later steps.

### Tests (`pnpm test` → 32 passing across 6 files)
- `schema.test.ts` — accepts canonical payload; applies `confidence: low` default; rejects missing `conceptSummary` (readable error); rejects out-of-range risk score.
- `stateDocument.test.ts` — renders all sections + timestamp + nulls; overwrite-log presence toggle; `computeOverwrites` one-entry-per-changed-field, identical → none, array change detection.

---

## Step 5 — Researcher tools ✅ (2026-06-25)

**Goal:** the two grounding tools (web search, GitHub signals), source-tagged + degradation-aware, behind an injectable `fetch`.

### Done
- `src/researcher/tools/webSearch.ts` — `webSearch(query, deps)` with Tavily→Brave failover. Returns `{query, provider, results: SearchResult[], degraded}`; each result tagged `source`. `SearchError` thrown when no provider is available or the primary fails with no fallback. `FetchLike`/`FetchResponse` injectable types defined here (reused by github).
- `src/researcher/tools/github.ts` — `githubLookup(query, deps)` resolves `owner/repo` directly or via `/search/repositories`, then fetches stars / `pushed_at`→lastCommitDaysAgo / open issues / contributor count. Injectable `now()` clock. Confidence: `high` with token, `medium` unauthenticated, `low` on 403 rate-limit. Implemented via injected `fetch` against `api.github.com` (no `@octokit/rest` dep — keeps the boundary mockable and dependency-light; **deviation from blueprint's Octokit, noted**).
- `tests/helpers/mockFetch.ts` — `makeMockFetch(routes)` (substring routing, records calls, can simulate network throw / status codes).

### Tests (`pnpm test` → 42 passing across 8 files)
- `webSearch.test.ts` — Tavily-first + source tag; Brave fallback on error and on empty; `SearchError` when no provider / Tavily-fails-no-Brave.
- `github.test.ts` — direct owner/repo + last-commit math + no search call; free-text → search resolution; token → `high` confidence + `Authorization` header; 403 → low-confidence not-found; empty search → not-found.

### Notes
- Mock route matching is **first-match**, so tests list specific routes (`/contributors`) before broader ones (`/repos/o/r`) — a longest-match heuristic was rejected because the repo path is a substring of the contributors URL yet longer than `/contributors`.

---

## Step 6 — Researcher agent loop ✅ (2026-06-25)

**Goal:** the agentic Phase 0 loop tying tools + schema + renderer together, headless and mockable.

### Done
- `src/researcher/researcher.ts` — `runResearcher(concept, deps)`. Exposes `web_search` / `github_lookup` / `submit_state_document` tools to the model; loops executing tools (feeding results back as `tool_result` blocks), validates `submit_state_document` input with `validateStateDocument`, allows **one** corrective retry (feeds the Zod `errorText` back as an `is_error` tool_result), renders `state.md` on success. Accumulates `CostLedger` across calls. Emits `ResearcherEvent`s (`tool_call`/`tool_result`/`validating`/`retry`/`done`). `maxIterations` guard (default 12) → `ResearcherError`. Tool errors are surfaced to the model as `is_error` results rather than crashing.

### Tests (`pnpm test` → 46 passing across 9 files)
- `researcher.test.ts` — full tool→tool→submit happy path (usage summed across 3 calls, `done` event, 3 model calls); one-retry-then-success; throws after second invalid; tool error surfaced as `is_error` without crashing.

### Notes
- `client.ts` `MessageParam.content` widened to `ContentBlockParam[]` (`TextBlockParam | ({type} & Record)`) so the loop can append reconstructed `tool_use` / `tool_result` blocks without `any`.
- **`MockBackend` now `structuredClone`s each request** — the loop mutates one `messages` array in place, so per-call assertions need a snapshot. (Affects all later orchestrator tests too.)

---

## Step 7 — Persona constitutions + generic runner ✅ (2026-06-25)

**Goal:** the 7 council personas (constitutions + metadata) and the generic turn runner.

### Done
- `src/agents/constitutions/{decider,businessMan,marketingMan,financialMan,informatic,client,ethicist}.ts` — verbatim role mandates + forbidden behaviors faithful to the blueprint roles (Decider silent until Phase 4 + no quality adjectives; Informatic/Business/Marketing/Financial propose no solutions; Client keeps the Objection Ledger + Phase 3 Feynman gap/insight call; Ethicist regulatory grounding). Each forbids asserting figures/entities absent from the State Document.
- `src/agents/registry.ts` — `PERSONAS` record (id, displayName, glyph, accent hex for the TUI, constitution, `modelRole`). Decider → `decider` role (Opus); the rest → `persona` (Sonnet). `getPersona(id)`.
- `src/agents/runAgent.ts` — `runAgent(personaId, ctx, deps)`: system = constitution (cached); user = State Document (cached) + allowed transcript slice + phase-specific instruction; resolves model via `modelForRole(role, tier)`. Re-submission appends an `[ORCHESTRATOR FLAG]` source-or-retract directive. Returns a `Turn` with `flags: []` (orchestrator fills flags in Step 8/9).

### Tests (`pnpm test` → 52 passing across 10 files)
- `runAgent.test.ts` — registry has all 7 with non-trivial constitutions + correct model roles; Turn shape; constitution cached in system + State Document cached in first user block; Decider→Opus, persona→Sonnet under tiered; `all-opus` override; re-submission flag directive carries the offending claim.

---

## Step 8 — Orchestrator Check ✅ (2026-06-25)

**Goal:** per-turn integrity check (Opus, structured tool-call) + the one-retry resolution contract.

### Done
- `src/orchestrator/checks.ts` — `runCheck(input, deps)`: Opus call with a forced `emit_flags` tool returning `{flags:[{type,detail,quote?}]}`; parses defensively (drops unknown flag types, folds `quote` into `detail`), tags each `Flag` with `personaId` + `resolved:false`. System prompt encodes the three detection rules (UNSUPPORTED_CLAIM vs payload.json, PERSONA_BREACH vs constitution, CIRCULAR_REASONING). `checkAndResolve(turn, base, deps)` wires the contract: check → if flagged, `resubmit(flags)` exactly once → re-check → flags that vanish are marked `resolved`, persisting/new ones stand; returns the standing turn + all check usages.

### Tests (`pnpm test` → 60 passing across 11 files)
- `checks.test.ts` — forces Opus + emit_flags tool; UNSUPPORTED_CLAIM (competitor absent from payload, quote folded into detail); PERSONA_BREACH (Decider speaking in Phase 2); unknown flag type dropped; clean turn → no flags; resolution contract: clean-first (no resubmit, 1 usage), resubmit-then-resolved, persists-unresolved.

---

## Step 9 — Orchestrator state machine ✅ (2026-06-25)

**Goal:** the deterministic Phase 0→4 driver — turn-order tables, integrity gate, per-turn Check wiring, Conflict Map / Claim Scorecard / Objection Ledger synthesis — running identically headless.

### Done
- `src/orchestrator/phases.ts` — fixed turn-order tables: `phase1Turns()` (Business Man → Informatic → Financial Man → Ethicist), `phase2Turns(round)` (5 speakers; Ethicist joins **only Round 2**), `PHASE2_ROUNDS=3`, `phase3Turns()` (Feynman: Informatic re-explanation → Ethicist → Client gap). Decider absent from all pre-Phase-4 tables. `checkIntegrity(doc)` — deterministic Phase 0 gate (non-empty conceptSummary, competitorMatrix, all three market figures) returning `{ok, missing}`.
- `src/orchestrator/transcript.ts` — `renderTurn`/`renderTranscript`: turns → markdown proceedings slice with inline `[ORCHESTRATOR FLAG]` lines (shared by persona prompts + synthesis calls).
- `src/orchestrator/conflictMap.ts` — `buildConflictMap(phase1Turns, deps)`: Opus forced `build_conflict_map` tool → `Conflict[]` (persona ids validated/filtered).
- `src/orchestrator/scorecard.ts` — `buildScorecard(round, turns, payloadJson, deps)` (forced `build_scorecard` → claims tagged SUPPORTED/CONTESTED/UNSUPPORTED) + `extractObjections(turns, deps)` (forced `extract_objections` → unresolved Client concerns). Both Opus, defensively parsed.
- `src/orchestrator/orchestrator.ts` — `runCouncil(concept, deps)`: builds the `Run`, drives Phase 0 (integrity gate, repeat up to `maxResearchAttempts`) → Phase 1 + Conflict Map → Phase 2 (3 rounds, scorecard + ledger merge per round) → Phase 3 → Phase 4 (injected `decide` — Step 10 plugs in the real Decider). Each turn runs through `checkAndResolve` (one-retry contract) with cost accounting for first call + re-submission + checks; emits `OrchestratorEvent`s and persists via `onTurnEnd` after every turn. `OrchestratorError` on a failed integrity gate.
- `src/util/slug.ts` — `slugify()` for run ids/folders.

### Tests (`pnpm test` → 72 passing across 13 files)
- `phases.test.ts` — Phase 1 order; Decider never speaks pre-Phase-4; Ethicist only R2 + Phase 3; 3 rounds carry round number; Phase 3 ends on Client; integrity gate pass + missing-field detection.
- `orchestrator.test.ts` — full headless pipeline (23 persona turns, verdict, conflict map, ledger, cost > 0, slugged id) via a single tool-branching responder; persist-per-turn + ordered `phase:start` events `[0,1,2,2,2,3,4]`; Phase 0 repeats until gate passes; throws when it never passes; unresolved PERSONA_BREACH flags surfaced on the Run.

### Notes
- Phase 4 is driven through an injected `decide(DeciderInput) → DeciderOutput` dep so Step 10 only wires the real Decider; the orchestrator already accounts its usages.
- Objection ledger merge is order-preserving + case-insensitively de-duplicated across rounds.

---

## Step 10 — The Decider (Phase 4) ✅ (2026-06-25)

**Goal:** the silent synthesis agent — full transcript + ledger + conflict map → a structured, validated `Verdict`. Opus, forced tool-call.

### Done
- `src/agents/decider.ts` — `runDecider(input, deps)`: Opus call with a forced `deliver_verdict` tool whose schema mirrors `Verdict` (evidence tags, conflict resolutions, 5×weight-20 score matrix, decision, conditions, killCondition, unresolvedObjections, nextAction). System prompt prepends the Decider constitution + Phase-4 synthesis rules. User content injects concept + payload JSON + rendered Conflict Map + Objection Ledger + full proceedings. Output validated by a **strict Zod `verdictSchema`** (decision/tag/persona enums, score 0–100, exactly 5 dimensions, **≥2 cited quotes per dimension**); one corrective retry feeding the Zod issue list back, then `DeciderError`.
- `makeDecider(deps)` binds it to the orchestrator's `decide(DeciderInput) → DeciderOutput` dependency (returns `{verdict, usages}`); `DECIDER_SPEC` re-exported.

### Tests (`pnpm test` → 77 passing across 14 files)
- `decider.test.ts` — forces Opus + deliver_verdict, returns validated Verdict (5 dims, 1 usage); conflict map + ledger injected into the prompt; retry-once on <2 cited quotes then success (correction carried in retry prompt); `DeciderError` on never-valid decision enum; `makeDecider` binding works.

### Notes
- The score-matrix "≥2 cited quotes" and "exactly 5 dimensions" rules from the blueprint are enforced *structurally* in Zod, not left to the prompt — an invalid matrix triggers the corrective retry.

---

## Step 11 — Persistence + resume + pivot ✅ (2026-06-25)

**Goal:** durable run-folder artifacts + resume-from-saved-phase + the Pivot Protocol, all headless and tmp-dir testable.

### Done
- `src/persistence/paths.ts` — `runsRoot`/`runDir`/`runPaths(id, root?)` resolving `runs/<id>/{state.md,payload.json,transcript.md,verdict.md,run.json}`; root injectable for tests.
- `src/persistence/serialize.ts` — `renderTranscriptMd(run)` (debate grouped by phase, inline flags via `renderTurn`, Conflict Map + Objection Ledger appended) and `renderVerdictMd(run)` (decision label, score matrix table, evidence tags, conflict resolutions, conditions/kill-condition, unresolved objections).
- `src/persistence/run.ts` — `saveRun` (run.json + transcript.md always; payload.json/state.md once grounded; verdict.md once decided — the orchestrator's `onTurnEnd`), `loadRun` (resume source of truth; `PersistenceError` on missing/corrupt), `listRuns` (newest-first summaries, skips non-run dirs).
- **Orchestrator refactor** (`orchestrator.ts`) — extracted a `drive(run, prepared, startPhase, deps)` core with **turn-level skip** (completed turns reused, never re-paid) gated by `startPhase`. `runCouncil` = Phase 0 + `drive(…,1)`. New `resumeCouncil(run, deps)` (re-grounds only if no State Document / phase 0, else re-derives `stateMarkdown`/`payloadJson` from the saved doc and continues from `run.phase`). New `pivotCouncil(run, change, deps)` (re-runs Researcher with `[PIVOT]` appended, logs `computeOverwrites` into `overwriteLog`, resets the debate, resumes from Phase 1).

### Tests (`pnpm test` → 85 passing across 16 files)
- `persistence/run.test.ts` — save→load round-trip (deep-equal); transcript.md content; state.md/payload.json/verdict.md gating; `listRuns` ordering + junk-dir skip + empty-dir → `[]`; `PersistenceError` on missing run. Uses a `mkdtemp` temp root.
- `orchestrator/resume.test.ts` — resume mid-Phase-2 runs exactly the 14 pending turns (no Phase 1 re-runs, no re-grounding), reaches Phase 4 with verdict; re-grounds when State Document absent; pivot threads `[PIVOT]` into research, writes a `conceptSummary` overwrite entry, resets + completes.

### Notes
- Phase-2 rounds also skip wholesale when every turn is already present (avoids redundant scorecard/objection synthesis); Phase 4 is skipped if `run.verdict` is already set — makes `drive` idempotent on a completed run.
- `saveRun` writes JSON with 2-space indent; `loadRun` returns the raw `Run` (resume re-derives the grounding context, so no payload object is stored separately from `stateDocument`).

---

## Step 12 — Ink TUI + CLI commands ✅ (2026-06-25)

**Goal:** the live terminal experience + the `council` command surface mounting it.

### Done
- Installed `ink`, `react`, `ink-spinner`, `ink-text-input`, `commander` (+ dev `ink-testing-library`).
- `src/composition.ts` — `buildClients(env, tier, onResearcherEvent?)`: the composition root turning a validated env + tier into `{llm, research, decide}` (real Anthropic backend + Tavily/Brave search + GitHub via global `fetch`; `makeDecider`). Integrity-gate `missing` fields are threaded back into the Researcher prompt on re-runs.
- `src/ui/theme.ts` — semantic colors (blueprint §7) + decision/tag color maps.
- `src/ui/components/*` — `PhaseHeader`, `AgentPane` (accent border + glyph + spinner while streaming + inline `FlagBanner`), `FlagBanner` (red box), `ObjectionLedger`, `ScoreMatrix` (verdict + weighted matrix + evidence tags), `CostFooter` (token/USD meter), `ConceptPrompt` (ink-text-input).
- `src/ui/App.tsx` — the **pure view**: subscribes to `OrchestratorEvent`s, holds phase/round/turns/active/ledger/cost/verdict/error state, calls the injected `start(onEvent)` once on mount, `exit()`s on resolve/reject. Never drives protocol logic.
- `src/commands/{config.ts,list.ts,run.tsx,resume.tsx}` — `config` (read-only credential status; pure `checkConfig`/`formatConfigReport`), `list` (`listRuns` + `formatRunList`), `run` (loads env → builds clients → renders `<App>`; no-arg → `ConceptPrompt` first; `saveRun` as `onTurnEnd`), `resume` (`loadRun` → `resumeCouncil`, or `pivotCouncil` with `--pivot`).
- `src/index.ts` — Commander `buildProgram()`: `run [concept] --model-tier`, `resume <id> --pivot --model-tier`, `config`, `list`; `parseTier` validation; `EnvValidationError` → friendly stderr + exit 1; commands lazy-`import` so `config`/`list` don't pull in Ink. Auto-runs only when invoked as `dist/index.js`.

### Tests (`pnpm test` → 92 passing across 18 files)
- `commands/commands.test.ts` — config present/missing/whitespace handling + all-set confirmation; list empty guidance + formatted summary (verdict + cost) + reads a saved run from a temp dir; `buildProgram` registers exactly `[config, list, resume, run]`.
- `ui/app.test.tsx` — renders the live debate from a scripted event stream via `ink-testing-library`: phase header, agent pane + content, inline flag, objection ledger, `VERDICT: NO-GO`, cost footer. (`start` holds the run open briefly so the frame is observable before `exit()`.)

### Notes
- Components return `React.ReactElement` (not the removed global `JSX.Element`) for React 19 compatibility.
- The whole UI is injected the orchestrator's run via a `start(onEvent) => Promise<Run>` prop, so it's testable headless and the orchestrator stays UI-agnostic.

---

## Step 13 — Hardening + docs ✅ (2026-06-25)

**Goal:** the Token Context Rule, README, and a final green pass. (Graceful-degradation paths — Tavily→Brave failover, GitHub unauth/rate-limit low-confidence tagging — and `--model-tier` were already delivered in Steps 5/12; the target-project `CLAUDE.md` already exists.)

### Done
- **Token Context Rule (non-negotiable #8)** — `src/researcher/stateDocument.ts` gains `renderStateDocumentCompact(doc)` (keeps the State Document at the top of context but compresses it — **all quantitative data preserved**: funding, stars, last-commit, displacement risk, market figures/years, benchmarks; long free-text columns clipped/dropped) and `chooseStateMarkdown(doc, transcriptChars, threshold=24k)`. The orchestrator's `drive()` now renders the State Document per turn via `chooseStateMarkdown`, switching to compact once the transcript slice grows large — so late Phase-2/3 turns stay grounded without blowing the budget.
- `README.md` — vision, the 5-phase table, setup (Node 20+/pnpm, the 4 keys), usage (`run`/`resume`/`--pivot`/`list`/`config`, `--model-tier`), run artifacts, dev workflow, and the architecture map + "protocol is code, judgment is LLM" principle.

### Tests (`pnpm test` → 94 passing across 18 files)
- `stateDocument.test.ts` (+2) — compact render is smaller yet preserves funding/TAM/displacement-risk; `chooseStateMarkdown` switches full → compact past the threshold.

### Final verification
- `pnpm build` → clean. `pnpm test` → 94/94. `pnpm lint` → clean.

---

## Build complete 🎉

All 13 steps done. `council` is a fully-wired, headless-testable adversarial evaluation CLI: deterministic 5-phase orchestrator, 7 personas + Researcher + Decider, per-turn Opus integrity checks, filesystem persistence with resume/pivot, an Ink TUI, and a Commander surface. 94 tests, no network in the suite.
