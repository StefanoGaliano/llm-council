import { describe, it, expect } from 'vitest';
import { loadEnv, EnvValidationError } from '@/config/env';

describe('loadEnv', () => {
  const valid = {
    ANTHROPIC_API_KEY: 'sk-ant-test',
    TAVILY_API_KEY: 'tvly-test',
  } satisfies NodeJS.ProcessEnv;

  it('accepts the minimal required keys', () => {
    const env = loadEnv(valid);
    expect(env.anthropicApiKey).toBe('sk-ant-test');
    expect(env.tavilyApiKey).toBe('tvly-test');
    expect(env.braveApiKey).toBeUndefined();
    expect(env.githubToken).toBeUndefined();
    expect(env.debug).toBe(false);
  });

  it('carries optional keys through when present', () => {
    const env = loadEnv({ ...valid, BRAVE_API_KEY: 'brave', GITHUB_TOKEN: 'ghp_x' });
    expect(env.braveApiKey).toBe('brave');
    expect(env.githubToken).toBe('ghp_x');
  });

  it('rejects a missing required key with a friendly, key-tagged error', () => {
    try {
      loadEnv({ TAVILY_API_KEY: 'tvly-test' });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const e = err as EnvValidationError;
      expect(e.missingKeys).toContain('ANTHROPIC_API_KEY');
      expect(e.message).toContain('council config');
    }
  });

  it('rejects an empty/whitespace required key', () => {
    expect(() => loadEnv({ ...valid, ANTHROPIC_API_KEY: '   ' })).toThrow(EnvValidationError);
  });

  it.each([
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
    [undefined, false],
  ])('parses COUNCIL_DEBUG=%s as debug=%s', (value, expected) => {
    const source = value === undefined ? valid : { ...valid, COUNCIL_DEBUG: value };
    expect(loadEnv(source).debug).toBe(expected);
  });
});
