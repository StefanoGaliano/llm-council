/**
 * Token accounting → USD, including the prompt-cache discount.
 * Pricing + multipliers come from src/config/models.ts (single source of truth).
 */

import { PRICING, CACHE_MULTIPLIERS, type ModelId } from '@/config/models';
import type { CostLedger, TurnUsage } from '@/types';

/** Raw token breakdown as reported by the Anthropic `usage` object. */
export interface RawUsage {
  /** Uncached input tokens (full price). */
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to cache this request (~1.25x input price). */
  cacheCreationInputTokens: number;
  /** Tokens served from cache this request (~0.1x input price). */
  cacheReadInputTokens: number;
}

/** Normalize a partial/loose usage object (SDK fields may be null/absent). */
export function normalizeUsage(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): RawUsage {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
  };
}

/** Compute the USD cost of one request's usage on a given model. */
export function costUsd(model: ModelId, usage: RawUsage): number {
  const pricing = PRICING[model];
  const inRate = pricing.inputPerMtok / 1_000_000;
  const outRate = pricing.outputPerMtok / 1_000_000;
  return (
    usage.inputTokens * inRate +
    usage.cacheReadInputTokens * inRate * CACHE_MULTIPLIERS.read +
    usage.cacheCreationInputTokens * inRate * CACHE_MULTIPLIERS.write5m +
    usage.outputTokens * outRate
  );
}

/** Convert raw usage into the per-turn shape stored on a Turn (blueprint §4). */
export function toTurnUsage(model: ModelId, usage: RawUsage): TurnUsage {
  return {
    // Display input = uncached + cache-writes (both billed near full rate).
    inputTokens: usage.inputTokens + usage.cacheCreationInputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cacheReadInputTokens,
    usd: costUsd(model, usage),
  };
}

export function emptyLedger(): CostLedger {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 };
}

/** Accumulate a turn's usage into a running cost ledger (returns a new ledger). */
export function addToLedger(ledger: CostLedger, turn: TurnUsage): CostLedger {
  return {
    inputTokens: ledger.inputTokens + turn.inputTokens,
    outputTokens: ledger.outputTokens + turn.outputTokens,
    cachedTokens: ledger.cachedTokens + turn.cachedTokens,
    usd: ledger.usd + turn.usd,
  };
}
