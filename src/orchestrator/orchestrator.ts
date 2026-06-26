/**
 * The state machine — drives a council run through Phase 0→4. Deterministic
 * phase/turn sequencing (phases.ts); the only model calls are per-turn content
 * (runAgent), the per-turn Orchestrator Check (checks.ts), and the orchestrator
 * synthesis artifacts (Conflict Map, Claim Scorecard, Objection Ledger).
 *
 * Runs identically headless: it emits events for a UI to subscribe to but never
 * depends on one, and persists after every turn via an injected callback.
 */

import type { LlmClient } from '@/llm/client';
import { type ModelTier } from '@/config/models';
import { addToLedger, emptyLedger } from '@/llm/cost';
import type { Conflict, CostLedger, Flag, Phase, Run, Turn, TurnUsage, Verdict } from '@/types';
import { getPersona, type CouncilPersonaId } from '@/agents/registry';
import { runAgent } from '@/agents/runAgent';
import { checkAndResolve } from '@/orchestrator/checks';
import { renderTranscript } from '@/orchestrator/transcript';
import { buildConflictMap } from '@/orchestrator/conflictMap';
import { buildScorecard, extractObjections, type ClaimScorecard } from '@/orchestrator/scorecard';
import {
  checkIntegrity,
  phase1Turns,
  phase2Turns,
  phase3Turns,
  PHASE2_ROUNDS,
  type TurnSpec,
} from '@/orchestrator/phases';
import type { ResearcherResult } from '@/researcher/researcher';
import {
  renderStateDocument,
  computeOverwrites,
  chooseStateMarkdown,
} from '@/researcher/stateDocument';
import { slugify } from '@/util/slug';

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export type OrchestratorEvent =
  | { type: 'phase:start'; phase: Phase; round: number | null }
  | { type: 'integrity'; ok: boolean; missing: string[]; attempt: number }
  | { type: 'turn:start'; personaId: CouncilPersonaId; phase: Phase; round: number | null }
  | { type: 'turn:end'; turn: Turn }
  | { type: 'flag'; flag: Flag }
  | { type: 'conflictMap'; conflicts: Conflict[] }
  | { type: 'scorecard'; scorecard: ClaimScorecard }
  | { type: 'ledger:update'; objectionLedger: string[] }
  | { type: 'cost:update'; cost: CostLedger }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'done'; run: Run };

/** What the Decider (Step 10) receives. Injected so Phase 4 is pluggable. */
export interface DeciderInput {
  run: Run;
  payloadJson: string;
}

export interface DeciderOutput {
  verdict: Verdict;
  usages: TurnUsage[];
}

export interface OrchestratorDeps {
  llm: LlmClient;
  modelTier?: ModelTier;
  /** Phase 0 grounding. `missing` carries integrity-gate guidance on re-runs. */
  research: (concept: string, attempt: number, missing: string[]) => Promise<ResearcherResult>;
  /** Phase 4 synthesis. Step 10 plugs in the real Decider. */
  decide: (input: DeciderInput) => Promise<DeciderOutput>;
  onEvent?: (e: OrchestratorEvent) => void;
  onTurnEnd?: (run: Run) => void | Promise<void>;
  now?: () => Date;
  /** Max Phase 0 attempts before giving up on the integrity gate. */
  maxResearchAttempts?: number;
  maxTokens?: number;
}

function turnKey(phase: Phase, round: number | null, personaId: string): string {
  return `${phase}:${round ?? '-'}:${personaId}`;
}

/** Prepared grounding context shared across phases (re-derivable on resume). */
interface Prepared {
  stateMarkdown: string;
  payloadJson: string;
}

/**
 * Drive phases `startPhase..4` against an already-grounded run. Completed turns
 * (present in `run.transcript`) are skipped, so a partially-finished phase
 * resumes mid-phase without re-paying for done turns.
 */
