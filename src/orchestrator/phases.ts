/**
 * Deterministic phase + turn-order definitions for the 5-phase protocol.
 * The protocol is CODE: which persona speaks, in which phase/round, and what
 * they are asked, is fixed here — never delegated to the LLM. Only the content
 * of each turn and the flagging are model calls.
 *
 * Phase rules (blueprint §9 / CLAUDE.md):
 *  - Phase 0: Researcher grounding; integrity gate; repeat if incomplete.
 *  - Phase 1: Business Man → Informatic → Financial Man → Ethicist, then Conflict Map.
 *  - Phase 2: 3 rounds; Objection Ledger + Claim Scorecard per round.
 *             The Ethicist speaks ONLY in Round 2 (and Phase 3).
 *  - Phase 3: Feynman audit — re-explanation + Client gap determination.
 *  - Phase 4: Decider synthesis (Decider silent until Phase 4).
 */

import type { Phase, StateDocument } from '@/types';
import type { CouncilPersonaId } from '@/agents/registry';

export interface TurnSpec {
  phase: Phase;
  /** Phase 2 only; otherwise null. */
  round: number | null;
  personaId: CouncilPersonaId;
  /** The phase-specific ask injected into the persona prompt. */
  instruction: string;
}

// ── Phase 1: sequential opening assessments ──────────────────────────────────

const PHASE1_INSTRUCTIONS: Record<string, string> = {
  businessMan:
    'Phase 1 opening. State the core business thesis: who pays, the buying trigger, and the single biggest commercial risk. Ground every named figure in the State Document. Do NOT propose solutions or fixes — diagnose only.',
  informatic:
    'Assess technical feasibility and build complexity as ANALYSIS only. Name the single hardest technical constraint. Do NOT propose an architecture, stack, or solution.',
  financialMan:
    'Assess unit economics and capital requirements using only State Document figures. Name the dominant financial risk. Do NOT propose a business model fix.',
  ethicist:
    'Identify the most material regulatory, ethical, or compliance exposure, grounded in the regulatory landscape of the State Document.',
};

const PHASE1_ORDER: CouncilPersonaId[] = ['businessMan', 'informatic', 'financialMan', 'ethicist'];

export function phase1Turns(): TurnSpec[] {
  return PHASE1_ORDER.map((personaId) => ({
    phase: 1 as Phase,
    round: null,
    personaId,
    instruction: PHASE1_INSTRUCTIONS[personaId] ?? 'Give your in-role Phase 1 assessment.',
  }));
}

// ── Phase 2: three adversarial debate rounds ─────────────────────────────────

const PHASE2_BASE: CouncilPersonaId[] = [
  'businessMan',
  'marketingMan',
  'financialMan',
  'informatic',
  'client',
];

/** Per-round speaker list. The Ethicist joins ONLY in Round 2. */
function phase2Round(round: number): CouncilPersonaId[] {
  if (round === 2) {
    return ['businessMan', 'marketingMan', 'financialMan', 'informatic', 'ethicist', 'client'];
  }
  return PHASE2_BASE;
}

function phase2Instruction(personaId: CouncilPersonaId, round: number): string {
  if (personaId === 'client') {
    return `Round ${round}. As the prospective enterprise buyer, voice your single strongest objection to adopting this. Update your Objection Ledger and state which earlier concerns remain unresolved. Stay in role — you do not propose builds.`;
  }
  return `Round ${round} adversarial debate. Attack the weakest claim raised so far, or defend/concede a claim against you. Stay strictly in role; cite the State Document for any figure. Introduce no unsupported entities or numbers.`;
}

export function phase2Turns(round: number): TurnSpec[] {
  return phase2Round(round).map((personaId) => ({
    phase: 2 as Phase,
    round,
    personaId,
    instruction: phase2Instruction(personaId, round),
  }));
}

export const PHASE2_ROUNDS = 3;

// ── Phase 3: Feynman audit ───────────────────────────────────────────────────

const PHASE3_ORDER: CouncilPersonaId[] = ['informatic', 'ethicist', 'client'];

const PHASE3_INSTRUCTIONS: Record<string, string> = {
  informatic:
    'Feynman audit: re-explain the concept and its core mechanism in the simplest possible terms, as if to a non-expert buyer. Expose any part that cannot be explained simply. Analysis only — propose nothing.',
  ethicist:
    'Given the re-explanation, state whether any ethical or regulatory gap becomes clearer or is newly exposed.',
  client:
    'Determine the decisive insight or gap: would you buy? Name the single remaining gap that must close before you would, grounded in the proceedings.',
};

export function phase3Turns(): TurnSpec[] {
  return PHASE3_ORDER.map((personaId) => ({
    phase: 3 as Phase,
    round: null,
    personaId,
    instruction: PHASE3_INSTRUCTIONS[personaId] ?? 'Give your in-role Phase 3 contribution.',
  }));
}

// ── Phase 0 data-integrity gate ──────────────────────────────────────────────

export interface IntegrityResult {
  ok: boolean;
  /** Field paths that are missing/empty; fed back to the Researcher to re-ground. */
  missing: string[];
}

/**
 * Deterministic completeness check for the State Document. The debate never
 * starts on incomplete data (non-negotiable rule #4); the orchestrator repeats
 * Phase 0 with `missing` as guidance until this passes or attempts run out.
 */
export function checkIntegrity(doc: StateDocument): IntegrityResult {
  const missing: string[] = [];
  if (!doc.conceptSummary.trim()) missing.push('conceptSummary');
  if (doc.competitorMatrix.length === 0) missing.push('competitorMatrix');
  if (!doc.marketSizing.tam.figure.trim()) missing.push('marketSizing.tam');
  if (!doc.marketSizing.sam.figure.trim()) missing.push('marketSizing.sam');
  if (!doc.marketSizing.somYear1.figure.trim()) missing.push('marketSizing.somYear1');
  return { ok: missing.length === 0, missing };
}
