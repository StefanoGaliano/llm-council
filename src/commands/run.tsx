/**
 * `council run [concept]` — start a new evaluation. With no concept argument it
 * shows the interactive Ink prompt first. Renders the live debate via <App>.
 */

import React from 'react';
import { render } from 'ink';
import type { ModelTier } from '@/config/models';
import type { Run } from '@/types';
import { loadEnv } from '@/config/env';
import { buildClients } from '@/composition';
import { runCouncil, type OrchestratorEvent } from '@/orchestrator/orchestrator';
import { saveRun } from '@/persistence/run';
import { App } from '@/ui/App';
import { ConceptPrompt } from '@/ui/components/ConceptPrompt';

export interface RunOptions {
  modelTier: ModelTier;
  /** Override the runs root (tests). */
  runsRoot?: string;
}

/** Render the interactive concept prompt and resolve with the entered text. */
function promptConcept(): Promise<string> {
  return new Promise((resolve) => {
    const ui = render(
      <ConceptPrompt
        onSubmit={(concept) => {
          ui.unmount();
          resolve(concept);
        }}
      />,
    );
  });
}

export async function runRunCommand(
  concept: string | undefined,
  opts: RunOptions,
): Promise<Run | undefined> {
  const env = loadEnv();
  const tier = opts.modelTier;
  const finalConcept = concept ?? (await promptConcept());

  const clients = buildClients(env, tier);
  let result: Run | undefined;

  const start = (onEvent: (e: OrchestratorEvent) => void): Promise<Run> =>
    runCouncil(finalConcept, {
      llm: clients.llm,
      research: clients.research,
      decide: clients.decide,
      modelTier: tier,
      onEvent,
      onTurnEnd: (run) => saveRun(run, opts.runsRoot),
    });

  const ui = render(<App start={start} onDone={(run) => (result = run)} />);
  await ui.waitUntilExit();
  return result;
}