async function drive(
  run: Run,
  prepared: Prepared,
  startPhase: Phase,
  deps: OrchestratorDeps,
): Promise<Run> {
  const tier: ModelTier = run.modelTier;
  const { stateMarkdown, payloadJson } = prepared;

  const emit = (e: OrchestratorEvent): void => deps.onEvent?.(e);
  const persist = async (): Promise<void> => {
    await deps.onTurnEnd?.(run);
  };
  const addCost = (usage: TurnUsage): void => {
    run.cost = addToLedger(run.cost, usage);
    emit({ type: 'cost:update', cost: run.cost });
  };

  const completed = new Set(run.transcript.map((t) => turnKey(t.phase, t.round, t.personaId)));

  const runTurn = async (spec: TurnSpec): Promise<Turn> => {
    const key = turnKey(spec.phase, spec.round, spec.personaId);
    if (completed.has(key)) {
      // Already done in a prior session — reuse the persisted turn.
      return run.transcript.find((t) => turnKey(t.phase, t.round, t.personaId) === key)!;
    }
    emit({ type: 'turn:start', personaId: spec.personaId, phase: spec.phase, round: spec.round });
    const persona = getPersona(spec.personaId);
    const runAgentDeps = {
      llm: deps.llm,
      modelTier: tier,
      ...(deps.maxTokens !== undefined ? { maxTokens: deps.maxTokens } : {}),
    };

    const buildCtx = (resubmissionFlags?: Flag[]) => {
      const transcriptSlice = renderTranscript(run.transcript);
      // Token Context Rule (#8): keep the State Document at the top of context,
      // compressing (preserving all quantitative data) once the transcript is large.
      const sd =
        run.stateDocument !== null
          ? chooseStateMarkdown(run.stateDocument, transcriptSlice.length)
          : stateMarkdown;
      return {
        phase: spec.phase,
        round: spec.round,
        stateMarkdown: sd,
        transcriptSlice,
        instruction: spec.instruction,
        ...(resubmissionFlags ? { resubmissionFlags } : {}),
      };
    };

    const firstTurn = await runAgent(spec.personaId, buildCtx(), runAgentDeps);
    addCost(firstTurn.usage);

    const { turn, usages } = await checkAndResolve(
      firstTurn,
      { constitution: persona.constitution, payloadJson },
      {
        llm: deps.llm,
        modelTier: tier,
        resubmit: (flags) => runAgent(spec.personaId, buildCtx(flags), runAgentDeps),
      },
    );
    for (const u of usages) addCost(u);
    // A re-submission means a second persona call was made inside checkAndResolve.
    if (turn !== firstTurn && turn.resubmission) addCost(turn.usage);

    run.transcript.push(turn);
    completed.add(key);
    for (const f of turn.flags) {
      run.flags.push(f);
      emit({ type: 'flag', flag: f });
    }
    emit({ type: 'turn:end', turn });
    await persist();
    return turn;
  };

  // ── Phase 1: opening assessments → Conflict Map ────────────────────────────
  if (startPhase <= 1) {
    run.phase = 1;
    emit({ type: 'phase:start', phase: 1, round: null });
    const phase1Out: Turn[] = [];
    for (const spec of phase1Turns()) phase1Out.push(await runTurn(spec));

    if (run.conflictMap.length === 0) {
      const conflictMap = await buildConflictMap(phase1Out, { llm: deps.llm, modelTier: tier });
      addCost(conflictMap.usage);
      run.conflictMap = conflictMap.conflicts;
    }
    emit({ type: 'conflictMap', conflicts: run.conflictMap });
    await persist();
  }

  // ── Phase 2: three adversarial rounds ──────────────────────────────────────
  if (startPhase <= 2) {
    run.phase = 2;
    for (let round = 1; round <= PHASE2_ROUNDS; round++) {
      const specs = phase2Turns(round);
      const allDone = specs.every((s) => completed.has(turnKey(s.phase, s.round, s.personaId)));
      if (allDone) continue; // round fully processed in a prior session
      emit({ type: 'phase:start', phase: 2, round });
      const roundTurns: Turn[] = [];
      for (const spec of specs) roundTurns.push(await runTurn(spec));

      const scorecard = await buildScorecard(round, roundTurns, payloadJson, {
        llm: deps.llm,
        modelTier: tier,
      });
      addCost(scorecard.usage);
      emit({ type: 'scorecard', scorecard: scorecard.scorecard });

      const objections = await extractObjections(roundTurns, { llm: deps.llm, modelTier: tier });
      addCost(objections.usage);
      run.objectionLedger = mergeObjections(run.objectionLedger, objections.objections);
      emit({ type: 'ledger:update', objectionLedger: run.objectionLedger });
      await persist();
    }
  }

  // ── Phase 3: Feynman audit ─────────────────────────────────────────────────
  if (startPhase <= 3) {
    run.phase = 3;
    emit({ type: 'phase:start', phase: 3, round: null });
    for (const spec of phase3Turns()) await runTurn(spec);
  }

  // ── Phase 4: Decider synthesis ─────────────────────────────────────────────
  if (run.verdict === null) {
    run.phase = 4;
    emit({ type: 'phase:start', phase: 4, round: null });
    const decision = await deps.decide({ run, payloadJson });
    for (const u of decision.usages) addCost(u);
    run.verdict = decision.verdict;
    emit({ type: 'verdict', verdict: decision.verdict });
    await persist();
  }

  emit({ type: 'done', run });
  return run;
}

