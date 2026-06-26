import { describe, it, expect } from 'vitest';
import { githubLookup } from '@/researcher/tools/github';
import { makeMockFetch } from '../helpers/mockFetch';

const NOW = new Date('2026-06-25T00:00:00.000Z');
const now = () => NOW;

describe('githubLookup', () => {
  it('looks up a direct owner/repo and computes last-commit days', async () => {
    const { fetch, calls } = makeMockFetch([
      { match: '/contributors', json: [{ login: 'a' }, { login: 'b' }] },
      {
        match: '/repos/vercel/next.js',
        json: {
          stargazers_count: 120000,
          open_issues_count: 2500,
          pushed_at: '2026-06-20T00:00:00.000Z', // 5 days before NOW
        },
      },
    ]);
    const signal = await githubLookup('vercel/next.js', { fetch, now });
    expect(signal.found).toBe(true);
    expect(signal.stars).toBe(120000);
    expect(signal.openIssues).toBe(2500);
    expect(signal.lastCommitDaysAgo).toBe(5);
    expect(signal.contributors).toBe(2);
    expect(signal.confidence).toBe('medium'); // unauthenticated
    // No search call for a direct owner/repo.
    expect(calls.some((c) => c.url.includes('/search/'))).toBe(false);
  });

  it('resolves a free-text query via search', async () => {
    const { fetch, calls } = makeMockFetch([
      { match: '/search/repositories', json: { items: [{ full_name: 'foo/bar' }] } },
      { match: '/repos/foo/bar', json: { stargazers_count: 10, pushed_at: NOW.toISOString() } },
      { match: '/contributors', json: [] },
    ]);
    const signal = await githubLookup('some compliance tool', { fetch, now });
    expect(signal.owner).toBe('foo');
    expect(signal.repo).toBe('bar');
    expect(calls[0]?.url).toContain('/search/repositories');
  });

  it('tags confidence high when a token is supplied', async () => {
    const { fetch, calls } = makeMockFetch([
      { match: '/repos/a/b', json: { stargazers_count: 1, pushed_at: NOW.toISOString() } },
      { match: '/contributors', json: [] },
    ]);
    const signal = await githubLookup('a/b', { fetch, token: 'ghp_x', now });
    expect(signal.confidence).toBe('high');
    expect(calls[0]?.init?.headers?.Authorization).toBe('Bearer ghp_x');
  });

  it('returns low-confidence not-found on rate limit (403)', async () => {
    const { fetch } = makeMockFetch([{ match: '/repos/a/b', status: 403, json: {} }]);
    const signal = await githubLookup('a/b', { fetch, now });
    expect(signal.found).toBe(false);
    expect(signal.confidence).toBe('low');
  });

  it('returns not-found when search yields nothing', async () => {
    const { fetch } = makeMockFetch([{ match: '/search/repositories', json: { items: [] } }]);
    const signal = await githubLookup('nonexistent xyz', { fetch, now });
    expect(signal.found).toBe(false);
  });
});
