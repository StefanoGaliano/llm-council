/**
 * Per-round Phase 2 artifacts:
 *  - Claim Scorecard: the claims a round produced, each tagged SUPPORTED /
 *    CONTESTED / UNSUPPORTED against the State Document payload.
 *  - Objection Ledger extraction: the Client's running unresolved concerns.
 * Both are Opus structured tool-calls (orchestrator-level synthesis).
 */

import type { LlmClient, ToolDef } from '@/llm/client';
import { modelForRole, type ModelTier } from '@/config/models';
import type { Turn, TurnUsage } from '@/types';
import { renderTranscript } from '@/orchestrator/transcript';

export type ClaimStatus = 'SUPPORTED' | 'CONTESTED' | 'UNSUPPORTED';

export interface ScoredClaim {
  claim: string;
  status: ClaimStatus;
}

export interface ClaimScorecard {
  round: number;
  claims: ScoredClaim[];
}

const CLAIM_STATUSES: readonly ClaimStatus[] = ['SUPPORTED', 'CONTESTED', 'UNSUPPORTED'];

const SCORECARD_TOOL: ToolDef = {
  name: 'build_scorecard',
  description: 'Emit the claims made this round, each tagged against the State Document.',
  input_schema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string' },
            status: { type: 'string', enum: [...CLAIM_STATUSES] },
          },
          required: ['claim', 'status'],
        },
      },
    },
    required: ['claims'],
  },
};

const SCORECARD_SYSTEM = `You are the Master Orchestrator building a Claim Scorecard for one debate round. Extract the material claims made this round. Tag each: SUPPORTED if it traces to the State Document payload, CONTESTED if challenged or disputed in the round, UNSUPPORTED if it cites no grounding. Return ONLY the build_scorecard tool output.`;

const OBJECTIONS_TOOL: ToolDef = {
  name: 'extract_objections',
  description: "Emit the Client's currently unresolved objections after this round.",
  input_schema: {
    type: 'object',
    properties: {
      objections: { type: 'array', items: { type: 'string' } },
    },
    required: ['objections'],
  },
};

const OBJECTIONS_SYSTEM = `You are the Master Orchestrator maintaining the Client's Objection Ledger. From the round's proceedings, emit the Client's concerns that remain UNRESOLVED. Each objection is one concise line. Return ONLY the extract_objections tool output.`;

export interface ScorecardDeps {
  llm: LlmClient;
  modelTier: ModelTier;
}

export interface ScorecardResult {
  scorecard: ClaimScorecard;
  usage: TurnUsage;
}

export interface ObjectionsResult {
  objections: string[];
  usage: TurnUsage;
}

function parseClaims(input: unknown): ScoredClaim[] {
  if (!input || typeof input !== 'object' || !('claims' in input)) return [];
  const arr = (input as { claims: unknown }).claims;
  if (!Array.isArray(arr)) return [];
  const out: ScoredClaim[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { claim?: unknown; status?: unknown };
    if (typeof r.claim !== 'string' || !r.claim.trim()) continue;
    const status =
      typeof r.status === 'string' && CLAIM_STATUSES.includes(r.status as ClaimStatus)
        ? (r.status as ClaimStatus)
        : 'UNSUPPORTED';
    out.push({ claim: r.claim, status });
  }
  return out;
}

function parseObjections(input: unknown): string[] {
  if (!input || typeof input !== 'object' || !('objections' in input)) return [];
  const arr = (input as { objections: unknown }).objections;
  if (!Array.isArray(arr)) return [];
  return arr.filter((o): o is string => typeof o === 'string' && o.trim().length > 0);
}

/** Build the Claim Scorecard for a Phase 2 round. */
export async function buildScorecard(
  round: number,
  roundTurns: Turn[],
  payloadJson: string,
  deps: ScorecardDeps,
): Promise<ScorecardResult> {
  const model = modelForRole('orchestratorCheck', deps.modelTier);
  const result = await deps.llm.complete({
    model,
    system: SCORECARD_SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `## State Document payload (JSON)\n${payloadJson}\n\n` +
          `## Round ${round} proceedings\n\n${renderTranscript(roundTurns)}\n\n` +
          `Build the Claim Scorecard.`,
      },
    ],
    tools: [SCORECARD_TOOL],
    toolChoice: { type: 'tool', name: 'build_scorecard' },
  });
  const toolUse = result.toolUse.find((t) => t.name === 'build_scorecard');
  return {
    scorecard: { round, claims: toolUse ? parseClaims(toolUse.input) : [] },
    usage: result.usage,
  };
}

/** Extract the Client's still-unresolved objections after a round. */
export async function extractObjections(
  roundTurns: Turn[],
  deps: ScorecardDeps,
): Promise<ObjectionsResult> {
  const model = modelForRole('orchestratorCheck', deps.modelTier);
  const result = await deps.llm.complete({
    model,
    system: OBJECTIONS_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `## Round proceedings\n\n${renderTranscript(roundTurns)}\n\nExtract the unresolved objections.`,
      },
    ],
    tools: [OBJECTIONS_TOOL],
    toolChoice: { type: 'tool', name: 'extract_objections' },
  });
  const toolUse = result.toolUse.find((t) => t.name === 'extract_objections');
  return { objections: toolUse ? parseObjections(toolUse.input) : [], usage: result.usage };
}
