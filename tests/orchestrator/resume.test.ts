import { describe, it, expect, vi } from 'vitest';
import {
  resumeCouncil,
  pivotCouncil,
  type OrchestratorDeps,
  type OrchestratorEvent,
} from '@/orchestrator/orchestrator';
import { phase1Turns, phase2Turns } from '@/orchestrator/phases';
import { LlmClient, type CreateBody, type LlmResponse } from '@/llm/client';
import { MockBackend, textResponse, toolUseResponse } from '../helpers/mockAnthropic';
import { makeStateDocument } from '../helpers/fixtures';
import type { ResearcherResult } from '@/researcher/researcher';
import type { Run, Turn, Verdict } from '@/types';

const verdict: Verdict = {
  evidenceSynthesis: [],
  conflictResolutions: [],
  scoreMatrix: [],
  decision: 'NO_GO',
  conditions: [],
  killCondition: 'No moat.',
  unresolvedObjections: [],
  nextAction: 'Kill it.',
};

function researchResult(over: Partial<ResearcherResult> = {}): ResearcherResult {
  const stateDocument = makeStateDocument();
  return {
    payload: stateDocument as unknown as ResearcherResult['payload'],
    stateDocument,
    stateMarkdown: '# State Document\n(stub)',
    usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, usd: 0.001 },
    ...over,
  };
}

function councilResponder(): (body: CreateBody) => LlmResponse {
  return (body) => {
    switch (body.tools?.[0]?.name) {
      case 'emit_flags':
        return toolUseResponse('emit_flags', { flags: [] });
      case 'build_conflict_map':
        return toolUseResponse('build_conflict_map', { conflicts: [] });
      case 'build_scorecard':
        return toolUseResponse('build_scorecard', { claims: [] });
      case 'extract_objections':
        return toolUseResponse('extract_objections', { objections: ['No ROI'] });
      default:
        return textResponse('In-role content.');
    }
  };
}

function makeDeps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    llm: new LlmClient(new MockBackend(councilResponder())),
    modelTier: 'tiered',
    research: () => Promise.resolve(researchResult()),
    decide: () =>
      Promise.resolve({
        verdict,
        usages: [{ inputTokens: 1, outputTokens: 1, cachedTokens: 0, usd: 0.01 }],
      }),
    now: () => new Date('2026-06-25T01:00:00.000Z'),
    ...over,
  };
}

function turn(phase: 1 | 2, round: number | null, personaId: Turn['personaId']): Turn {
  return {
    phase,
    round,
    personaId,
    content: 'prior',
    flags: [],
    resubmission: false,
    usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, usd: 0.01 },
  };
}

/** A run saved mid-Phase-2: Phase 1 + Round 1 done, Rounds 2–3 + Phase 3 pending. */
function midPhase2Run(): Run {
  const transcript: Turn[] = [
    ...phase1Turns().map((s) => turn(1, null, s.personaId)),
    ...phase2Turns(1).map((s) => turn(2, 1, s.personaId)),
  ];
  return {
    id: 'concept-2026-06-25t00-00-00',
    concept: 'AI SOC2 evidence',
    createdAt: '2026-06-25T00:00:00.000Z',
    phase: 2,
    stateDocument: makeStateDocument(),
    transcript,
    flags: [],
    objectionLedger: ['No ROI'],
    conflictMap: [{ description: 'growth vs burn', betweenPersonas: ['businessMan'] }],
    verdict: null,
    cost: { inputTokens: 9, outputTokens: 9, cachedTokens: 0, usd: 0.09 },
    modelTier: 'tiered',
  };
}

describe('resumeCouncil', () => {
  it('resumes mid-Phase-2 without re-running completed turns or re-grounding', async () => {
    const research = vi.fn<OrchestratorDeps['research']>(() => Promise.resolve(researchResult()));
    const started: string[] = [];
    const run = midPhase2Run();
    const before = run.transcript.length; // 9

    await resumeCouncil(
      run,
      makeDeps({
        research,
        onEvent: (e: OrchestratorEvent) => {
          if (e.type === 'turn:start') started.push(`${e.phase}:${e.round}:${e.personaId}`);
        },
      }),
    );

    expect(research).not.toHaveBeenCalled(); // State Document already present
    expect(run.phase).toBe(4);
    expect(run.verdict).toEqual(verdict);
    // Only the pending turns ran: round 2 (6) + round 3 (5) + Phase 3 (3) = 14.
    expect(started).toHaveLength(14);
    expect(started.some((s) => s.startsWith('1:'))).toBe(false); // no Phase 1 re-runs
    expect(run.transcript).toHaveLength(before + 14);
  });

  it('re-grounds when the saved run never produced a State Document', async () => {
    const research = vi.fn<OrchestratorDeps['research']>(() => Promise.resolve(researchResult()));
    const run = midPhase2Run();
    run.stateDocument = null;
    run.phase = 0;
    run.transcript = [];

    await resumeCouncil(run, makeDeps({ research }));
    expect(research).toHaveBeenCalled();
    expect(run.phase).toBe(4);
  });
});

describe('pivotCouncil', () => {
  it('re-grounds with overwrite logging, resets the debate, and completes', async () => {
    const oldDoc = makeStateDocument({ conceptSummary: 'old summary' });
    const newDoc = makeStateDocument({ conceptSummary: 'new summary after pivot' });
    const research = vi.fn<OrchestratorDeps['research']>(() =>
      Promise.resolve(researchResult({ stateDocument: newDoc })),
    );
    const run = midPhase2Run();
    run.stateDocument = oldDoc;

    await pivotCouncil(run, 'target mid-market instead of enterprise', makeDeps({ research }));

    expect(research).toHaveBeenCalled();
    // The pivot change is threaded into the research concept.
    expect(research.mock.calls[0]![0]).toContain('[PIVOT] target mid-market');
    expect(run.stateDocument!.conceptSummary).toBe('new summary after pivot');
    expect(run.stateDocument!.overwriteLog.some((o) => o.field === 'conceptSummary')).toBe(true);
    expect(run.phase).toBe(4);
    expect(run.verdict).toEqual(verdict);
  });
});
