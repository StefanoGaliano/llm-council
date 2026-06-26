import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRun, loadRun, listRuns, PersistenceError } from '@/persistence/run';
import { runPaths } from '@/persistence/paths';
import { makeStateDocument } from '../helpers/fixtures';
import type { Run, Verdict } from '@/types';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'council-runs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const verdict: Verdict = {
  evidenceSynthesis: [{ claim: 'TAM $10B', tag: 'SUPPORTED' }],
  conflictResolutions: [],
  scoreMatrix: [{ dimension: 'Moat', weight: 20, score: 30, citedQuotes: ['a', 'b'] }],
  decision: 'NO_GO',
  conditions: [],
  killCondition: 'No moat (Business Man).',
  unresolvedObjections: ['No ROI'],
  nextAction: 'Kill it.',
};

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 'concept-2026-06-25t00-00-00',
    concept: 'AI SOC2 evidence',
    createdAt: '2026-06-25T00:00:00.000Z',
    phase: 2,
    stateDocument: makeStateDocument(),
    transcript: [
      {
        phase: 1,
        round: null,
        personaId: 'businessMan',
        content: 'No moat.',
        flags: [],
        resubmission: false,
        usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, usd: 0.01 },
      },
    ],
    flags: [],
    objectionLedger: ['No ROI'],
    conflictMap: [{ description: 'growth vs burn', betweenPersonas: ['businessMan'] }],
    verdict: null,
    cost: { inputTokens: 1, outputTokens: 1, cachedTokens: 0, usd: 0.01 },
    modelTier: 'tiered',
    ...over,
  };
}

describe('saveRun / loadRun', () => {
  it('writes run.json + transcript.md and round-trips the Run', async () => {
    const run = makeRun();
    await saveRun(run, root);
    const paths = runPaths(run.id, root);

    const transcript = await readFile(paths.transcriptMd, 'utf8');
    expect(transcript).toContain('No moat.');
    expect(transcript).toContain('Conflict Map');

    const loaded = await loadRun(run.id, root);
    expect(loaded).toEqual(run);
  });

  it('writes state.md + payload.json when grounded, verdict.md when decided', async () => {
    const run = makeRun({ phase: 4, verdict });
    await saveRun(run, root);
    const paths = runPaths(run.id, root);

    expect(await readFile(paths.payloadJson, 'utf8')).toContain('conceptSummary');
    expect(await readFile(paths.stateMd, 'utf8')).toContain('State Document');
    const v = await readFile(paths.verdictMd, 'utf8');
    expect(v).toContain('NO-GO');
    expect(v).toContain('Kill it.');
  });

  it('throws PersistenceError for a missing run', async () => {
    await expect(loadRun('does-not-exist', root)).rejects.toBeInstanceOf(PersistenceError);
  });
});

describe('listRuns', () => {
  it('summarizes saved runs newest-first and skips junk dirs', async () => {
    await saveRun(makeRun({ id: 'a-2026-06-24', createdAt: '2026-06-24T00:00:00.000Z' }), root);
    await saveRun(
      makeRun({ id: 'b-2026-06-25', createdAt: '2026-06-25T00:00:00.000Z', phase: 4, verdict }),
      root,
    );
    // A stray directory without run.json must be ignored.
    await mkdir(join(root, 'runs', 'not-a-run'), { recursive: true });
    await writeFile(join(root, 'runs', 'not-a-run', 'README'), 'hi');

    const runs = await listRuns(root);
    expect(runs.map((r) => r.id)).toEqual(['b-2026-06-25', 'a-2026-06-24']);
    expect(runs[0]!.decision).toBe('NO_GO');
    expect(runs[1]!.decision).toBeNull();
  });

  it('returns [] when no runs directory exists', async () => {
    expect(await listRuns(join(root, 'nope'))).toEqual([]);
  });
});
