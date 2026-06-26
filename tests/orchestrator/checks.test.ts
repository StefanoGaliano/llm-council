import { describe, it, expect } from 'vitest';
import { runCheck, checkAndResolve } from '@/orchestrator/checks';
import { LlmClient } from '@/llm/client';
import { MODEL_IDS } from '@/config/models';
import { MockBackend, toolUseResponse } from '../helpers/mockAnthropic';
import { PERSONAS } from '@/agents/registry';
import type { Turn } from '@/types';

const payloadJson = JSON.stringify({ competitorMatrix: [{ name: 'Vanta' }] });

function input(overrides = {}) {
  return {
    personaId: 'businessMan' as const,
    phase: 2 as const,
    turnContent: 'Competitor Acme raised $40M.',
    constitution: PERSONAS.businessMan.constitution,
    payloadJson,
    ...overrides,
  };
}

describe('runCheck', () => {
  it('uses Opus (orchestratorCheck) and forces the emit_flags tool', async () => {
    const backend = new MockBackend([toolUseResponse('emit_flags', { flags: [] })]);
    await runCheck(input(), { llm: new LlmClient(backend), modelTier: 'tiered' });
    expect(backend.calls[0]!.model).toBe(MODEL_IDS.opus);
    expect(backend.calls[0]!.tool_choice).toEqual({ type: 'tool', name: 'emit_flags' });
  });

  it('detects UNSUPPORTED_CLAIM for a competitor not in the payload', async () => {
    const backend = new MockBackend([
      toolUseResponse('emit_flags', {
        flags: [
          {
            type: 'UNSUPPORTED_CLAIM',
            detail: 'Acme not in State Document',
            quote: 'Acme raised $40M',
          },
        ],
      }),
    ]);
    const { flags } = await runCheck(input(), { llm: new LlmClient(backend), modelTier: 'tiered' });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      type: 'UNSUPPORTED_CLAIM',
      personaId: 'businessMan',
      resolved: false,
    });
    expect(flags[0]!.detail).toContain('$40M'); // quote folded into detail
  });

  it('detects PERSONA_BREACH for the Decider speaking in Phase 2', async () => {
    const backend = new MockBackend([
      toolUseResponse('emit_flags', {
        flags: [{ type: 'PERSONA_BREACH', detail: 'Decider must be silent until Phase 4' }],
      }),
    ]);
    const { flags } = await runCheck(
      input({ personaId: 'decider', turnContent: 'My verdict is GO.' }),
      { llm: new LlmClient(backend), modelTier: 'tiered' },
    );
    expect(flags[0]!.type).toBe('PERSONA_BREACH');
  });

  it('ignores unknown flag types defensively', async () => {
    const backend = new MockBackend([
      toolUseResponse('emit_flags', { flags: [{ type: 'NONSENSE', detail: 'x' }] }),
    ]);
    const { flags } = await runCheck(input(), { llm: new LlmClient(backend), modelTier: 'tiered' });
    expect(flags).toHaveLength(0);
  });

  it('returns no flags on a clean turn', async () => {
    const backend = new MockBackend([toolUseResponse('emit_flags', { flags: [] })]);
    const { flags } = await runCheck(input({ turnContent: 'Vanta is the incumbent.' }), {
      llm: new LlmClient(backend),
      modelTier: 'tiered',
    });
    expect(flags).toHaveLength(0);
  });
});

describe('checkAndResolve (one-retry contract)', () => {
  const turn: Turn = {
    phase: 2,
    round: 1,
    personaId: 'businessMan',
    content: 'Acme raised $40M.',
    flags: [],
    resubmission: false,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 },
  };

  it('returns the turn unflagged when the first check is clean', async () => {
    const backend = new MockBackend([toolUseResponse('emit_flags', { flags: [] })]);
    const result = await checkAndResolve(
      turn,
      { constitution: 'c', payloadJson },
      {
        llm: new LlmClient(backend),
        modelTier: 'tiered',
        resubmit: () => Promise.reject(new Error('should not resubmit')),
      },
    );
    expect(result.turn.flags).toEqual([]);
    expect(result.usages).toHaveLength(1);
  });

  it('resubmits once and marks the flag resolved when the re-check is clean', async () => {
    const backend = new MockBackend([
      toolUseResponse('emit_flags', { flags: [{ type: 'UNSUPPORTED_CLAIM', detail: 'Acme' }] }),
      toolUseResponse('emit_flags', { flags: [] }), // re-check clean
    ]);
    let resubmitted = false;
    const result = await checkAndResolve(
      turn,
      { constitution: 'c', payloadJson },
      {
        llm: new LlmClient(backend),
        modelTier: 'tiered',
        resubmit: () => {
          resubmitted = true;
          return Promise.resolve({ ...turn, content: 'Retracted.', resubmission: true });
        },
      },
    );
    expect(resubmitted).toBe(true);
    expect(result.turn.resubmission).toBe(true);
    expect(result.turn.flags).toHaveLength(1);
    expect(result.turn.flags[0]!.resolved).toBe(true);
    expect(result.usages).toHaveLength(2);
  });

  it('keeps the flag unresolved when it persists after the retry', async () => {
    const backend = new MockBackend([
      toolUseResponse('emit_flags', { flags: [{ type: 'UNSUPPORTED_CLAIM', detail: 'Acme' }] }),
      toolUseResponse('emit_flags', {
        flags: [{ type: 'UNSUPPORTED_CLAIM', detail: 'Acme still' }],
      }),
    ]);
    const result = await checkAndResolve(
      turn,
      { constitution: 'c', payloadJson },
      {
        llm: new LlmClient(backend),
        modelTier: 'tiered',
        resubmit: () =>
          Promise.resolve({ ...turn, content: 'Acme still $40M.', resubmission: true }),
      },
    );
    expect(result.turn.flags.some((f) => !f.resolved)).toBe(true);
  });
});
