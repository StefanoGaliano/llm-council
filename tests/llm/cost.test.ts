import { describe, it, expect } from 'vitest';
import { MODEL_IDS } from '@/config/models';
import {
  costUsd,
  toTurnUsage,
  normalizeUsage,
  emptyLedger,
  addToLedger,
  type RawUsage,
} from '@/llm/cost';

const zero: RawUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

describe('costUsd', () => {
  it('prices uncached input + output at base rates (Sonnet $3/$15 per Mtok)', () => {
    // 1M input + 1M output = $3 + $15 = $18
    const usd = costUsd(MODEL_IDS.sonnet, {
      ...zero,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(18, 6);
  });

  it('prices Opus input + output ($5/$25 per Mtok)', () => {
    const usd = costUsd(MODEL_IDS.opus, {
      ...zero,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(30, 6);
  });

  it('applies the cache-read discount (0.1x input)', () => {
    // 1M cache-read on Sonnet = $3 * 0.1 = $0.30
    const usd = costUsd(MODEL_IDS.sonnet, { ...zero, cacheReadInputTokens: 1_000_000 });
    expect(usd).toBeCloseTo(0.3, 6);
  });

  it('applies the cache-write premium (1.25x input)', () => {
    // 1M cache-write on Sonnet = $3 * 1.25 = $3.75
    const usd = costUsd(MODEL_IDS.sonnet, { ...zero, cacheCreationInputTokens: 1_000_000 });
    expect(usd).toBeCloseTo(3.75, 6);
  });

  it('sums all four components', () => {
    const usd = costUsd(MODEL_IDS.opus, {
      inputTokens: 200_000, // $1.00
      outputTokens: 100_000, // $2.50
      cacheCreationInputTokens: 40_000, // 40k * 5/1e6 * 1.25 = $0.25
      cacheReadInputTokens: 1_000_000, // 1M * 5/1e6 * 0.1 = $0.50
    });
    expect(usd).toBeCloseTo(1.0 + 2.5 + 0.25 + 0.5, 6);
  });
});

describe('normalizeUsage', () => {
  it('defaults missing/null SDK fields to 0', () => {
    expect(normalizeUsage({ input_tokens: 5, cache_read_input_tokens: null })).toEqual({
      inputTokens: 5,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});

describe('toTurnUsage', () => {
  it('folds cache-writes into display input and exposes cache reads separately', () => {
    const turn = toTurnUsage(MODEL_IDS.sonnet, {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 30,
    });
    expect(turn.inputTokens).toBe(110);
    expect(turn.cachedTokens).toBe(30);
    expect(turn.outputTokens).toBe(50);
    expect(turn.usd).toBeGreaterThan(0);
  });
});

describe('ledger accumulation', () => {
  it('starts empty and accumulates turns', () => {
    let ledger = emptyLedger();
    ledger = addToLedger(ledger, {
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 5,
      usd: 0.01,
    });
    ledger = addToLedger(ledger, {
      inputTokens: 200,
      outputTokens: 40,
      cachedTokens: 10,
      usd: 0.02,
    });
    expect(ledger).toEqual({ inputTokens: 300, outputTokens: 60, cachedTokens: 15, usd: 0.03 });
  });
});
