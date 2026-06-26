import { describe, it, expect } from 'vitest';
import { runDecider, makeDecider, DeciderError } from '@/agents/decider';
import { LlmClient } from '@/llm/client';
import { MODEL_IDS } from '@/config/models';
import { MockBackend, toolUseResponse } from '../helpers/mockAnthropic';
import { makeStateDocument } from '../helpers/fixtures';
import type { Run } from '@/types';
import type { DeciderInput } from '@/orchestrator/orchestrator';

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 'concept-2026',
    concept: 'AI SOC2 evidence generator',
    createdAt: '2026-06-25T00:00:00.000Z',
    phase: 4,
    stateDocument: makeStateDocument(),
    transcript: [
      {
        phase: 1,
        round: null,
        personaId: 'businessMan',
        content: 'No defensible moat; Vanta owns the channel.',
        flags: [],
        resubmission: false,
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, usd: 0 },
      },
    ],
    flags: [],
    objectionLedger: ['No clear ROI'],
    conflictMap: [
      { description: 'growth vs burn', betweenPersonas: ['businessMan', 'financialMan'] },
    ],
    verdict: null,
    cost: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 },
    modelTier: 'tiered',
    ...over,
  };
}

function input(): DeciderInput {
  return { run: makeRun(), payloadJson: JSON.stringify(makeStateDocument()) };
}

const validVerdict = {
  evidenceSynthesis: [{ claim: 'TAM is $10B', tag: 'SUPPORTED' }],
  conflictResolutions: [
    { conflict: 'growth vs burn', favoredPersona: 'financialMan', rationale: 'Burn dominates.' },
  ],
  scoreMatrix: Array.from({ length: 5 }, (_, i) => ({
    dimension: `Dimension ${i + 1}`,
    weight: 20,
    score: 40,
    citedQuotes: ['No defensible moat', 'Vanta owns the channel'],
  })),
  decision: 'NO_GO',
  conditions: [],
  killCondition: 'No defensible moat (established by Business Man).',
  unresolvedObjections: ['No clear ROI'],
  nextAction: 'Kill it and redirect to a wedge feature.',
};

describe('runDecider', () => {
  it('uses Opus, forces deliver_verdict, and returns a validated Verdict', async () => {
    const backend = new MockBackend([toolUseResponse('deliver_verdict', validVerdict)]);
    const out = await runDecider(input(), { llm: new LlmClient(backend), modelTier: 'tiered' });

    expect(backend.calls[0]!.model).toBe(MODEL_IDS.opus);
    expect(backend.calls[0]!.tool_choice).toEqual({ type: 'tool', name: 'deliver_verdict' });
    expect(out.verdict.decision).toBe('NO_GO');
    expect(out.verdict.scoreMatrix).toHaveLength(5);
    expect(out.usages).toHaveLength(1);
  });

  it('injects the conflict map and objection ledger into the prompt', async () => {
    const backend = new MockBackend([toolUseResponse('deliver_verdict', validVerdict)]);
    await runDecider(input(), { llm: new LlmClient(backend), modelTier: 'tiered' });
    const content = backend.calls[0]!.messages[0]!.content as string;
    expect(content).toContain('growth vs burn');
    expect(content).toContain('No clear ROI');
  });

  it('retries once on a schema-invalid verdict (e.g. <2 cited quotes), then succeeds', async () => {
    const bad = {
      ...validVerdict,
      scoreMatrix: [{ dimension: 'D', weight: 20, score: 50, citedQuotes: ['one'] }],
    };
    const backend = new MockBackend([
      toolUseResponse('deliver_verdict', bad),
      toolUseResponse('deliver_verdict', validVerdict),
    ]);
    const out = await runDecider(input(), { llm: new LlmClient(backend), modelTier: 'tiered' });
    expect(out.usages).toHaveLength(2);
    expect(out.verdict.decision).toBe('NO_GO');
    // The retry prompt carries the validation correction.
    expect(backend.calls[1]!.messages[0]!.content).toContain('invalid');
  });

  it('throws DeciderError when the verdict never validates', async () => {
    const bad = { ...validVerdict, decision: 'MAYBE' };
    const backend = new MockBackend([
      toolUseResponse('deliver_verdict', bad),
      toolUseResponse('deliver_verdict', bad),
    ]);
    await expect(
      runDecider(input(), { llm: new LlmClient(backend), modelTier: 'tiered' }),
    ).rejects.toBeInstanceOf(DeciderError);
  });

  it('makeDecider binds a decide() compatible with the orchestrator', async () => {
    const backend = new MockBackend([toolUseResponse('deliver_verdict', validVerdict)]);
    const decide = makeDecider({ llm: new LlmClient(backend), modelTier: 'tiered' });
    const out = await decide(input());
    expect(out.verdict.decision).toBe('NO_GO');
  });
});
