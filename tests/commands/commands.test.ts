import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkConfig, formatConfigReport, runConfigCommand } from '@/commands/config';
import { formatRunList, runListCommand } from '@/commands/list';
import { saveRun } from '@/persistence/run';
import { buildProgram } from '@/index';
import { makeStateDocument } from '../helpers/fixtures';
import type { Run } from '@/types';

describe('config command', () => {
  it('reports present/missing keys and flags missing required ones', () => {
    const keys = checkConfig({ ANTHROPIC_API_KEY: 'x', BRAVE_API_KEY: '  ' });
    const report = formatConfigReport(keys);
    expect(report).toContain('ANTHROPIC_API_KEY');
    expect(report).toContain('Missing required keys: TAVILY_API_KEY');
    // Whitespace-only optional key counts as missing.
    expect(keys.find((k) => k.key === 'BRAVE_API_KEY')!.present).toBe(false);
  });

  it('confirms when all required keys are set', () => {
    const report = runConfigCommand({ ANTHROPIC_API_KEY: 'a', TAVILY_API_KEY: 't' });
    expect(report).toContain('All required keys are set');
  });
});

describe('list command', () => {
  it('formats an empty list with guidance', () => {
    expect(formatRunList([])).toContain('No runs yet');
  });

  it('formats summaries with verdict + cost', () => {
    const out = formatRunList([
      {
        id: 'x',
        concept: 'AI thing',
        createdAt: '2026-06-25T00:00:00.000Z',
        phase: 4,
        decision: 'NO_GO',
        usd: 1.2345,
      },
    ]);
    expect(out).toContain('NO-GO');
    expect(out).toContain('$  1.2345');
    expect(out).toContain('AI thing');
  });

  describe('with a temp runs dir', () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'council-cmd-'));
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('runListCommand reads saved runs', async () => {
      const run: Run = {
        id: 'concept-2026-06-25',
        concept: 'AI SOC2',
        createdAt: '2026-06-25T00:00:00.000Z',
        phase: 2,
        stateDocument: makeStateDocument(),
        transcript: [],
        flags: [],
        objectionLedger: [],
        conflictMap: [],
        verdict: null,
        cost: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 },
        modelTier: 'tiered',
      };
      await saveRun(run, root);
      expect(await runListCommand(root)).toContain('AI SOC2');
    });
  });
});

describe('CLI program', () => {
  it('registers the four commands', () => {
    const names = buildProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toEqual(['config', 'list', 'resume', 'run']);
  });
});
