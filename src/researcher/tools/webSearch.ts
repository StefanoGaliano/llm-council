/**
 * Web search tool: Tavily primary, Brave fallback. Returns normalized,
 * source-tagged results. `fetch` is injected so tests never hit the network.
 *
 * Degradation: Tavily failure/empty → Brave (if key present). If no provider is
 * available or both fail, throws SearchError — the Researcher cannot ground
 * without search.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: 'tavily' | 'brave';
}

export interface SearchResponse {
  query: string;
  provider: 'tavily' | 'brave';
  results: SearchResult[];
  /** True when we fell back off the primary provider. */
  degraded: boolean;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

export interface WebSearchDeps {
  fetch: FetchLike;
  tavilyApiKey: string | undefined;
  braveApiKey: string | undefined;
  maxResults?: number;
}

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchError';
  }
}

const TAVILY_URL = 'https://api.tavily.com/search';
const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function tavilySearch(
  query: string,
  apiKey: string,
  fetchFn: FetchLike,
  maxResults: number,
): Promise<SearchResult[]> {
  const resp = await fetchFn(TAVILY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
  });
  if (!resp.ok) throw new SearchError(`Tavily HTTP ${resp.status}`);
  const data = (await resp.json()) as { results?: Array<Record<string, unknown>> };
  const rows = data.results ?? [];
  return rows.map((r) => ({
    title: asString(r.title),
    url: asString(r.url),
    snippet: asString(r.content),
    source: 'tavily' as const,
  }));
}

async function braveSearch(
  query: string,
  apiKey: string,
  fetchFn: FetchLike,
  maxResults: number,
): Promise<SearchResult[]> {
  const url = `${BRAVE_URL}?q=${encodeURIComponent(query)}&count=${maxResults}`;
  const resp = await fetchFn(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  });
  if (!resp.ok) throw new SearchError(`Brave HTTP ${resp.status}`);
  const data = (await resp.json()) as { web?: { results?: Array<Record<string, unknown>> } };
  const rows = data.web?.results ?? [];
  return rows.map((r) => ({
    title: asString(r.title),
    url: asString(r.url),
    snippet: asString(r.description),
    source: 'brave' as const,
  }));
}

/** Run a web search with automatic Tavily→Brave failover. */
export async function webSearch(query: string, deps: WebSearchDeps): Promise<SearchResponse> {
  const maxResults = deps.maxResults ?? 5;
  let tavilyError: unknown;

  if (deps.tavilyApiKey) {
    try {
      const results = await tavilySearch(query, deps.tavilyApiKey, deps.fetch, maxResults);
      if (results.length > 0) {
        return { query, provider: 'tavily', results, degraded: false };
      }
    } catch (err) {
      tavilyError = err;
    }
  }

  if (deps.braveApiKey) {
    const results = await braveSearch(query, deps.braveApiKey, deps.fetch, maxResults);
    return { query, provider: 'brave', results, degraded: true };
  }

  const detail = tavilyError instanceof Error ? `: ${tavilyError.message}` : '';
  throw new SearchError(
    `No web search provider available (Tavily failed or empty, no Brave fallback)${detail}`,
  );
}
