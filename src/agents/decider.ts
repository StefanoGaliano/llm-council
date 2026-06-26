/**
 * The Decider (Phase 4). The silent Bayesian synthesis agent: consumes the full
 * transcript + Objection Ledger + Conflict Map and produces a structured Verdict
 * — evidence tags, conflict resolutions, a weighted 5×20% score matrix (each
 * score citing ≥2 proceeding quotes), the GO/NO_GO/CONDITIONAL_GO decision,
 * conditions/kill-condition, unresolved objections, and a one-sentence next
 * action. Opus, forced tool-call, validated against the Verdict type (Zod).
 */

import { z } from 'zod';
import type { LlmClient, ToolDef } from '@/llm/client';
import { modelForRole, type ModelTier } from '@/config/models';
import type { TurnUsage, Verdict } from '@/types';
import { PERSONAS } from '@/agents/registry';
import { decider as deciderConstitution } from '@/agents/constitutions/decider';
import { renderTranscript } from '@/orchestrator/transcript';
import type { DeciderInput, DeciderOutput } from '@/orchestrator/orchestrator';

export class DeciderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeciderError';
  }
}

const PERSONA_IDS = [
  'decider',
  'businessMan',
  'marketingMan',
  'financialMan',
  'informatic',
  'client',
  'ethicist',
  'researcher',
] as const;

const verdictSchema = z
  .object({
    evidenceSynthesis: z.array(
      z.object({
        claim: z.string(),
        tag: z.enum(['SUPPORTED', 'UNSUPPORTED', 'CONTESTED']),
      }),
    ),
    conflictResolutions: z.array(
      z.object({
        conflict: z.string(),
        favoredPersona: z.enum(PERSONA_IDS),
        rationale: z.string(),
      }),
    ),
    scoreMatrix: z
      .array(
        z.object({
          dimension: z.string(),
          weight: z.number(),
          score: z.number().min(0).max(100),
          citedQuotes: z.array(z.string()).min(2),
        }),
      )
      .min(5)
      .max(5),
    decision: z.enum(['GO', 'NO_GO', 'CONDITIONAL_GO']),
    conditions: z.array(z.string()),
    killCondition: z.string().nullable(),
    unresolvedObjections: z.array(z.string()),
    nextAction: z.string(),
  })
  .strict();

const DELIVER_VERDICT_TOOL: ToolDef = {
  name: 'deliver_verdict',
  description: 'Deliver the final structured verdict for the concept under evaluation.',
  input_schema: {
    type: 'object',
    properties: {
      evidenceSynthesis: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claim: { type: 'string' },
            tag: { type: 'string', enum: ['SUPPORTED', 'UNSUPPORTED', 'CONTESTED'] },
          },
          required: ['claim', 'tag'],
        },
      },
      conflictResolutions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            conflict: { type: 'string' },
            favoredPersona: { type: 'string', enum: [...PERSONA_IDS] },
            rationale: { type: 'string' },
          },
          required: ['conflict', 'favoredPersona', 'rationale'],
        },
      },
      scoreMatrix: {
        type: 'array',
        description: 'Exactly 5 dimensions, each weight 20, score 0–100, with ≥2 cited quotes.',
        items: {
          type: 'object',
          properties: {
            dimension: { type: 'string' },
            weight: { type: 'number' },
            score: { type: 'number' },
            citedQuotes: { type: 'array', items: { type: 'string' } },
          },
          required: ['dimension', 'weight', 'score', 'citedQuotes'],
        },
      },
      decision: { type: 'string', enum: ['GO', 'NO_GO', 'CONDITIONAL_GO'] },
      conditions: { type: 'array', items: { type: 'string' } },
      killCondition: { type: ['string', 'null'] },
      unresolvedObjections: { type: 'array', items: { type: 'string' } },
      nextAction: { type: 'string' },
    },
    required: [
      'evidenceSynthesis',
      'conflictResolutions',
      'scoreMatrix',
      'decision',
      'conditions',
      'killCondition',
      'unresolvedObjections',
      'nextAction',
    ],
  },
};

const SYSTEM = `${deciderConstitution}

You are now in Phase 4. Synthesize the ENTIRE proceeding into the deliver_verdict tool call ONLY — no prose.
- Tag claims [SUPPORTED]/[UNSUPPORTED]/[CONTESTED] traceable to the State Document and debate.
- Resolve each Conflict Map item, naming the favored persona and rationale.
- Score EXACTLY 5 dimensions (weight 20 each, score 0–100); every dimension cites ≥2 verbatim quotes from the proceedings.
- Decide GO / NO_GO / CONDITIONAL_GO. If CONDITIONAL_GO give measurable conditions; if NO_GO give the primary killCondition naming the agent who established it.
- Carry every unresolved Objection Ledger item into unresolvedObjections, and give one specific, actionable nextAction.
- No quality adjectives. No entity or figure absent from the State Document or the debate.`;

export interface DeciderDeps {
  llm: LlmClient;
  modelTier: ModelTier;
  /** Corrective retries on schema-invalid verdicts (default 1). */
  maxRetries?: number;
}

function buildUserContent(input: DeciderInput, correction?: string): string {
  const { run, payloadJson } = input;
  const conflicts =
    run.conflictMap.length > 0
      ? run.conflictMap
          .map(
            (c, i) =>
              `${i + 1}. ${c.description} (between ${c.betweenPersonas.join(', ') || 'unspecified'})`,
          )
          .join('\n')
      : '(none recorded)';
  const ledger =
    run.objectionLedger.length > 0
      ? run.objectionLedger.map((o) => `- ${o}`).join('\n')
      : '(none recorded)';

  return (
    `## Concept\n${run.concept}\n\n` +
    `## State Document payload (JSON — the grounding source of truth)\n${payloadJson}\n\n` +
    `## Conflict Map\n${conflicts}\n\n` +
    `## Objection Ledger (unresolved)\n${ledger}\n\n` +
    `## Full proceedings (Phases 1–3)\n\n${renderTranscript(run.transcript)}\n\n` +
    (correction
      ? `## Your previous verdict was invalid — fix and resubmit:\n${correction}\n\n`
      : '') +
    `Deliver the verdict.`
  );
}

/** Run the Phase 4 Decider synthesis. Validates the verdict; one corrective retry. */
export async function runDecider(input: DeciderInput, deps: DeciderDeps): Promise<DeciderOutput> {
  const model = modelForRole('decider', deps.modelTier);
  const maxRetries = deps.maxRetries ?? 1;
  const usages: TurnUsage[] = [];
  let correction: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await deps.llm.complete({
      model,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildUserContent(input, correction) }],
      tools: [DELIVER_VERDICT_TOOL],
      toolChoice: { type: 'tool', name: 'deliver_verdict' },
    });
    usages.push(result.usage);

    const toolUse = result.toolUse.find((t) => t.name === 'deliver_verdict');
    const parsed = verdictSchema.safeParse(toolUse?.input);
    if (parsed.success) {
      return { verdict: parsed.data as Verdict, usages };
    }
    correction = parsed.error.issues
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
  }

  throw new DeciderError(`Decider produced an invalid verdict after retry:\n${correction}`);
}

/** Bind the Decider into the orchestrator's `decide` dependency. */
export function makeDecider(deps: DeciderDeps): (input: DeciderInput) => Promise<DeciderOutput> {
  return (input) => runDecider(input, deps);
}

// Re-export the persona spec so callers have one import site if needed.
export const DECIDER_SPEC = PERSONAS.decider;
