import { describe, it, expect } from 'vitest';
import { MODEL_IDS, PRICING, modelForRole } from '@/config/models';

describe('model routing', () => {
  it('tiered: Opus for judgment roles, Sonnet for generation roles', () => {
    expect(modelForRole('orchestratorCheck')).toBe(MODEL_IDS.opus);
    expect(modelForRole('decider')).toBe(MODEL_IDS.opus);
    expect(modelForRole('persona')).toBe(MODEL_IDS.sonnet);
    expect(modelForRole('researcher')).toBe(MODEL_IDS.sonnet);
  });

  it('all-opus / all-sonnet override every role', () => {
    expect(modelForRole('persona', 'all-opus')).toBe(MODEL_IDS.opus);
    expect(modelForRole('decider', 'all-sonnet')).toBe(MODEL_IDS.sonnet);
  });

  it('has pricing for every pinned model id', () => {
    for (const id of Object.values(MODEL_IDS)) {
      expect(PRICING[id]).toBeDefined();
      expect(PRICING[id].inputPerMtok).toBeGreaterThan(0);
      expect(PRICING[id].outputPerMtok).toBeGreaterThan(0);
    }
  });
});
