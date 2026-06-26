/**
 * Run-folder lifecycle: create the folder, persist all artifacts after each
 * turn, load a saved run for resume, and list past runs. Filesystem only — a
 * single-user CLI needs no DB. The runs root is injectable for tests.
 */

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import type { Run } from '@/types';
import { runPaths, runsRoot, type RunPaths } from '@/persistence/paths';
import { renderStateDocument } from '@/researcher/stateDocument';
import { renderTranscriptMd, renderVerdictMd } from '@/persistence/serialize';

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

/** Ensure the run folder exists. */
export async function createRunFolder(id: string, root?: string): Promise<RunPaths> {
  const paths = runPaths(id, root);
  await mkdir(paths.dir, { recursive: true });
  return paths;
}

/**
 * Persist the full run state. Always writes run.json (resume source of truth)
 * + transcript.md; writes state.md/payload.json once grounded and verdict.md
 * once decided. Safe to call after every turn (it's the `onTurnEnd` callback).
 */
export async function saveRun(run: Run, root?: string): Promise<void> {
  const paths = await createRunFolder(run.id, root);
  const writes: Promise<void>[] = [
    writeFile(paths.runJson, JSON.stringify(run, null, 2)),
    writeFile(paths.transcriptMd, renderTranscriptMd(run)),
  ];
  if (run.stateDocument) {
    writes.push(writeFile(paths.payloadJson, JSON.stringify(run.stateDocument, null, 2)));
    writes.push(writeFile(paths.stateMd, renderStateDocument(run.stateDocument)));
  }
  if (run.verdict) {
    writes.push(writeFile(paths.verdictMd, renderVerdictMd(run)));
  }
  await Promise.all(writes);
}

/** Load a saved run from its run.json. */
export async function loadRun(id: string, root?: string): Promise<Run> {
  const paths = runPaths(id, root);
  let raw: string;
  try {
    raw = await readFile(paths.runJson, 'utf8');
  } catch {
    throw new PersistenceError(`No run found with id "${id}" (expected ${paths.runJson}).`);
  }
  try {
    return JSON.parse(raw) as Run;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PersistenceError(`Corrupt run.json for "${id}": ${message}`);
  }
}

export interface RunSummary {
  id: string;
  concept: string;
  createdAt: string;
  phase: number;
  decision: string | null;
  usd: number;
}

/** List saved runs (most recent first), reading each run.json summary. */
export async function listRuns(root?: string): Promise<RunSummary[]> {
  const dir = runsRoot(root);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const summaries: RunSummary[] = [];
  for (const id of entries) {
    const paths = runPaths(id, root);
    try {
      const s = await stat(paths.dir);
      if (!s.isDirectory()) continue;
      const run = JSON.parse(await readFile(paths.runJson, 'utf8')) as Run;
      summaries.push({
        id: run.id,
        concept: run.concept,
        createdAt: run.createdAt,
        phase: run.phase,
        decision: run.verdict?.decision ?? null,
        usd: run.cost.usd,
      });
    } catch {
      // Skip non-run directories / unreadable entries.
    }
  }
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
