import { describe, it, expect, vi } from 'vitest';
import {
  runCouncil,
  OrchestratorError,
  type OrchestratorDeps,
  type OrchestratorEvent,
} from '@/orchestrator/orchestrator';
import { LlmClient, type CreateBody, type LlmResponse } from '@/llm/client';
import { MockBackend, textResponse, toolUseResponse } from '../helpers/mockAnthropic';
import { makeStateDocument } from '../helpers/fixtures';
import type { ResearcherResult } from '@/researcher/researcher';
import type { Verdict } from '@/types';

const verdict: Verdict = {
  evidenceSynthesis: [],
  conflictResolutions: [],
  scoreMatrix: [],
  decision: 'NO_GO',
  conditions: [],
  killCondition: 'No defensible moat (Business Man).',
  unresolvedObjections: [],
  nextAction: 'Kill it.',
};

function researchResult(): ResearcherResult {
  const stateDocument = makeStateDocument();
  return {
    payload: stateDocument as unknown as ResearcherResult['payload'],
    stateDocument,
    stateMarkdown: '# State Document\n(stub)',
    usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, usd: 0.001 },
  };
}

/** One responder that answers every LLM call by branching on the forced tool. */
function councilResponder(): (body: CreateBody) => LlmResponse {
  return (body) => {
    const tool = body.tools?.[0]?.name;
    switch (tool) {
      case 'emit_flags':
        return toolUseResponse('emit_flags', { flags: [] });
      case 'build_conflict_map':
        return toolUseResponse('build_conflict_map', {
          conflicts: [
            { description: 'growth vs. burn', betweenPersonas: ['businessMan', 'financialMan'] },
          ],
        });
      case 'build_scorecard':
        return toolUseResponse('build_scorecard', {
          claims: [{ claim: 'TAM is $10B', status: 'SUPPORTED' }],
        });
      case 'extract_objections':
        return toolUseResponse('extract_objections', { objections: ['No clear ROI'] });
      default:
        return textResponse('In-role assessment grounded in the State Document.');
    }
  };
}

function makeDeps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  const backend = new MockBackend(councilResponder());
  return {
    llm: new LlmClient(backend),
    modelTier: 'tiered',
    research: () => Promise.resolve(researchResult()),
    decide: () =>
      Promise.resolve({
        verdict,
        usages: [{ inputTokens: 100, outputTokens: 50, cachedTokens: 0, usd: 0.05 }],
      }),
    now: () => new Date('2026-06-25T00:00:00.000Z'),
    ...over,
  };
}

describe('runCouncil pipeline (headless)', () => {
  it('drives Phase 0→4 and returns a completed Run', async () => {
    const run = await runCouncil('AI SOC2 evidence generator', makeDeps());

    expect(run.phase).toBe(4);
    expect(run.stateDocument).not.toBeNull();
    expect(run.verdict).toEqual(verdict);
    expect(run.conflictMap).toHaveLength(1);
    expect(run.objectionLedger).toContain('No clear ROI');
    // 4 (P1) + 5+6+5 (P2) + 3 (P3) = 23 persona turns.
    expect(run.transcript).toHaveLength(23);
    expect(run.cost.usd).toBeGreaterThan(0);
    expect(run.id.startsWith('ai-soc2-evidence-generator-')).toBe(true);
  });

  it('persists after every turn and emits ordered phase events', async () => {
    const onTurnEnd = vi.fn();
    const phases: number[] = [];
    const deps = makeDeps({
      onTurnEnd,
      onEvent: (e: OrchestratorEvent) => {
        if (e.type === 'phase:start') phases.push(e.phase);
      },
    });
    await runCouncil('concept', deps);

    // phase:start for 0,1,2(x3 rounds),3,4
    expect(phases).toEqual([0, 1, 2, 2, 2, 3, 4]);
    // one persist per persona turn (23) + phase0 + conflictMap + 3 rounds + verdict.
    expect(onTurnEnd.mock.calls.length).toBeGreaterThanOrEqual(23);
  });

  it('repeats Phase 0 until the integrity gate passes', async () => {
    const research = vi
      .fn<OrchestratorDeps['research']>()
      .mockResolvedValueOnce({
        ...researchResult(),
        stateDocument: makeStateDocument({ competitorMatrix: [] }),
      })
      .mockResolvedValue(researchResult());

    const integrity: boolean[] = [];
    await runCouncil(
      'concept',
      makeDeps({
        research,
        onEvent: (e) => {
          if (e.type === 'integrity') integrity.push(e.ok);
        },
      }),
    );

    expect(research).toHaveBeenCalledTimes(2);
    expect(integrity).toEqual([false, true]);
  });

  it('throws when the integrity gate never passes', async () => {
    const research: OrchestratorDeps['research'] = () =>
      Promise.resolve({
        ...researchResult(),
        stateDocument: makeStateDocument({ competitorMatrix: [] }),
      });
    await expect(
      runCouncil('concept', makeDeps({ research, maxResearchAttempts: 2 })),
    ).rejects.toBeInstanceOf(OrchestratorError);
  });

  it('records unresolved flags on a turn and surfaces them on the Run', async () => {
    // Responder that flags every persona turn with an unresolved PERSONA_BREACH.
    const backend = new MockBackend((body) => {
      const tool = body.tools?.[0]?.name;
      if (tool === 'emit_flags') {
        return toolUseResponse('emit_flags', {
          flags: [{ type: 'PERSONA_BREACH', detail: 'spoke out of role' }],
        });
      }
      if (tool) return councilResponder()(body);
      return textResponse('out of role content');
    });
    const run = await runCouncil('concept', makeDeps({ llm: new LlmClient(backend) }));
    expect(run.flags.length).toBeGreaterThan(0);
    expect(run.flags.every((f) => f.type === 'PERSONA_BREACH')).toBe(true);
  });
});
