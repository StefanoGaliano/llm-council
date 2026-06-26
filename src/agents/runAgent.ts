/**
 * Generic persona runner. Assembles the system prompt (constitution, cached) +
 * user prompt (State Document cached + the transcript slice the persona is
 * allowed to see + the phase-specific instruction), calls the model, and
 * returns a finalized Turn. The Orchestrator Check (Step 8) decides flags;
 * this runner sets `flags: []` and the orchestrator fills them in.
 */

import type { LlmClient, MessageParam, TextBlockParam } from '@/llm/client';
import { modelForRole, type ModelTier } from '@/config/models';
import type { Flag, Phase, Turn } from '@/types';
import { getPersona, type CouncilPersonaId } from '@/agents/registry';
import { buildCanaryDirective, type CanaryOptions } from '@/util/canary';

export interface AgentContext {
  phase: Phase;
  round: number | null;
  /** Rendered state.md — the single source of truth, injected + cached. */
  stateMarkdown: string;
  /** Pre-rendered transcript the persona is allowed to see (may be empty). */
  transcriptSlice: string;
  /** The phase-specific ask for this persona this turn. */
  instruction: string;
  /** When re-submitting after a flag, the flags to address ("source or retract"). */
  resubmissionFlags?: Flag[];
  /** Diagnostic: when set, ask the persona to emit a marker at a word cadence. */
  canary?: CanaryOptions;
}

export interface RunAgentDeps {
  llm: LlmClient;
  modelTier: ModelTier;
  maxTokens?: number;
}

function flagDirective(flags: Flag[]): string {
  const lines = flags.map((f) => `- [${f.type}] ${f.detail}`);
  return (
    `\n\n[ORCHESTRATOR FLAG] Your previous turn was flagged. Address each item by ` +
    `either SOURCING it to the State Document or RETRACTING it. Do not introduce new ` +
    `unsupported claims:\n${lines.join('\n')}`
  );
}

/** Run one persona turn and return a finalized Turn (flags filled by the orchestrator). */
export async function runAgent(
  personaId: CouncilPersonaId,
  ctx: AgentContext,
  deps: RunAgentDeps,
): Promise<Turn> {
  const persona = getPersona(personaId);
  const model = modelForRole(persona.modelRole, deps.modelTier);

  const system: TextBlockParam[] = [
    { type: 'text', text: persona.constitution, cache_control: { type: 'ephemeral' } },
  ];

  const resubmission = (ctx.resubmissionFlags?.length ?? 0) > 0;
  const instruction =
    ctx.instruction +
    (resubmission ? flagDirective(ctx.resubmissionFlags!) : '') +
    (ctx.canary ? buildCanaryDirective(ctx.canary) : '');

  const phaseHeader =
    ctx.round !== null ? `Phase ${ctx.phase}, Round ${ctx.round}` : `Phase ${ctx.phase}`;

  const userBlocks: TextBlockParam[] = [
    {
      type: 'text',
      text: `# State Document (the single source of truth — cite it; do not invent figures)\n\n${ctx.stateMarkdown}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text:
        (ctx.transcriptSlice ? `# Proceedings so far\n\n${ctx.transcriptSlice}\n\n` : '') +
        `# Your task (${phaseHeader})\n\n${instruction}`,
    },
  ];

  const messages: MessageParam[] = [{ role: 'user', content: userBlocks }];

  const result = await deps.llm.complete({
    model,
    system,
    messages,
    ...(deps.maxTokens !== undefined ? { maxTokens: deps.maxTokens } : {}),
  });

  return {
    phase: ctx.phase,
    round: ctx.round,
    personaId: persona.id,
    content: result.text,
    flags: [],
    resubmission,
    usage: result.usage,
  };
}
