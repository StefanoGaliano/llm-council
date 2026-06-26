import { describe, it, expect } from 'vitest';
import { runResearcher, ResearcherError, type ResearcherEvent } from '@/researcher/researcher';
import { LlmClient } from '@/llm/client';
import { MODEL_IDS } from '@/config/models';
import { MockBackend, toolUseResponse } from '../helpers/mockAnthropic';
import { canonicalPayload } from '../helpers/fixtures';
import type { SearchResponse } from '@/researcher/tools/webSearch';
import type { GithubSignal } from '@/researcher/tools/github';

const searchOk = (): Promise<SearchResponse> =>
  Promise.resolve({
    query: 'q',
    provider: 'tavily',
    degraded: false,
    results: [{ title: 't', url: 'u', snippet: 's', source: 'tavily' }],
  });

const githubOk = (): Promise<GithubSignal> =>
  Promise.resolve({
    owner: 'o',
    repo: 'r',
    stars: 100,
    lastCommitDaysAgo: 5,
    openIssues: 3,
    contributors: 2,
    found: true,
    confidence: 'medium',
  });

describe('runResearcher', () => {
  it('runs tools then submits a valid payload, accumulating usage', async () => {
    const backend = new MockBackend([
      toolUseResponse(
        'web_search',
        { query: 'soc2 competitors' },
        {
          id: 't1',
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      ),
      toolUseResponse(
        'github_lookup',
        { query: 'vanta/vanta' },
        {
          id: 't2',
          usage: { input_tokens: 80, output_tokens: 15 },
        },
      ),
      toolUseResponse('submit_state_document', canonicalPayload, {
        id: 't3',
        usage: { input_tokens: 200, output_tokens: 300 },
      }),
    ]);
    const events: ResearcherEvent[] = [];
    const result = await runResearcher('A SOC2 evidence tool', {
      llm: new LlmClient(backend),
      model: MODEL_IDS.sonnet,
      search: searchOk,
      github: githubOk,
      onEvent: (e) => events.push(e),
    });

    expect(result.payload.conceptSummary).toContain('SOC2');
    expect(result.stateMarkdown).toContain('# State Document');
    expect(result.usage.outputTokens).toBe(335); // 20 + 15 + 300
    expect(events.map((e) => e.type)).toContain('done');
    expect(events.some((e) => e.type === 'tool_call' && e.tool === 'web_search')).toBe(true);
    // 3 model calls were made.
    expect(backend.calls).toHaveLength(3);
  });

  it('retries once on an invalid payload, then succeeds', async () => {
    const backend = new MockBackend([
      toolUseResponse('submit_state_document', { timestamp: 't' }, { id: 'bad' }), // missing conceptSummary
      toolUseResponse('submit_state_document', canonicalPayload, { id: 'good' }),
    ]);
    const events: ResearcherEvent[] = [];
    const result = await runResearcher('concept', {
      llm: new LlmClient(backend),
      model: MODEL_IDS.sonnet,
      search: searchOk,
      github: githubOk,
      onEvent: (e) => events.push(e),
    });
    expect(result.payload.conceptSummary).toBeTruthy();
    expect(events.some((e) => e.type === 'retry')).toBe(true);
  });

  it('throws if the payload is still invalid after the one retry', async () => {
    const backend = new MockBackend([
      toolUseResponse('submit_state_document', { timestamp: 't' }, { id: 'b1' }),
      toolUseResponse('submit_state_document', { timestamp: 't2' }, { id: 'b2' }),
    ]);
    await expect(
      runResearcher('concept', {
        llm: new LlmClient(backend),
        model: MODEL_IDS.sonnet,
        search: searchOk,
        github: githubOk,
      }),
    ).rejects.toBeInstanceOf(ResearcherError);
  });

  it('surfaces a tool error to the model as an is_error result without crashing', async () => {
    const backend = new MockBackend([
      toolUseResponse('web_search', { query: 'q' }, { id: 't1' }),
      toolUseResponse('submit_state_document', canonicalPayload, { id: 't2' }),
    ]);
    const result = await runResearcher('concept', {
      llm: new LlmClient(backend),
      model: MODEL_IDS.sonnet,
      search: () => Promise.reject(new Error('search down')),
      github: githubOk,
    });
    expect(result.payload).toBeTruthy();
    // The second model call's messages should carry the error tool_result.
    const secondCall = backend.calls[1];
    const lastUser = secondCall?.messages.at(-1);
    expect(JSON.stringify(lastUser)).toContain('search down');
  });
});
