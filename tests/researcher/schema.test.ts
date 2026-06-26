import { describe, it, expect } from 'vitest';
import { validateStateDocument, stateDocumentSchema } from '@/researcher/schema';
import { canonicalPayload } from '../helpers/fixtures';

describe('stateDocumentSchema', () => {
  it('accepts the canonical payload', () => {
    const result = validateStateDocument(canonicalPayload);
    expect(result.ok).toBe(true);
  });

  it('defaults confidence to "low" on degraded competitor entries', () => {
    const parsed = stateDocumentSchema.parse({
      conceptSummary: 'x',
      timestamp: 't',
      competitorMatrix: [{ name: 'Acme', displacementRiskScore: 1 }],
      marketSizing: {
        tam: { figure: '$1B' },
        sam: { figure: '$1B' },
        somYear1: { figure: '$1M' },
      },
    });
    expect(parsed.competitorMatrix[0]?.confidence).toBe('low');
    expect(parsed.competitorMatrix[0]?.totalFundingUsd).toBeNull();
  });

  it('rejects a malformed payload (missing conceptSummary) with readable error text', () => {
    const result = validateStateDocument({ timestamp: 't', marketSizing: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorText).toContain('conceptSummary');
    }
  });

  it('rejects an out-of-range displacement risk score', () => {
    const result = validateStateDocument({
      ...canonicalPayload,
      openSourceAlternatives: [{ project: 'x', displacementRiskScore: 9 }],
    });
    expect(result.ok).toBe(false);
  });
});
