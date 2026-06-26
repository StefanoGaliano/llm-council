import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from '@/ui/App';
import type { OrchestratorEvent } from '@/orchestrator/orchestrator';
import type { Run, Turn, Verdict } from '@/types';
import { makeStateDocument } from '../helpers/fixtures';

const turn: Turn = {
  phase: 1,
  round: null,
  personaId: 'businessMan',
  content: 'No defensible moat here.',
  flags: [
    {
      type: 'UNSUPPORTED_CLAIM',
      personaId: 'businessMan',
      detail: 'Acme funding',
      resolved: false,
    },
  ],
  resubmission: false,
  usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, usd: 0.02 },
};

const verdict: Verdict = {
  evidenceSynthesis: [{ claim: 'TAM $10B', tag: 'SUPPORTED' }],
  conflictResolutions: [],
  scoreMatrix: [{ dimension: 'Moat', weight: 20, score: 30, citedQuotes: ['a', 'b'] }],
  decision: 'NO_GO',
  conditions: [],
  killCondition: 'No moat (Business Man).',
  unresolvedObjections: [],
  nextAction: 'Kill it.',
};

function finishedRun(): Run {
  return {
    id: 'x',
    concept: 'c',
    createdAt: '2026-06-25T00:00:00.000Z',
    phase: 4,
    stateDocument: makeStateDocument(),
    transcript: [turn],
    flags: turn.flags,
    objectionLedger: ['No ROI'],
    conflictMap: [],
    verdict,
    cost: { inputTokens: 10, outputTokens: 5, cachedTokens: 2, usd: 0.02 },
    modelTier: 'tiered',
  };
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('<App>', () => {
  it('renders the live debate from orchestrator events', async () => {
    const start = async (onEvent: (e: OrchestratorEvent) => void): Promise<Run> => {
      onEvent({ type: 'phase:start', phase: 1, round: null });
      onEvent({ type: 'turn:end', turn });
      onEvent({ type: 'ledger:update', objectionLedger: ['No ROI'] });
      onEvent({ type: 'cost:update', cost: finishedRun().cost });
      onEvent({ type: 'verdict', verdict });
      // Keep the run "open" so the rendered frame is observable before exit.
      await delay(80);
      return finishedRun();
    };

    const { lastFrame } = render(<App start={start} />);
    await delay(30);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('PHASE 1');
    expect(frame).toContain('The Business Man');
    expect(frame).toContain('No defensible moat here.');
    expect(frame).toContain('ORCHESTRATOR FLAG');
    expect(frame).toContain('Objection Ledger');
    expect(frame).toContain('VERDICT: NO-GO');
    expect(frame).toContain('$0.0200');
  });
});
