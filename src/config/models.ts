/**
 * Pinned Claude model IDs + pricing. This is the ONLY place model strings live.
 * Never hardcode a model ID elsewhere; never invent IDs. To bump a model, edit here.
 *
 * Pricing is USD per 1M tokens (verified via the /claude-api skill, 2026-06-25):
 *   - Opus 4.8 (claude-opus-4-8): $5 input / $25 output, 1M context
 *   - Sonnet 4.6 (claude-sonnet-4-6): $3 input / $15 output, 1M context
 * Prompt-cache multipliers (relative to base input price):
 *   - cache write (5-minute ephemeral): 1.25x
 *   - cache read: 0.10x
 */

export const MODEL_IDS = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
} as const;

export type ModelId = (typeof MODEL_IDS)[keyof typeof MODEL_IDS];

/** Prompt-cache price multipliers, applied to the base input rate. */
export const CACHE_MULTIPLIERS = {
  /** 5-minute ephemeral cache write. */
  write5m: 1.25,
  /** Cache read (any TTL). */
  read: 0.1,
} as const;

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMtok: number;
  /** USD per 1M output tokens. */
  outputPerMtok: number;
  /** Context window in tokens. */
  contextWindow: number;
}

export const PRICING: Record<ModelId, ModelPricing> = {
  [MODEL_IDS.opus]: { inputPerMtok: 5, outputPerMtok: 25, contextWindow: 1_000_000 },
  [MODEL_IDS.sonnet]: { inputPerMtok: 3, outputPerMtok: 15, contextWindow: 1_000_000 },
};

/** Per-role model routing. Overridable at runtime via `--model-tier`. */
export type ModelTier = 'tiered' | 'all-opus' | 'all-sonnet';

export type CouncilRole = 'persona' | 'researcher' | 'orchestratorCheck' | 'decider';

/**
 * Resolve which model a given role uses under a given tier.
 * Default (`tiered`): Sonnet for personas + Researcher; Opus for the
 * Orchestrator Check + Decider (the judgment-heavy roles).
 */
export function modelForRole(role: CouncilRole, tier: ModelTier = 'tiered'): ModelId {
  if (tier === 'all-opus') return MODEL_IDS.opus;
  if (tier === 'all-sonnet') return MODEL_IDS.sonnet;
  switch (role) {
    case 'orchestratorCheck':
    case 'decider':
      return MODEL_IDS.opus;
    case 'persona':
    case 'researcher':
      return MODEL_IDS.sonnet;
  }
}
