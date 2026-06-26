/**
 * Phase 1 Conflict Map builder. After the four opening assessments, an Opus
 * structured tool-call surfaces the substantive disagreements between personas.
 * The result feeds Phase 2 (the debate) and the Decider's conflict resolutions.
 */

import type { LlmClient, ToolDef } from '@/llm/client';
import { modelForRole, type ModelTier } from '@/config/models';
import type { Conflict, PersonaId, Turn, TurnUsage } from '@/types';
import { renderTranscript } from '@/orchestrator/transcript';

const VALID_PERSONAS: readonly PersonaId[] = [
  'decider',
  'businessMan',
  'marketingMan',
  'financialMan',
  'informatic',
  'client',
  'ethicist',
  'researcher',
];

const TOOL: ToolDef = {
  name: 'build_conflict_map',
  description: 'Emit the substantive conflicts between Council personas surfaced in Phase 1.',
  input_schema: {
    type: 'object',
    properties: {
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            betweenPersonas: { type: 'array', items: { type: 'string' } },
          },
          required: ['description', 'betweenPersonas'],
        },
      },
    },
    required: ['conflicts'],
  },
};

const SYSTEM = `You are the Master Orchestrator building the Phase 1 Conflict Map. From the four opening assessments, identify the genuine, substantive disagreements (not stylistic differences) between personas. For each, give a one-line description and the personas in tension. Return ONLY the build_conflict_map tool output.`;

export interface ConflictMapDeps {
  llm: LlmClient;
  modelTier: ModelTier;
}

export interface ConflictMapResult {
  conflicts: Conflict[];
  usage: TurnUsage;
}

interface RawConflict {
  description?: unknown;
  betweenPersonas?: unknown;
}

function parseConflicts(input: unknown): Conflict[] {
  if (!input || typeof input !== 'object' || !('conflicts' in input)) return [];
  const arr = (input as { conflicts: unknown }).conflicts;
  if (!Array.isArray(arr)) return [];
  const out: Conflict[] = [];
  for (const raw of arr as RawConflict[]) {
    if (typeof raw.description !== 'string' || !raw.description.trim()) continue;
    const personas = Array.isArray(raw.betweenPersonas)
      ? (raw.betweenPersonas.filter(
          (p): p is PersonaId => typeof p === 'string' && VALID_PERSONAS.includes(p as PersonaId),
        ) as PersonaId[])
      : [];
    out.push({ description: raw.description, betweenPersonas: personas });
  }
  return out;
}

/** Build the Phase 1 Conflict Map from the Phase 1 turns. */
export async function buildConflictMap(
  phase1Turns: Turn[],
  deps: ConflictMapDeps,
): Promise<ConflictMapResult> {
  const model = modelForRole('orchestratorCheck', deps.modelTier);
  const result = await deps.llm.complete({
    model,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `## Phase 1 assessments\n\n${renderTranscript(phase1Turns)}\n\nBuild the Conflict Map.`,
      },
    ],
    tools: [TOOL],
    toolChoice: { type: 'tool', name: 'build_conflict_map' },
  });

  const toolUse = result.toolUse.find((t) => t.name === 'build_conflict_map');
  return { conflicts: toolUse ? parseConflicts(toolUse.input) : [], usage: result.usage };
}
