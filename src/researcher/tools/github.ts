/**
 * GitHub repo signals via the REST API: stars, last-commit recency, open issues,
 * contributor count. `fetch` is injected so tests never hit the network.
 *
 * Degradation: unauthenticated requests work (lower rate limit); on 403
 * rate-limit the signal is returned with confidence "low".
 */

import type { Confidence } from '@/types';
import type { FetchLike } from '@/researcher/tools/webSearch';

export interface GithubSignal {
  owner: string;
  repo: string;
  stars: number | null;
  lastCommitDaysAgo: number | null;
  openIssues: number | null;
  contributors: number | null;
  found: boolean;
  confidence: Confidence;
}

export interface GithubDeps {
  fetch: FetchLike;
  /** Optional read-only PAT; raises the rate limit. */
  token?: string | undefined;
  /** Injectable clock for deterministic last-commit math. */
  now?: () => Date;
}

const API = 'https://api.github.com';
const REPO_RE = /^([\w.-]+)\/([\w.-]+)$/;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'llm-council',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function notFound(owner: string, repo: string): GithubSignal {
  return {
    owner,
    repo,
    stars: null,
    lastCommitDaysAgo: null,
    openIssues: null,
    contributors: null,
    found: false,
    confidence: 'low',
  };
}

/** Resolve a free-text query to an `owner/repo` (direct match, else search). */
async function resolveRepo(
  query: string,
  deps: GithubDeps,
): Promise<{ owner: string; repo: string } | null> {
  const direct = REPO_RE.exec(query.trim());
  if (direct) return { owner: direct[1]!, repo: direct[2]! };

  const url = `${API}/search/repositories?q=${encodeURIComponent(query)}&per_page=1`;
  const resp = await deps.fetch(url, { headers: headers(deps.token) });
  if (!resp.ok) return null;
  const data = (await resp.json()) as { items?: Array<{ full_name?: string }> };
  const fullName = data.items?.[0]?.full_name;
  if (!fullName) return null;
  const m = REPO_RE.exec(fullName);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/** Look up GitHub signals for a repo (`owner/repo`) or a free-text search query. */
export async function githubLookup(query: string, deps: GithubDeps): Promise<GithubSignal> {
  const resolved = await resolveRepo(query, deps);
  if (!resolved) return notFound(query, '');
  const { owner, repo } = resolved;
  const now = (deps.now ?? (() => new Date()))();

  const repoResp = await deps.fetch(`${API}/repos/${owner}/${repo}`, {
    headers: headers(deps.token),
  });
  if (repoResp.status === 403) {
    return { ...notFound(owner, repo), confidence: 'low' };
  }
  if (!repoResp.ok) return notFound(owner, repo);

  const repoData = (await repoResp.json()) as {
    stargazers_count?: number;
    open_issues_count?: number;
    pushed_at?: string;
  };

  let lastCommitDaysAgo: number | null = null;
  if (typeof repoData.pushed_at === 'string') {
    lastCommitDaysAgo = daysBetween(new Date(repoData.pushed_at), now);
  }

  let contributors: number | null = null;
  const contribResp = await deps.fetch(
    `${API}/repos/${owner}/${repo}/contributors?per_page=1&anon=true`,
    { headers: headers(deps.token) },
  );
  if (contribResp.ok) {
    const list = (await contribResp.json()) as unknown[];
    contributors = Array.isArray(list) ? list.length : null;
  }

  return {
    owner,
    repo,
    stars: repoData.stargazers_count ?? null,
    lastCommitDaysAgo,
    openIssues: repoData.open_issues_count ?? null,
    contributors,
    found: true,
    confidence: deps.token ? 'high' : 'medium',
  };
}
