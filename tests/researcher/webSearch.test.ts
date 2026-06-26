import { describe, it, expect } from 'vitest';
import { webSearch, SearchError } from '@/researcher/tools/webSearch';
import { makeMockFetch } from '../helpers/mockFetch';

const tavilyJson = {
  results: [{ title: 'T', url: 'https://t.example', content: 'tavily snippet' }],
};
const braveJson = {
  web: { results: [{ title: 'B', url: 'https://b.example', description: 'brave snippet' }] },
};

describe('webSearch', () => {
  it('uses Tavily first and tags the source', async () => {
    const { fetch, calls } = makeMockFetch([{ match: 'tavily', json: tavilyJson }]);
    const res = await webSearch('soc2 tools', { fetch, tavilyApiKey: 'k', braveApiKey: undefined });
    expect(res.provider).toBe('tavily');
    expect(res.degraded).toBe(false);
    expect(res.results[0]).toMatchObject({ source: 'tavily', snippet: 'tavily snippet' });
    expect(calls[0]?.url).toContain('tavily');
  });

  it('falls back to Brave when Tavily errors, marking degraded', async () => {
    const { fetch } = makeMockFetch([
      { match: 'tavily', throws: true },
      { match: 'brave', json: braveJson },
    ]);
    const res = await webSearch('q', { fetch, tavilyApiKey: 'k', braveApiKey: 'b' });
    expect(res.provider).toBe('brave');
    expect(res.degraded).toBe(true);
    expect(res.results[0]?.source).toBe('brave');
  });

  it('falls back to Brave when Tavily returns empty results', async () => {
    const { fetch } = makeMockFetch([
      { match: 'tavily', json: { results: [] } },
      { match: 'brave', json: braveJson },
    ]);
    const res = await webSearch('q', { fetch, tavilyApiKey: 'k', braveApiKey: 'b' });
    expect(res.provider).toBe('brave');
  });

  it('throws SearchError when no provider is available', async () => {
    const { fetch } = makeMockFetch([]);
    await expect(
      webSearch('q', { fetch, tavilyApiKey: undefined, braveApiKey: undefined }),
    ).rejects.toBeInstanceOf(SearchError);
  });

  it('throws when Tavily fails and there is no Brave key', async () => {
    const { fetch } = makeMockFetch([{ match: 'tavily', status: 500, json: {} }]);
    await expect(
      webSearch('q', { fetch, tavilyApiKey: 'k', braveApiKey: undefined }),
    ).rejects.toBeInstanceOf(SearchError);
  });
});
