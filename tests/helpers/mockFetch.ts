/**
 * Deterministic fetch stub for tool tests. Routes by URL substring → response.
 */

import type { FetchLike, FetchResponse } from '@/researcher/tools/webSearch';

export interface MockRoute {
  /** Substring matched against the request URL. */
  match: string;
  status?: number;
  json?: unknown;
  /** Throw a network-style error instead of responding. */
  throws?: boolean;
}

export interface MockFetchCall {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}

export function makeMockFetch(routes: MockRoute[]): {
  fetch: FetchLike;
  calls: MockFetchCall[];
} {
  const calls: MockFetchCall[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    // First matching route wins — list more specific routes (e.g. `/contributors`)
    // before broader ones (e.g. `/repos/o/r`) when both could match a URL.
    const route = routes.find((r) => url.includes(r.match));
    if (!route) {
      return Promise.reject(new Error(`mockFetch: no route for ${url}`));
    }
    if (route.throws) {
      return Promise.reject(new Error(`mockFetch: simulated network error for ${route.match}`));
    }
    const status = route.status ?? 200;
    const resp: FetchResponse = {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(route.json),
      text: () => Promise.resolve(JSON.stringify(route.json)),
    };
    return Promise.resolve(resp);
  };
  return { fetch, calls };
}
