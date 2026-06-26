/**
 * `council resume <run-id> [--pivot "<change>"]` — continue an interrupted run
 * from its saved phase, or run the Pivot Protocol (re-ground + resume).
 */

import React from 'react';
import { render } from 'ink';
import type { ModelTier } from '@/config/models';
import type { Run } from '@/types';
import { loadEnv } from '@/config/env';
import { buildClients } from '@/composition';
import { resumeCouncil, pivotCouncil, type OrchestratorEvent } from '@/orchestrator/orchestrator';
import { loadRun, saveRun } from '@/persistence/run';
import { App } from '@/ui/App';

export interface ResumeOptions {
  modelTier: ModelTier;
  pivot?: string;
  runsRoot?: string;
}

export async function runResumeCommand(
  runId: string,
  opts: ResumeOptions,
): Promise<Run | undefined> {
  const env = loadEnv();
  const tier = opts.modelTier;
  const saved = await loadRun(runId, opts.runsRoot);
  const clients = buildClients(env, tier);
  let result: Run | undefined;

  const start = (onEvent: (e: OrchestratorEvent) => void): Promise<Run> => {
    const deps = {
      llm: clients.llm,
      research: clients.research,
      decide: clients.decide,
      modelTier: tier,
      onEvent,
      onTurnEnd: (run: Run) => saveRun(run, opts.runsRoot),
    };
    return opts.pivot ? pivotCouncil(saved, opts.pivot, deps) : resumeCouncil(saved, deps);
  };

  const ui = render(<App start={start} onDone={(run) => (result = run)} />);
  await ui.waitUntilExit();
  return result;
}
