/**
 * Resolve the on-disk locations for a run folder. The runs root is configurable
 * (defaults to `<cwd>/runs`) so tests can point it at a temp directory.
 */

import { join } from 'node:path';

export function runsRoot(root: string = process.cwd()): string {
  return join(root, 'runs');
}

export function runDir(id: string, root?: string): string {
  return join(runsRoot(root), id);
}

export interface RunPaths {
  dir: string;
  stateMd: string;
  payloadJson: string;
  transcriptMd: string;
  verdictMd: string;
  runJson: string;
}

export function runPaths(id: string, root?: string): RunPaths {
  const dir = runDir(id, root);
  return {
    dir,
    stateMd: join(dir, 'state.md'),
    payloadJson: join(dir, 'payload.json'),
    transcriptMd: join(dir, 'transcript.md'),
    verdictMd: join(dir, 'verdict.md'),
    runJson: join(dir, 'run.json'),
  };
}