/** Start a fresh evaluation: Phase 0 grounding, then drive Phases 1→4. */
export async function runCouncil(concept: string, deps: OrchestratorDeps): Promise<Run> {
  const tier: ModelTier = deps.modelTier ?? 'tiered';
  const now = deps.now ?? (() => new Date());
  const createdAt = now().toISOString();

  const run: Run = {
    id: `${slugify(concept)}-${createdAt}`,
    concept,
    createdAt,
    phase: 0,
    stateDocument: null,
    transcript: [],
    flags: [],
    objectionLedger: [],
    conflictMap: [],
    verdict: null,
    cost: emptyLedger(),
    modelTier: tier,
  };

  const emit = (e: OrchestratorEvent): void => deps.onEvent?.(e);
  emit({ type: 'phase:start', phase: 0, round: null });
  const research = await runPhase0(concept, deps, emit, (ledger) => {
    run.cost = {
      inputTokens: run.cost.inputTokens + ledger.inputTokens,
      outputTokens: run.cost.outputTokens + ledger.outputTokens,
      cachedTokens: run.cost.cachedTokens + ledger.cachedTokens,
      usd: run.cost.usd + ledger.usd,
    };
    emit({ type: 'cost:update', cost: run.cost });
  });
  run.stateDocument = research.stateDocument;
  await deps.onTurnEnd?.(run);

  return drive(
    run,
    { stateMarkdown: research.stateMarkdown, payloadJson: JSON.stringify(research.payload) },
    1,
    deps,
  );
}

/**
 * Resume an interrupted run from its saved phase. Re-grounds (Phase 0) only if
 * the run never produced a State Document; otherwise re-derives the grounding
 * context from the saved State Document and continues from `run.phase`.
 */
export async function resumeCouncil(run: Run, deps: OrchestratorDeps): Promise<Run> {
  if (run.stateDocument === null || run.phase === 0) {
    const emit = (e: OrchestratorEvent): void => deps.onEvent?.(e);
    emit({ type: 'phase:start', phase: 0, round: null });
    const research = await runPhase0(run.concept, deps, emit, (ledger) => {
      run.cost = {
        inputTokens: run.cost.inputTokens + ledger.inputTokens,
        outputTokens: run.cost.outputTokens + ledger.outputTokens,
        cachedTokens: run.cost.cachedTokens + ledger.cachedTokens,
        usd: run.cost.usd + ledger.usd,
      };
    });
    run.stateDocument = research.stateDocument;
    return drive(
      run,
      { stateMarkdown: research.stateMarkdown, payloadJson: JSON.stringify(research.payload) },
      1,
      deps,
    );
  }
  return drive(run, preparedFromRun(run), run.phase, deps);
}

/** Re-derive the grounding context from a saved run's State Document. */
function preparedFromRun(run: Run): Prepared {
  const doc = run.stateDocument!;
  return { stateMarkdown: renderStateDocument(doc), payloadJson: JSON.stringify(doc) };
}

/**
 * Pivot Protocol: halt, re-run the Researcher with a stated change, log the
 * [MEMORY_OVERWRITE] diff against the prior State Document, reset the debate,
 * and resume from Phase 1.
 */
export async function pivotCouncil(run: Run, change: string, deps: OrchestratorDeps): Promise<Run> {
  const now = deps.now ?? (() => new Date());
  const emit = (e: OrchestratorEvent): void => deps.onEvent?.(e);
  emit({ type: 'phase:start', phase: 0, round: null });

  const oldDoc = run.stateDocument;
  const research = await runPhase0(`${run.concept}\n\n[PIVOT] ${change}`, deps, emit, (ledger) => {
    run.cost = {
      inputTokens: run.cost.inputTokens + ledger.inputTokens,
      outputTokens: run.cost.outputTokens + ledger.outputTokens,
      cachedTokens: run.cost.cachedTokens + ledger.cachedTokens,
      usd: run.cost.usd + ledger.usd,
    };
  });

  const newDoc = research.stateDocument;
  if (oldDoc) {
    const overwrites = computeOverwrites(oldDoc, newDoc, `pivot: ${change}`, now().toISOString());
    newDoc.overwriteLog = [...oldDoc.overwriteLog, ...overwrites];
  }

  // Reset the debate; keep id, concept, cost, and the overwrite history.
  run.stateDocument = newDoc;
  run.transcript = [];
  run.flags = [];
  run.objectionLedger = [];
  run.conflictMap = [];
  run.verdict = null;
  run.phase = 1;
  await deps.onTurnEnd?.(run);

  return drive(
    run,
    { stateMarkdown: research.stateMarkdown, payloadJson: JSON.stringify(newDoc) },
    1,
    deps,
  );
}

/** De-duplicate while preserving order; later objections supersede on exact match. */
function mergeObjections(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map((o) => o.toLowerCase().trim()));
  const out = [...existing];
  for (const o of incoming) {
    const key = o.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(o);
    }
  }
  return out;
}

async function runPhase0(
  concept: string,
  deps: OrchestratorDeps,
  emit: (e: OrchestratorEvent) => void,
  addLedger: (ledger: CostLedger) => void,
): Promise<ResearcherResult> {
  const maxAttempts = deps.maxResearchAttempts ?? 3;
  let missing: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const research = await deps.research(concept, attempt, missing);
    addLedger(research.usage);
    const integrity = checkIntegrity(research.stateDocument);
    emit({ type: 'integrity', ok: integrity.ok, missing: integrity.missing, attempt });
    if (integrity.ok) return research;
    missing = integrity.missing;
  }
  throw new OrchestratorError(
    `Phase 0 integrity gate failed after ${maxAttempts} attempts; missing: ${missing.join(', ')}`,
  );
}
