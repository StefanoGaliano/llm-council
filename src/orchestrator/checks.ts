/**
 * The Orchestrator Check — the heart of the system. Runs on EVERY turn: an Opus
 * structured tool-call receives the agent's output, its role constitution, and
 * the full payload.json, and returns `{ flags: [...] }`. Detects:
 *   - UNSUPPORTED_CLAIM: a named company/stat/product/funding figure not in payload.json
 *   - PERSONA_BREACH:    a role-constitution violation (e.g. Decider speaks pre-Phase 4)
 *   - CIRCULAR_REASONING: an argument that restates its conclusion as its premise
 *
 * Also wires the one-retry re-submission contract (`checkAndResolve`).
 */

import type { LlmClient, ToolDef } from '@/llm/client';
import { modelForRole, type ModelTier } from '@/config/models';
import type { Flag, FlagType, PersonaId, Phase, Turn, TurnUsage } from '@/types';

const FLAG_TYPES: readonly FlagType[] = [
  'UNSUPPORTED_CLAIM',
  'PERSONA_BREACH',
  'CIRCULAR_REASONING',
];

const EMIT_FLAGS_TOOL: ToolDef = {
  name: 'emit_flags',
  description: 'Emit the flags (possibly none) raised against the agent turn under review.',
  input_schema: {
    type: 'object',
    properties: {
      flags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: [...FLAG_TYPES],
            },
            detail: { type: 'string' },
            quote: { type: 'string' },
          },
          required: ['type', 'detail'],
        },
      },
    },
    required: ['flags'],
  },
};

const SYSTEM = `You are the Master Orchestrator's integrity check. You review ONE agent turn and emit flags via the emit_flags tool. You return ONLY structured tool output — never prose.

Detection rules:
- UNSUPPORTED_CLAIM: the turn asserts a named company, product, statistic, market size, or funding figure that is NOT present in the State Document payload (provided as JSON). Quote the offending claim in "quote".
- PERSONA_BREACH: the turn violates the agent's role constitution (provided). Examples: the Decider speaking before Phase 4 or using a quality adjective; the Informatic, Business Man, Marketing Man, or Financial Man proposing a solution/fix/architecture; the Client proposing a build.
- CIRCULAR_REASONING: the turn's argument restates its own conclusion as its premise.

If the turn is clean, call emit_flags with an empty flags array. Be precise: do not flag grounded, in-role argument.`;

export interface CheckInput {
  personaId: PersonaId;
  phase: Phase;
  turnContent: string;
  /** The agent's role constitution. */
  constitution: string;
  /** Stringified payload.json (the grounding source of truth). */
  payloadJson: string;
}

export interface CheckDeps {
  llm: LlmClient;
  modelTier: ModelTier;
}

export interface CheckResult {
  flags: Flag[];
  usage: TurnUsage;
}

interface RawFlag {
  type?: unknown;
  detail?: unknown;
  quote?: unknown;
}

function parseFlags(input: unknown, personaId: PersonaId): Flag[] {
  if (!input || typeof input !== 'object' || !('flags' in input)) return [];
  const arr = (input as { flags: unknown }).flags;
  if (!Array.isArray(arr)) return [];
  const flags: Flag[] = [];
  for (const raw of arr as RawFlag[]) {
    const type = raw.type;
    if (typeof type !== 'string' || !FLAG_TYPES.includes(type as FlagType)) continue;
    const detail = typeof raw.detail === 'string' ? raw.detail : '';
    const quote = typeof raw.quote === 'string' && raw.quote ? ` — "${raw.quote}"` : '';
    flags.push({
      type: type as FlagType,
      personaId,
      detail: detail + quote,
      resolved: false,
    });
  }
  return flags;
}

/** Run the Orchestrator Check on a single turn. */
export async function runCheck(input: CheckInput, deps: CheckDeps): Promise<CheckResult> {
  const model = modelForRole('orchestratorCheck', deps.modelTier);
  const result = await deps.llm.complete({
    model,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `## Agent under review: ${input.personaId} (Phase ${input.phase})\n\n` +
          `## Role constitution\n${input.constitution}\n\n` +
          `## State Document payload (JSON — the ONLY allowed source of named facts)\n${input.payloadJson}\n\n` +
          `## The agent's turn\n${input.turnContent}\n\n` +
          `Review the turn and call emit_flags.`,
      },
    ],
    tools: [EMIT_FLAGS_TOOL],
    toolChoice: { type: 'tool', name: 'emit_flags' },
  });

  const toolUse = result.toolUse.find((t) => t.name === 'emit_flags');
  const flags = toolUse ? parseFlags(toolUse.input, input.personaId) : [];
  return { flags, usage: result.usage };
}

export interface ResolveDeps extends CheckDeps {
  /** Re-run the agent once with the flags appended ("source or retract"). */
  resubmit: (flags: Flag[]) => Promise<Turn>;
}

export interface ResolveResult {
  /** The turn that stands (original, or the re-submission if a retry happened). */
  turn: Turn;
  /** All check usages incurred (initial check + post-retry check). */
  usages: TurnUsage[];
}

/**
 * Check a turn; if flagged, allow exactly ONE re-submission, then re-check.
 * Flags that disappear on the re-check are marked resolved; the rest stand.
 * The returned turn carries its final flag list.
 */
export async function checkAndResolve(
  turn: Turn,
  base: Pick<CheckInput, 'constitution' | 'payloadJson'>,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const usages: TurnUsage[] = [];
  const first = await runCheck(
    { personaId: turn.personaId, phase: turn.phase, turnContent: turn.content, ...base },
    deps,
  );
  usages.push(first.usage);

  if (first.flags.length === 0) {
    return { turn: { ...turn, flags: [] }, usages };
  }

  // One re-submission with the flags appended.
  const resubmitted = await deps.resubmit(first.flags);
  const second = await runCheck(
    {
      personaId: resubmitted.personaId,
      phase: resubmitted.phase,
      turnContent: resubmitted.content,
      ...base,
    },
    deps,
  );
  usages.push(second.usage);

  // Resolved = a first-pass flag type no longer raised on the re-check.
  const stillRaised = new Set(second.flags.map((f) => f.type));
  const resolvedOriginals: Flag[] = first.flags.map((f) => ({
    ...f,
    resolved: !stillRaised.has(f.type),
  }));
  // Any genuinely new flags from the re-check stand unresolved.
  const firstTypes = new Set(first.flags.map((f) => f.type));
  const newUnresolved = second.flags.filter((f) => !firstTypes.has(f.type));

  const finalFlags = [...resolvedOriginals, ...newUnresolved];
  return { turn: { ...resubmitted, resubmission: true, flags: finalFlags }, usages };
}
