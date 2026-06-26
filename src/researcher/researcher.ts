/**
 * Researcher agentic loop (Phase 0). Exposes web_search + github_lookup +
 * submit_state_document to the model, loops executing tools until the model
 * submits a payload, validates it with Zod, and allows ONE corrective retry
 * on a validation failure. Renders state.md from the validated payload.
 *
 * All external calls are injected (LlmClient + tool fns) so this runs headless
 * and fully mocked in tests — no network.
 */

import type { ModelId } from '@/config/models';
import type {
  LlmClient,
  MessageParam,
  ToolDef,
  TextBlockParam,
  ContentBlockParam,
} from '@/llm/client';
import { addToLedger, emptyLedger } from '@/llm/cost';
import type { CostLedger, StateDocument } from '@/types';
import { validateStateDocument, type StateDocumentParsed } from '@/researcher/schema';
import { renderStateDocument } from '@/researcher/stateDocument';
import type { SearchResponse } from '@/researcher/tools/webSearch';
import type { GithubSignal } from '@/researcher/tools/github';

export type ResearcherEvent =
  | { type: 'tool_call'; tool: string; query: string }
  | { type: 'tool_result'; tool: string; summary: string }
  | { type: 'validating' }
  | { type: 'retry'; errorText: string }
  | { type: 'done'; competitors: number };

export interface ResearcherDeps {
  llm: LlmClient;
  model: ModelId;
  search: (query: string) => Promise<SearchResponse>;
  github: (query: string) => Promise<GithubSignal>;
  onEvent?: (e: ResearcherEvent) => void;
  maxIterations?: number;
}

export interface ResearcherResult {
  payload: StateDocumentParsed;
  stateDocument: StateDocument;
  stateMarkdown: string;
  usage: CostLedger;
}

export class ResearcherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResearcherError';
  }
}

const SYSTEM = `You are the Researcher for the LLM Council. Ground a B2B/enterprise software concept in REAL data before any debate begins.

Use the web_search and github_lookup tools to gather: direct competitors (stage, funding, differentiator), open-source alternatives (stars, last commit, displacement risk), market sizing (TAM/SAM/SOM with sources), technical/infra benchmarks, regulatory landscape, and talent signals.

Rules:
- Paid sources (Crunchbase/PitchBook/LinkedIn) have no free API: derive those signals from web search and tag confidence: "low". Never fabricate precision.
- When you have enough grounding, call submit_state_document with the full structured payload. Every quantitative figure must trace to something you actually found.`;

const TOOLS: ToolDef[] = [
  {
    name: 'web_search',
    description: 'Search the web for market, competitor, funding, regulatory, and talent signals.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'github_lookup',
    description:
      'Look up GitHub repo signals (stars, last commit, issues) by "owner/repo" or search.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_state_document',
    description: 'Submit the final, complete State Document payload (System Prompt §2 schema).',
    input_schema: {
      type: 'object',
      properties: {
        conceptSummary: { type: 'string' },
        timestamp: { type: 'string' },
        competitorMatrix: { type: 'array' },
        openSourceAlternatives: { type: 'array' },
        marketSizing: { type: 'object' },
        technicalInfraBenchmarks: { type: 'array' },
        regulatoryLandscape: { type: 'array' },
        talentSignal: { type: 'array' },
        overwriteLog: { type: 'array' },
      },
      required: ['conceptSummary', 'marketSizing'],
    },
  },
];

function emit(deps: ResearcherDeps, e: ResearcherEvent): void {
  deps.onEvent?.(e);
}

function queryOf(input: unknown): string {
  if (input && typeof input === 'object' && 'query' in input) {
    const q = (input as { query: unknown }).query;
    return typeof q === 'string' ? q : '';
  }
  return '';
}

/** Run Phase 0 grounding. Returns the validated payload + rendered state.md. */
export async function runResearcher(
  concept: string,
  deps: ResearcherDeps,
): Promise<ResearcherResult> {
  const maxIterations = deps.maxIterations ?? 12;
  let usage = emptyLedger();
  let validationRetriesLeft = 1;

  const system: TextBlockParam[] = [
    { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
  ];
  const messages: MessageParam[] = [
    { role: 'user', content: `Concept to evaluate:\n\n${concept}` },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const result = await deps.llm.complete({
      model: deps.model,
      system,
      messages,
      tools: TOOLS,
      toolChoice: { type: 'auto' },
    });
    usage = addToLedger(usage, result.usage);

    if (result.toolUse.length === 0) {
      // No tool call — nudge once toward submitting, then continue.
      messages.push({ role: 'assistant', content: result.text || '(thinking)' });
      messages.push({
        role: 'user',
        content: 'Continue researching, then call submit_state_document with the full payload.',
      });
      continue;
    }

    // Reconstruct the assistant turn (text + tool_use blocks) for the history.
    const assistantBlocks: ContentBlockParam[] = [];
    if (result.text) assistantBlocks.push({ type: 'text', text: result.text });
    for (const tu of result.toolUse) {
      assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
    }
    messages.push({ role: 'assistant', content: assistantBlocks });

    const toolResults: ContentBlockParam[] = [];
    for (const tu of result.toolUse) {
      if (tu.name === 'submit_state_document') {
        emit(deps, { type: 'validating' });
        const validation = validateStateDocument(tu.input);
        if (validation.ok) {
          const payload = validation.value;
          const stateDocument = payload as unknown as StateDocument;
          emit(deps, { type: 'done', competitors: payload.competitorMatrix.length });
          return {
            payload,
            stateDocument,
            stateMarkdown: renderStateDocument(stateDocument),
            usage,
          };
        }
        if (validationRetriesLeft <= 0) {
          throw new ResearcherError(
            `State Document failed validation after retry:\n${validation.errorText}`,
          );
        }
        validationRetriesLeft -= 1;
        emit(deps, { type: 'retry', errorText: validation.errorText });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          is_error: true,
          content: `Validation failed. Fix these and resubmit:\n${validation.errorText}`,
        });
        continue;
      }

      const query = queryOf(tu.input);
      emit(deps, { type: 'tool_call', tool: tu.name, query });
      try {
        if (tu.name === 'web_search') {
          const res = await deps.search(query);
          const summary = `(${res.provider}${res.degraded ? ', degraded' : ''}) ${res.results.length} results`;
          emit(deps, { type: 'tool_result', tool: tu.name, summary });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(res),
          });
        } else if (tu.name === 'github_lookup') {
          const res = await deps.github(query);
          emit(deps, {
            type: 'tool_result',
            tool: tu.name,
            summary: res.found ? `${res.owner}/${res.repo} ★${res.stars}` : 'not found',
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(res),
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            is_error: true,
            content: `Unknown tool: ${tu.name}`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          is_error: true,
          content: `Tool error: ${message}`,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  throw new ResearcherError(
    `Researcher did not produce a valid State Document within ${maxIterations} iterations.`,
  );
}
