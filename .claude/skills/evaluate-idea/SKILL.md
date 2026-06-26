---
name: evaluate-idea
description: Run the LLM Council adversarial evaluation of a B2B/software idea. Use when the user says "evaluate this idea <concept>" or "evaluate this idea inline <concept>". With the word "inline" present, run the 5-phase council protocol directly in the conversation (no API keys, uses web search) and write a focused verdict.md at the end. Without "inline", run the real `council` CLI (needs API keys). Project-scoped to this repo.
---

# Evaluate Idea

Run the **LLM Council** — a multi-agent adversarial evaluation (1 Researcher + 7 personas + a visible Master Orchestrator) of an early-stage B2B/enterprise software concept through a strict 5-phase protocol, ending in a `GO` / `NO-GO` / `CONDITIONAL GO` verdict.

## Trigger & mode detection

The user invoked this with one of two catchphrases. Detect the mode from the wording:

| User says | Mode | What to do |
|---|---|---|
| `evaluate this idea inline "<concept>"` | **INLINE** | Run the protocol yourself in the conversation. No API keys. Ground with the `WebSearch` tool. Write `verdict.md` at the end. |
| `evaluate this idea "<concept>"` (no "inline") | **CLI** | Run the installed `council` CLI. Needs API keys. |

The concept is everything after the catchphrase (strip surrounding quotes if present). If no concept was given, ask for it in one line, then proceed.

---

## INLINE mode

Run the full protocol **as the agent**, using the blueprint as the spec. This costs the user nothing beyond their existing Claude plan.

1. **Read the protocol spec.** Skim `llm-council-blueprint.md` §1 (vision), §9 Steps 7–10 (personas, checks, phases, decider). The non-negotiables are in §16. Treat it as source of truth for roles and phase order.

2. **Phase 0 — Researcher grounding.** Use the `WebSearch` tool (and `WebFetch` if a page needs reading) to ground the concept's space: direct competitors, open-source alternatives, market sizing, regulatory/talent signals, relevant economics. Build a **State Document**: a compact table of competitors (name, stage, funding/valuation, differentiator, signal, **confidence**), OSS alternatives (with displacement-risk 1–5), market sizing (TAM/SAM/SOM with source + confidence), and any regulatory/adoption facts. Tag anything derived from weak sources `confidence: low`. Then run the **integrity gate**: if competitor matrix, OSS alternatives, market sizing, and at least one regulatory/economic signal are all present, the gate PASSES. If not, do one more round of searches before proceeding. **Never start the debate on incomplete data.**

3. **Phases 1–4 — run the debate, enforcing constitutions.** Role-play each persona in character under its constitution; act as the Orchestrator between turns.
   - **Phase 1 (opening):** 💼 Business Man → 💻 Informatic → 📊 Financial Man → ⚖️ Ethicist, then build a **Conflict Map** (numbered tensions: which personas, what crux).
   - **Phase 2 (adversarial, 3 rounds):** 👑 Client raises objections onto a running **Objection Ledger**; personas attack/defend; ⚖️ Ethicist speaks **only in Round 2**; emit a **Claim Scorecard** (`SUPPORTED` / `CONTESTED` / `UNSUPPORTED`) after each round.
   - **Phase 3 (Feynman audit):** 💻 Informatic re-explains the concept plainly to a non-technical buyer; 👑 Client determines the gap between what's *exciting* and what's *defensible*; ⚖️ Ethicist confirms the ethical surface.
   - **Phase 4 (Decider):** the 👑 Decider — **silent until now** — synthesizes: evidence tags, conflict resolutions, a **5-dimension score matrix** (Market Opportunity, Technical Feasibility, Financial Viability, Competitive Defensibility, Ethical/Regulatory Risk — each 20%, 0–100, each citing ≥2 quotes from the proceedings), a weighted total, the verdict, conditions/kill-condition, unresolved objections, and a one-sentence next action.

4. **Orchestrator rules (enforce visibly, between turns):**
   - `[UNSUPPORTED CLAIM]` — any named company / statistic / funding figure / valuation **not in the State Document**. Give the persona one chance to source-or-retract, then the flag stands.
   - `[PERSONA BREACH]` — Business Man or Informatic proposing *solutions* (they name risks only); the Decider speaking before Phase 4 or using quality adjectives early; a persona acting out of role.
   - Keep the State Document at the top of context the whole way through.

5. **Write `verdict.md`.** When the verdict is reached, write the file to `runs/<concept-slug>-<YYYY-MM-DD>/verdict.md` (create the folder; slug = lowercased concept, non-alphanumerics → `-`, truncated to ~50 chars). Use the **exact template in `references/verdict-template.md`** in this skill folder. This is a *focused* document — only what matters for the decision, the ideas worth trying, and a clear re-evaluation call. Do **not** dump the full transcript into it; the transcript stays in the conversation.

6. **Close out.** Tell the user the verdict, the weighted score, and the path to `verdict.md`. If the verdict is `CONDITIONAL GO` or `NO-GO`, offer a **Pivot**: "Want me to re-run `evaluate this idea inline` on the narrowed version?"

---

## CLI mode

The user wants the real, API-backed CLI run (deterministic state machine, persisted `run.json`, cost tracking).

1. **Check keys exist.** The CLI needs `ANTHROPIC_API_KEY` and `TAVILY_API_KEY` (Brave + GitHub optional). If there's no `.env`, tell the user to `cp .env.example .env` and fill it in, then stop — don't fabricate keys. Note this path **bills their Anthropic API account** (separate from a Claude subscription).
2. **Run it:**
   ```bash
   pnpm dev run "<concept>"
   ```
   (or `council run "<concept>"` if they've installed the global binary). The Ink TUI streams the live debate and writes artifacts to `runs/<id>/`.
3. If the interactive TUI can't render in the current context, fall back to the headless path described in the README ("Inline / headless") and relay the verdict + score matrix + the `runs/<id>/run.json` path.

---

## Scope

Operates **only** inside this repo. Inline mode never needs API keys and never bills anything. Do not push or publish unless the user explicitly asks.
