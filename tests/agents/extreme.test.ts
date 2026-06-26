/**
 * Extreme / adversarial harness tests. These probe the council's failure modes
 * deterministically (no network): hallucination flagging under volume, persona
 * breaches that persist through the one-retry contract, and the canary
 * degradation detector wired through the real runner.
 *
 * Live, model-driven versions of these probes live in `scripts/probe.ts`.
 */

import { describe, it, expect } from 'vitest';
import { runAgent } from '@/agents/runAgent';
import { runCheck, checkAndResolve } from '@/orchestrator/checks';
import { analyzeCanary } from '@/util/canary';
import { LlmClient } from '@/llm/client';
import { MockBackend, textResponse, toolUseResponse } from '../helpers/mockAnthropic';
import { PERSONAS } from '@/agents/registry';
import type { Turn } from '@/types';

const PHRASE = 'STILL-GROUNDED';
const payloadJson = JSON.stringify({ competitorMatrix: [{ name: 'Vanta' }] });

function baseCtx(overrides = {}) {
  return {
    phase: 1 as const,
    round: null,
    stateMarkdown: '# State Document\n\nVanta exists.',
    transcriptSlice: '',
    instruction: 'Assess the business case.',
    ...overrides,
  };
}

describe('canary directive injection (runner)', () => {
  it('appends the canary instruction to the outgoing prompt when enabled', async () => {
    const backend = new MockBackend([textResponse('ok', { output_tokens: 1 })]);
    await runAgent('businessMan', baseCtx({ canary: { everyWords: 30, phrase: PHRASE } }), {
      llm: new LlmClient(backend),
      modelTier: 'tiered',
    });
    const userBlocks = backend.calls[0]!.messages[0]!.content as Array<{ text: string }>;
    const taskBlock = userBlocks[userBlocks.length - 1]!.text;
    expect(taskBlock).toContain(PHRASE);
    expect(taskBlock).toContain('30');
  });

  it('omits the canary instruction by default', async () => {
    const backend = new MockBackend([textResponse('ok', { output_tokens: 1 })]);
    await runAgent('businessMan', baseCtx(), { llm: new LlmClient(backend), modelTier: 'tiered' });
    const userBlocks = backend.calls[0]!.messages[0]!.content as Array<{ text: string }>;
    const taskBlock = userBlocks[userBlocks.length - 1]!.text;
    expect(taskBlock).not.toContain('INTEGRITY CANARY');
  });
});

describe('hallucination flagging under volume', () => {
  it('parses and attributes many UNSUPPORTED_CLAIM flags from one stuffed turn', async () => {
    const fabricated = ['Acme $40M', 'Globex Series C', 'Initech IPO', 'Hooli $2B', 'Pied Piper'];
    const backend = new MockBackend([
      toolUseResponse('emit_flags', {
        flags: fabricated.map((c) => ({
          type: 'UNSUPPORTED_CLAIM',
          detail: `${c} not in State Document`,
          quote: c,
        })),
      }),
    ]);
    const { flags } = await runCheck(
      {
        personaId: 'businessMan',
        phase: 1,
        turnContent: fabricated.join('; '),
        constitution: PERSONAS.businessMan.constitution,
        payloadJson,
      },
      { llm: new LlmClient(backend), modelTier: 'tiered' },
    );
    expect(flags).toHaveLength(5);
    expect(flags.every((f) => f.type === 'UNSUPPORTED_CLAIM')).toBe(true);
    expect(flags.every((f) => f.personaId === 'businessMan')).toBe(true);
    // Each offending quote is folded into the detail for the transcript.
    expect(flags[3]!.detail).toContain('Hooli');
  });
});

describe('persona breach persists through the one-retry contract', () => {
  const turn: Turn = {
    phase: 1,
    round: null,
    personaId: 'informatic',
    content: 'The fix is to add a caching layer and re-architect the pipeline.', // proposing a solution
    flags: [],
    resubmission: false,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 },
  };

  it('keeps PERSONA_BREACH unresolved when the agent breaches again on retry', async () => {
    const backend = new MockBackend([
      toolUseResponse('emit_flags', {
        flags: [{ type: 'PERSONA_BREACH', detail: 'Informatic proposed a solution' }],
      }),
      toolUseResponse('emit_flags', {
        flags: [{ type: 'PERSONA_BREACH', detail: 'still proposing a fix' }],
      }),
    ]);
    const result = await checkAndResolve(
      turn,
      { constitution: PERSONAS.informatic.constitution, payloadJson },
      {
        llm: new LlmClient(backend),
        modelTier: 'tiered',
        resubmit: () =>
          Promise.resolve({ ...turn, content: 'Still, I would cache it.', resubmission: true }),
      },
    );
    expect(result.turn.flags.some((f) => f.type === 'PERSONA_BREACH' && !f.resolved)).toBe(true);
  });
});

describe('degradation detected end-to-end through the runner', () => {
  it('flags a long output whose canary cadence broke down', async () => {
    // Simulate a model that complies briefly then drifts (markers stop).
    const head = 'w1 w2 w3 STILL-GROUNDED w4 w5 w6';
    const drift = Array.from({ length: 60 }, (_, i) => `d${i}`).join(' ');
    const backend = new MockBackend([textResponse(`${head} ${drift}`, { output_tokens: 70 })]);

    const turn = await runAgent(
      'businessMan',
      baseCtx({ canary: { everyWords: 3, phrase: PHRASE } }),
      {
        llm: new LlmClient(backend),
        modelTier: 'tiered',
      },
    );

    const report = analyzeCanary(turn.content, { everyWords: 3, phrase: PHRASE });
    expect(report.degraded).toBe(true);
  });

  it('passes a long output that held the cadence', async () => {
    const words: string[] = [];
    for (let i = 1; i <= 60; i++) {
      words.push(`w${i}`);
      if (i % 3 === 0) words.push(PHRASE);
    }
    const backend = new MockBackend([textResponse(words.join(' '), { output_tokens: 60 })]);
    const turn = await runAgent(
      'businessMan',
      baseCtx({ canary: { everyWords: 3, phrase: PHRASE } }),
      {
        llm: new LlmClient(backend),
        modelTier: 'tiered',
      },
    );
    const report = analyzeCanary(turn.content, { everyWords: 3, phrase: PHRASE });
    expect(report.degraded).toBe(false);
  });
});
