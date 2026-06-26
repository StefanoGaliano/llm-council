import { describe, it, expect } from 'vitest';
import { runAgent } from '@/agents/runAgent';
import { PERSONAS } from '@/agents/registry';
import { LlmClient } from '@/llm/client';
import { MODEL_IDS } from '@/config/models';
import { MockBackend, textResponse } from '../helpers/mockAnthropic';

function ctx(overrides = {}) {
  return {
    phase: 1 as const,
    round: null,
    stateMarkdown: '# State Document\n\nVanta exists.',
    transcriptSlice: '',
    instruction: 'Assess the business case.',
    ...overrides,
  };
}

describe('registry', () => {
  it('has all 7 council personas with constitutions', () => {
    const ids = Object.keys(PERSONAS);
    expect(ids).toHaveLength(7);
    for (const p of Object.values(PERSONAS)) {
      expect(p.constitution.length).toBeGreaterThan(50);
    }
  });

  it('routes the Decider through the opus (decider) role; others through persona', () => {
    expect(PERSONAS.decider.modelRole).toBe('decider');
    expect(PERSONAS.businessMan.modelRole).toBe('persona');
  });
});

describe('runAgent', () => {
  it('returns a Turn, injects constitution as cached system + State Document as cached user block', async () => {
    const backend = new MockBackend([
      textResponse('The business case is thin.', { input_tokens: 500, output_tokens: 80 }),
    ]);
    const turn = await runAgent('businessMan', ctx(), {
      llm: new LlmClient(backend),
      modelTier: 'tiered',
    });

    expect(turn.personaId).toBe('businessMan');
    expect(turn.content).toContain('thin');
    expect(turn.flags).toEqual([]);
    expect(turn.resubmission).toBe(false);
    expect(turn.usage.outputTokens).toBe(80);

    const call = backend.calls[0]!;
    expect(call.model).toBe(MODEL_IDS.sonnet); // persona → Sonnet under tiered
    // system carries the constitution with a cache breakpoint
    const sys = call.system as Array<{ text: string; cache_control?: unknown }>;
    expect(sys[0]?.text).toContain('Business Man');
    expect(sys[0]?.cache_control).toBeDefined();
    // first user block is the State Document, cached
    const userBlocks = call.messages[0]!.content as Array<{
      text: string;
      cache_control?: unknown;
    }>;
    expect(userBlocks[0]?.text).toContain('State Document');
    expect(userBlocks[0]?.cache_control).toBeDefined();
  });

  it('routes the Decider to Opus under the tiered tier', async () => {
    const backend = new MockBackend([textResponse('verdict')]);
    await runAgent('decider', ctx({ phase: 4 }), {
      llm: new LlmClient(backend),
      modelTier: 'tiered',
    });
    expect(backend.calls[0]!.model).toBe(MODEL_IDS.opus);
  });

  it('appends an ORCHESTRATOR FLAG directive on a re-submission', async () => {
    const backend = new MockBackend([textResponse('retracted')]);
    const turn = await runAgent(
      'businessMan',
      ctx({
        resubmissionFlags: [
          {
            type: 'UNSUPPORTED_CLAIM',
            personaId: 'businessMan',
            detail: 'claimed $40M',
            resolved: false,
          },
        ],
      }),
      { llm: new LlmClient(backend), modelTier: 'tiered' },
    );
    expect(turn.resubmission).toBe(true);
    const userBlocks = backend.calls[0]!.messages[0]!.content as Array<{ text: string }>;
    expect(userBlocks[1]?.text).toContain('ORCHESTRATOR FLAG');
    expect(userBlocks[1]?.text).toContain('$40M');
  });

  it('honors --model-tier all-opus override', async () => {
    const backend = new MockBackend([textResponse('x')]);
    await runAgent('businessMan', ctx(), { llm: new LlmClient(backend), modelTier: 'all-opus' });
    expect(backend.calls[0]!.model).toBe(MODEL_IDS.opus);
  });
});
