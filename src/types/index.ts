/**
 * Shared in-memory + on-disk contracts for a council run (blueprint §4).
 * The Researcher output additionally has a Zod schema in src/researcher/schema.ts;
 * the StateDocument type here is kept in sync with that schema.
 */

import type { ModelId } from '@/config/models';

// ── Personas & phases ────────────────────────────────────────────────────────

export type PersonaId =
  | 'decider'
  | 'businessMan'
  | 'marketingMan'
  | 'financialMan'
  | 'informatic'
  | 'client'
  | 'ethicist'
  | 'researcher';

export type Phase = 0 | 1 | 2 | 3 | 4;

// ── State Document (mirrors System Prompt §2; both state.md and payload.json) ──

export type Confidence = 'high' | 'medium' | 'low';

export interface Competitor {
  name: string;
  stage: string;
  totalFundingUsd: number | null;
  coreDifferentiator: string;
  githubStars: number | null;
  lastCommitDaysAgo: number | null;
  recentSignal: string;
  confidence: Confidence;
}

export interface OssAlt {
  project: string;
  stars: number | null;
  lastCommitDaysAgo: number | null;
  maturityLevel: string;
  /** 1–5. */
  displacementRiskScore: number;
}

export interface MarketFigure {
  figure: string;
  source: string;
  year: number | null;
}

export interface MarketSizing {
  tam: MarketFigure;
  sam: MarketFigure;
  somYear1: MarketFigure;
}

export interface Benchmark {
  metric: string;
  latency: string | null;
  computeCostPerUnit: string | null;
  uptimeSla: string | null;
}

export interface RegItem {
  framework: string;
  enforcementPrecedent: string;
}

export interface TalentItem {
  role: string;
  supplyDemand: string;
  notableMovement: string;
}

export interface OverwriteEntry {
  field: string;
  reason: string;
  oldValue: string;
  newValue: string;
  timestamp: string;
}

export interface StateDocument {
  conceptSummary: string;
  /** ISO timestamp; appears in the state.md header. */
  timestamp: string;
  competitorMatrix: Competitor[];
  openSourceAlternatives: OssAlt[];
  marketSizing: MarketSizing;
  technicalInfraBenchmarks: Benchmark[];
  regulatoryLandscape: RegItem[];
  talentSignal: TalentItem[];
  /** [MEMORY_OVERWRITE] events accumulated across (re)grounding. */
  overwriteLog: OverwriteEntry[];
}

// ── Flags ────────────────────────────────────────────────────────────────────

export type FlagType = 'UNSUPPORTED_CLAIM' | 'PERSONA_BREACH' | 'CIRCULAR_REASONING';

export interface Flag {
  type: FlagType;
  personaId: PersonaId;
  /** What triggered it; for unsupported claims, the offending claim text. */
  detail: string;
  /** True if the agent sourced or retracted on re-submission. */
  resolved: boolean;
}

// ── Turns ────────────────────────────────────────────────────────────────────

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usd: number;
}

export interface Turn {
  phase: Phase;
  /** Phase 2 only; otherwise null. */
  round: number | null;
  personaId: PersonaId;
  content: string;
  /** Flags raised against this turn. */
  flags: Flag[];
  /** True if this is a post-flag re-submission. */
  resubmission: boolean;
  usage: TurnUsage;
}

// ── Phase 1 output ───────────────────────────────────────────────────────────

export interface Conflict {
  description: string;
  betweenPersonas: PersonaId[];
}

// ── Verdict (Phase 4) ────────────────────────────────────────────────────────

export type EvidenceTag = 'SUPPORTED' | 'UNSUPPORTED' | 'CONTESTED';

export interface EvidenceItem {
  claim: string;
  tag: EvidenceTag;
}

export interface ConflictResolution {
  conflict: string;
  favoredPersona: PersonaId;
  rationale: string;
}

export interface DimensionScore {
  dimension: string;
  /** Each dimension weighted 20%. */
  weight: number;
  /** 0–100. */
  score: number;
  /** ≥2 cited quotes from the proceedings. */
  citedQuotes: string[];
}

export type Decision = 'GO' | 'NO_GO' | 'CONDITIONAL_GO';

export interface Verdict {
  evidenceSynthesis: EvidenceItem[];
  conflictResolutions: ConflictResolution[];
  /** 5 dimensions, 20% each. */
  scoreMatrix: DimensionScore[];
  decision: Decision;
  /** If CONDITIONAL_GO: measurable milestones. */
  conditions: string[];
  /** If NO_GO: primary kill + which agent established it. */
  killCondition: string | null;
  /** Leftover ledger items = automatic risk flags. */
  unresolvedObjections: string[];
  /** One sentence, specific, actionable. */
  nextAction: string;
}

// ── Cost ledger ──────────────────────────────────────────────────────────────

export interface CostLedger {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usd: number;
}

// ── Run (in-memory state, mirrored to run.json) ──────────────────────────────

export interface Run {
  /** `<concept-slug>-<ISO-timestamp>`. */
  id: string;
  concept: string;
  createdAt: string;
  /** Current phase pointer (for resume). */
  phase: Phase;
  stateDocument: StateDocument | null;
  transcript: Turn[];
  flags: Flag[];
  /** The Client's running unresolved concerns. */
  objectionLedger: string[];
  conflictMap: Conflict[];
  verdict: Verdict | null;
  cost: CostLedger;
  /** Model routing chosen for this run. */
  modelTier: 'tiered' | 'all-opus' | 'all-sonnet';
}

/** Re-export so callers can keep a single import site for the model union. */
export type { ModelId };
