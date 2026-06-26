/**
 * Composition root: turn a validated env + model tier into the orchestrator's
 * dependencies (real Anthropic + search + GitHub clients). The orchestrator and
 * UI never import SDKs directly — they receive these injected deps, which keeps
 * everything mockable in tests.
 */

import type { CouncilEnv } from '@/config/env';
import type { ModelTier } from '@/config/models';
import { modelForRole } from '@/config/models';
import { LlmClient, createAnthropicBackend } from '@/llm/client';
import { runResearcher, type ResearcherResult } from '@/researcher/researcher';
import { webSearch, type FetchLike } from '@/researcher/tools/webSearch';
import { githubLookup } from '@/researcher/tools/github';
import { makeDecider } from '@/agents/decider';
import type { DeciderInput, DeciderOutput } from '@/orchestrator/orchestrator';
import type { ResearcherEvent } from '@/researcher/researcher';

export interface CouncilClients {
  llm: LlmClient;
  research: (concept: string, attempt: number, missing: string[]) => Promise<ResearcherResult>;
  decide: (input: DeciderInput) => Promise<DeciderOutput>;
}

/** Build the live orchestrator dependencies from env + tier. */
export function buildClients(
  env: CouncilEnv,
  tier: ModelTier,
  onResearcherEvent?: (e: ResearcherEvent) => void,
): CouncilClients {
  const llm = new LlmClient(createAnthropicBackend(env.anthropicApiKey));
  const fetchLike = globalThis.fetch as unknown as FetchLike;

  const research = (
    concept: string,
    _attempt: number,
    missing: string[],
  ): Promise<ResearcherResult> => {
    const prompt =
      missing.length > 0
        ? `${concept}\n\n[INTEGRITY GATE] The prior State Document was incomplete. You MUST populate: ${missing.join(', ')}.`
        : concept;
    return runResearcher(prompt, {
      llm,
      model: modelForRole('researcher', tier),
      search: (query) =>
        webSearch(query, {
          fetch: fetchLike,
          tavilyApiKey: env.tavilyApiKey,
          braveApiKey: env.braveApiKey,
        }),
      github: (query) => githubLookup(query, { fetch: fetchLike, token: env.githubToken }),
      ...(onResearcherEvent ? { onEvent: onResearcherEvent } : {}),
    });
  };

  const decide = makeDecider({ llm, modelTier: tier });

  return { llm, research, decide };
}
