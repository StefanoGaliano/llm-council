/**
 * Zod-validated environment loading. Loads from process.env + .env + optional
 * ~/.councilrc, validates, and FAILS FAST with a friendly message pointing at
 * `council config` when a required key is missing.
 *
 * Required: ANTHROPIC_API_KEY, TAVILY_API_KEY.
 * Optional: BRAVE_API_KEY (search fallback), GITHUB_TOKEN (repo signals), COUNCIL_DEBUG.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
// Optional keys: a present-but-empty value (e.g. `BRAVE_API_KEY=` in .env) is
// treated as unset rather than a validation error.
const optionalNonEmpty = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  nonEmpty.optional(),
);

const envSchema = z.object({
  ANTHROPIC_API_KEY: nonEmpty,
  TAVILY_API_KEY: nonEmpty,
  BRAVE_API_KEY: optionalNonEmpty,
  GITHUB_TOKEN: optionalNonEmpty,
  COUNCIL_DEBUG: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false'), z.literal('')])
    .optional(),
});

/** Validated, typed environment config. */
export interface CouncilEnv {
  anthropicApiKey: string;
  tavilyApiKey: string;
  braveApiKey: string | undefined;
  githubToken: string | undefined;
  debug: boolean;
}

/** Raised when required config is missing or malformed. Carries a user-facing hint. */
export class EnvValidationError extends Error {
  constructor(
    message: string,
    readonly missingKeys: string[],
  ) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/** Load `~/.councilrc` as additional env defaults (does not override process.env). */
function loadCouncilrc(into: Record<string, string | undefined>): void {
  const path = join(homedir(), '.councilrc');
  if (!existsSync(path)) return;
  const parsed = parseEnvFile(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (into[key] === undefined) into[key] = value;
  }
}

/** Minimal KEY=value parser for ~/.councilrc (dotenv format, no export/quotes magic). */
function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function isTruthyDebug(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/**
 * Load + validate environment. Pass an explicit source for testing; defaults to
 * process.env merged with .env and ~/.councilrc.
 */
export function loadEnv(source?: NodeJS.ProcessEnv): CouncilEnv {
  let raw: Record<string, string | undefined>;
  if (source) {
    raw = { ...source };
  } else {
    loadDotenv();
    raw = { ...process.env };
    loadCouncilrc(raw);
  }

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const missingKeys = result.error.issues.map((issue) => String(issue.path[0]));
    const lines = result.error.issues.map(
      (issue) => `  - ${String(issue.path[0])}: ${issue.message}`,
    );
    throw new EnvValidationError(
      `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
        `Run \`council config\` to set your API keys, or copy .env.example to .env.`,
      missingKeys,
    );
  }

  const env = result.data;
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    tavilyApiKey: env.TAVILY_API_KEY,
    braveApiKey: env.BRAVE_API_KEY,
    githubToken: env.GITHUB_TOKEN,
    debug: isTruthyDebug(env.COUNCIL_DEBUG),
  };
}
