/**
 * Zod schema for the Researcher's mandatory output JSON (System Prompt §2).
 * This is the single source of truth for the grounding payload: `payload.json`
 * is validated against it, and `state.md` is rendered from a validated value.
 *
 * `confidence` defaults to "low" on degraded fields (paid sources derived from
 * web search). `overwriteLog` accumulates [MEMORY_OVERWRITE] events across pivots.
 */

import { z } from 'zod';

export const confidenceSchema = z.enum(['high', 'medium', 'low']).default('low');

export const competitorSchema = z.object({
  name: z.string().min(1),
  stage: z.string().default('unknown'),
  totalFundingUsd: z.number().nullable().default(null),
  coreDifferentiator: z.string().default(''),
  githubStars: z.number().int().nullable().default(null),
  lastCommitDaysAgo: z.number().int().nullable().default(null),
  recentSignal: z.string().default(''),
  confidence: confidenceSchema,
});

export const ossAltSchema = z.object({
  project: z.string().min(1),
  stars: z.number().int().nullable().default(null),
  lastCommitDaysAgo: z.number().int().nullable().default(null),
  maturityLevel: z.string().default('unknown'),
  displacementRiskScore: z.number().int().min(1).max(5),
});

export const marketFigureSchema = z.object({
  figure: z.string().default('unknown'),
  source: z.string().default('web-search-derived'),
  year: z.number().int().nullable().default(null),
});

export const marketSizingSchema = z.object({
  tam: marketFigureSchema,
  sam: marketFigureSchema,
  somYear1: marketFigureSchema,
});

export const benchmarkSchema = z.object({
  metric: z.string().min(1),
  latency: z.string().nullable().default(null),
  computeCostPerUnit: z.string().nullable().default(null),
  uptimeSla: z.string().nullable().default(null),
});

export const regItemSchema = z.object({
  framework: z.string().min(1),
  enforcementPrecedent: z.string().default(''),
});

export const talentItemSchema = z.object({
  role: z.string().min(1),
  supplyDemand: z.string().default(''),
  notableMovement: z.string().default(''),
});

export const overwriteEntrySchema = z.object({
  field: z.string(),
  reason: z.string(),
  oldValue: z.string(),
  newValue: z.string(),
  timestamp: z.string(),
});

export const stateDocumentSchema = z.object({
  conceptSummary: z.string().min(1),
  timestamp: z.string().min(1),
  competitorMatrix: z.array(competitorSchema).default([]),
  openSourceAlternatives: z.array(ossAltSchema).default([]),
  marketSizing: marketSizingSchema,
  technicalInfraBenchmarks: z.array(benchmarkSchema).default([]),
  regulatoryLandscape: z.array(regItemSchema).default([]),
  talentSignal: z.array(talentItemSchema).default([]),
  overwriteLog: z.array(overwriteEntrySchema).default([]),
});

/** The validated Researcher payload. Structurally compatible with StateDocument. */
export type StateDocumentInput = z.input<typeof stateDocumentSchema>;
export type StateDocumentParsed = z.infer<typeof stateDocumentSchema>;

export interface ValidationOk {
  ok: true;
  value: StateDocumentParsed;
}
export interface ValidationErr {
  ok: false;
  /** Human-readable, ready to feed back to the model as a corrective re-prompt. */
  errorText: string;
}

/** Validate an unknown payload (e.g. parsed model JSON) against the schema. */
export function validateStateDocument(input: unknown): ValidationOk | ValidationErr {
  const result = stateDocumentSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  const errorText = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  return { ok: false, errorText };
}
