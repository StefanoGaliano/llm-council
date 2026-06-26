/**
 * Shared test fixtures: a canonical Researcher payload + State Document.
 */

import type { StateDocument } from '@/types';

/** A minimal-but-complete payload that passes stateDocumentSchema. */
export const canonicalPayload = {
  conceptSummary: 'An AI tool that auto-generates SOC2 evidence for B2B SaaS startups.',
  timestamp: '2026-06-25T12:00:00.000Z',
  competitorMatrix: [
    {
      name: 'Vanta',
      stage: 'Series B',
      totalFundingUsd: 200_000_000,
      coreDifferentiator: 'Automated compliance monitoring',
      githubStars: null,
      lastCommitDaysAgo: null,
      recentSignal: 'Expanded into ISO 27001',
      confidence: 'medium',
    },
  ],
  openSourceAlternatives: [
    {
      project: 'comply',
      stars: 900,
      lastCommitDaysAgo: 400,
      maturityLevel: 'stale',
      displacementRiskScore: 2,
    },
  ],
  marketSizing: {
    tam: { figure: '$10B', source: 'Gartner', year: 2025 },
    sam: { figure: '$2B', source: 'web-search-derived', year: 2025 },
    somYear1: { figure: '$5M', source: 'web-search-derived', year: 2026 },
  },
  technicalInfraBenchmarks: [
    { metric: 'evidence sync', latency: '2s', computeCostPerUnit: '$0.01', uptimeSla: '99.9%' },
  ],
  regulatoryLandscape: [
    { framework: 'SOC2 Type II', enforcementPrecedent: 'AICPA audit requirements' },
  ],
  talentSignal: [{ role: 'Compliance engineer', supplyDemand: 'scarce', notableMovement: '—' }],
  overwriteLog: [],
} as const;

export function makeStateDocument(overrides: Partial<StateDocument> = {}): StateDocument {
  return {
    conceptSummary: canonicalPayload.conceptSummary,
    timestamp: canonicalPayload.timestamp,
    competitorMatrix: [...canonicalPayload.competitorMatrix],
    openSourceAlternatives: [...canonicalPayload.openSourceAlternatives],
    marketSizing: canonicalPayload.marketSizing,
    technicalInfraBenchmarks: [...canonicalPayload.technicalInfraBenchmarks],
    regulatoryLandscape: [...canonicalPayload.regulatoryLandscape],
    talentSignal: [...canonicalPayload.talentSignal],
    overwriteLog: [],
    ...overrides,
  } as StateDocument;
}
